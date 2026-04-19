'use strict';

/**
 * Sync Media Service
 *
 * Syncs files from @strapi/plugin-upload between two Strapi instances.
 *
 * Two strategies are supported; users choose one per deployment from the
 * Media tab:
 *
 *   1. url    — Lists files via the remote /api/upload/files endpoint and
 *               pushes/pulls file bytes via HTTP (uses the configured
 *               Strapi API token). Works with any upload provider on
 *               either side (local, S3, Cloudinary, ...). Slightly slower
 *               because bytes traverse HTTP, but zero infrastructure
 *               required.
 *
 *   2. rsync  — Spawns `rsync` (or a compatible command) to copy the
 *               upload directories between hosts. Requires both sides to
 *               use the local provider and SSH access (or a shared
 *               mount). Much faster for very large libraries. The plugin
 *               ONLY invokes rsync; it does not manage keys or hosts.
 *
 *   3. disabled — no media sync (default).
 *
 * All operations are paginated so large libraries stay within bounded
 * memory. Status + last run metadata is persisted in the plugin store.
 */

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { pipeline } = require('node:stream/promises');
const { Readable } = require('node:stream');

const SETTINGS_KEY = 'media-sync-settings';
const STATUS_KEY = 'media-sync-status';
const PLUGIN_NAME = 'strapi-to-strapi-data-sync';

const DEFAULT_SETTINGS = {
  strategy: 'disabled', // 'disabled' | 'url' | 'rsync'
  direction: 'push',    // 'push' | 'pull' | 'both'
  pageSize: 50,
  batchConcurrency: 2,
  dryRun: false,

  // URL strategy
  skipIfSameSize: true,
  includeMime: [],      // e.g. ['image/', 'application/pdf']
  excludeMime: [],

  // rsync strategy
  rsyncCommand: 'rsync',
  rsyncArgs: '-avz --delete-after',
  localMediaPath: '',   // e.g. ./public/uploads
  remoteMediaPath: '',  // e.g. user@host:/srv/strapi/public/uploads  OR  /mnt/share/uploads
  sshPort: 22,
  sshIdentityFile: '',
  rsyncTimeoutMs: 30 * 60 * 1000, // 30 minutes

  // Common
  includePatterns: [],  // glob-ish; ['*.jpg','*.png']
  excludePatterns: [],
};

module.exports = ({ strapi }) => {
  const log = strapi.log;

  function store() {
    return strapi.store({ type: 'plugin', name: PLUGIN_NAME });
  }

  function plugin() {
    return strapi.plugin(PLUGIN_NAME);
  }

  // ---------------------------------------------------------------------------
  // Settings + status
  // ---------------------------------------------------------------------------

  async function getSettings() {
    const s = await store().get({ key: SETTINGS_KEY });
    return { ...DEFAULT_SETTINGS, ...(s || {}) };
  }

  async function setSettings(partial) {
    const current = await getSettings();
    const merged = { ...current, ...partial, updatedAt: new Date().toISOString() };
    validateSettings(merged);
    await store().set({ key: SETTINGS_KEY, value: merged });
    return merged;
  }

  function validateSettings(s) {
    if (!['disabled', 'url', 'rsync'].includes(s.strategy)) {
      throw new Error(`Invalid media strategy "${s.strategy}"`);
    }
    if (!['push', 'pull', 'both'].includes(s.direction)) {
      throw new Error(`Invalid direction "${s.direction}"`);
    }
    const n = Number(s.pageSize);
    if (!Number.isFinite(n) || n < 1 || n > 500) {
      throw new Error('pageSize must be between 1 and 500');
    }
    if (s.strategy === 'rsync') {
      if (!s.localMediaPath || !s.remoteMediaPath) {
        throw new Error('rsync strategy requires both localMediaPath and remoteMediaPath');
      }
    }
  }

  async function getStatus() {
    const s = await store().get({ key: STATUS_KEY });
    return s || { lastRunAt: null, lastResult: null, running: false };
  }

  async function setStatus(status) {
    await store().set({ key: STATUS_KEY, value: status });
  }

  // ---------------------------------------------------------------------------
  // URL strategy
  // ---------------------------------------------------------------------------

  function passesFilters(file, settings) {
    const mime = file.mime || '';
    if (settings.includeMime?.length && !settings.includeMime.some((p) => mime.startsWith(p))) return false;
    if (settings.excludeMime?.length && settings.excludeMime.some((p) => mime.startsWith(p))) return false;
    const name = file.name || '';
    if (settings.excludePatterns?.length && settings.excludePatterns.some((p) => globLike(p, name))) return false;
    if (settings.includePatterns?.length && !settings.includePatterns.some((p) => globLike(p, name))) return false;
    return true;
  }

  function globLike(pattern, name) {
    // very small wildcard matcher: "*" -> ".*", "?" -> "."
    const rx = new RegExp('^' + pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$', 'i');
    return rx.test(name);
  }

  function indexBy(files, key) {
    const map = new Map();
    for (const f of files) {
      const k = (f[key] || '').toString();
      if (k) map.set(k, f);
    }
    return map;
  }

  /**
   * List remote upload files, page by page.
   * Uses Strapi's /api/upload/files endpoint.
   */
  async function* iterateRemoteFiles(remoteConfig, pageSize) {
    let page = 1;
    while (true) {
      const url = new URL('/api/upload/files', remoteConfig.baseUrl);
      url.searchParams.set('pagination[page]', String(page));
      url.searchParams.set('pagination[pageSize]', String(pageSize));
      url.searchParams.set('sort', 'updatedAt:asc');

      const res = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${remoteConfig.apiToken}` },
      });
      if (!res.ok) {
        const body = await safeReadBody(res);
        throw new Error(`Remote upload list failed (${res.status}): ${body}`);
      }
      const json = await res.json();
      // Strapi v5 returns either { results, pagination } or a bare array
      const results = Array.isArray(json) ? json : (json.results || json.data || []);
      const pagination = Array.isArray(json) ? null : (json.pagination || json.meta?.pagination);

      yield results;

      const hasMore = pagination
        ? page < (pagination.pageCount ?? (pagination.total ? Math.ceil(pagination.total / pageSize) : 1))
        : results.length === pageSize;
      if (!hasMore || results.length === 0) break;
      page += 1;
    }
  }

  async function* iterateLocalFiles(pageSize) {
    let page = 1;
    while (true) {
      const results = await strapi.db.query('plugin::upload.file').findMany({
        limit: pageSize,
        offset: (page - 1) * pageSize,
        orderBy: { updatedAt: 'asc' },
      });
      yield results || [];
      if (!results || results.length < pageSize) break;
      page += 1;
    }
  }

  async function downloadToBuffer(remoteConfig, file) {
    const fileUrl = absoluteUrl(remoteConfig.baseUrl, file.url);
    const res = await fetch(fileUrl, {
      headers: { Authorization: `Bearer ${remoteConfig.apiToken}` },
    });
    if (!res.ok) throw new Error(`Download failed for ${file.name}: ${res.status}`);
    const ab = await res.arrayBuffer();
    return Buffer.from(ab);
  }

  function absoluteUrl(baseUrl, url) {
    if (!url) return baseUrl;
    if (/^https?:\/\//i.test(url)) return url;
    return new URL(url, baseUrl).toString();
  }

  async function safeReadBody(res) {
    try { return await res.text(); } catch { return '<unreadable>'; }
  }

  async function uploadBufferToRemote(remoteConfig, file, buffer) {
    const form = new FormData();
    const blob = new Blob([buffer], { type: file.mime || 'application/octet-stream' });
    form.append('files', blob, file.name);
    if (file.folderPath) form.append('path', file.folderPath);

    const res = await fetch(new URL('/api/upload', remoteConfig.baseUrl).toString(), {
      method: 'POST',
      headers: { Authorization: `Bearer ${remoteConfig.apiToken}` },
      body: form,
    });
    if (!res.ok) {
      const body = await safeReadBody(res);
      throw new Error(`Upload failed for ${file.name}: ${res.status} ${body}`);
    }
    return res.json();
  }

  async function uploadBufferToLocal(file, buffer) {
    // Write buffer to a temp file so the upload service can process it
    // the same way it handles multipart form uploads.
    const os = require('node:os');
    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'strapi-sync-media-'));
    const ext = path.extname(file.name) || '';
    const tmpFilePath = path.join(tmpDir, `upload${ext}`);
    await fsp.writeFile(tmpFilePath, buffer);

    const uploadService = strapi.plugin('upload').service('upload');
    try {
      const fileObj = {
        filepath: tmpFilePath,
        originalFilename: file.name,
        mimetype: file.mime || 'application/octet-stream',
        size: buffer.length,
      };
      const result = await uploadService.upload({
        data: {
          fileInfo: {
            name: file.name,
            caption: file.caption || '',
            alternativeText: file.alternativeText || '',
          },
        },
        files: fileObj,
      });
      return result;
    } finally {
      await fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  function shouldSkip(localFile, remoteFile, settings) {
    if (!localFile || !remoteFile) return false;
    if (settings.skipIfSameSize && localFile.size === remoteFile.size && localFile.hash === remoteFile.hash) {
      return true;
    }
    return false;
  }

  /**
   * Copy a page of files respecting settings.batchConcurrency.
   */
  async function processBatch(items, worker, concurrency) {
    const out = { success: 0, skipped: 0, errors: [] };
    const c = Math.max(1, Math.min(concurrency || 1, 10));
    let i = 0;
    async function run() {
      while (i < items.length) {
        const idx = i++;
        const item = items[idx];
        try {
          const r = await worker(item);
          if (r === 'skipped') out.skipped++; else out.success++;
        } catch (err) {
          out.errors.push({ name: item?.name || String(idx), error: err.message });
        }
      }
    }
    await Promise.all(Array.from({ length: c }, run));
    return out;
  }

  async function syncMediaViaUrl(options = {}) {
    const settings = { ...(await getSettings()), ...options };
    const configService = plugin().service('config');
    const logService = plugin().service('syncLog');
    const remoteConfig = await configService.getConfig({ safe: false });
    if (!remoteConfig?.baseUrl) throw new Error('Remote server not configured');

    const totals = { pushed: 0, pulled: 0, skipped: 0, errors: [] };
    const started = Date.now();

    // Build a sparse local index on first pass so push can dedupe. Because
    // we don't want to read the full table at once either, we stream local
    // files into a Map keyed by hash+name.
    const localIndex = new Map();
    for await (const batch of iterateLocalFiles(settings.pageSize)) {
      for (const f of batch) localIndex.set(`${f.hash}|${f.name}`, f);
    }

    // PULL: remote -> local. List remote, download missing/changed, upload locally.
    if (settings.direction === 'pull' || settings.direction === 'both') {
      for await (const remoteBatch of iterateRemoteFiles(remoteConfig, settings.pageSize)) {
        const filtered = remoteBatch.filter((f) => passesFilters(f, settings));
        const result = await processBatch(filtered, async (rf) => {
          const key = `${rf.hash}|${rf.name}`;
          const lf = localIndex.get(key);
          if (shouldSkip(lf, rf, settings)) return 'skipped';
          if (settings.dryRun) return 'success';
          const buf = await downloadToBuffer(remoteConfig, rf);
          await uploadBufferToLocal(rf, buf);
          return 'success';
        }, settings.batchConcurrency);
        totals.pulled += result.success;
        totals.skipped += result.skipped;
        totals.errors.push(...result.errors);
      }
    }

    // PUSH: local -> remote.
    if (settings.direction === 'push' || settings.direction === 'both') {
      // Build a remote index (lighter — only needs hash+name+size) for dedupe.
      const remoteIndex = new Map();
      for await (const remoteBatch of iterateRemoteFiles(remoteConfig, settings.pageSize)) {
        for (const f of remoteBatch) remoteIndex.set(`${f.hash}|${f.name}`, f);
      }

      for await (const localBatch of iterateLocalFiles(settings.pageSize)) {
        const filtered = localBatch.filter((f) => passesFilters(f, settings));
        const result = await processBatch(filtered, async (lf) => {
          const key = `${lf.hash}|${lf.name}`;
          const rf = remoteIndex.get(key);
          if (shouldSkip(lf, rf, settings)) return 'skipped';
          if (settings.dryRun) return 'success';
          const buf = await readLocalFileBuffer(lf);
          if (!buf) return 'skipped';
          await uploadBufferToRemote(remoteConfig, lf, buf);
          return 'success';
        }, settings.batchConcurrency);
        totals.pushed += result.success;
        totals.skipped += result.skipped;
        totals.errors.push(...result.errors);
      }
    }

    const summary = {
      strategy: 'url',
      direction: settings.direction,
      dryRun: !!settings.dryRun,
      durationMs: Date.now() - started,
      ...totals,
    };

    await setStatus({ lastRunAt: new Date().toISOString(), lastResult: summary, running: false });
    await logService?.log?.({
      action: 'media_sync',
      contentType: 'plugin::upload.file',
      direction: settings.direction,
      status: totals.errors.length ? 'partial' : 'success',
      message: `URL media sync: pushed=${totals.pushed}, pulled=${totals.pulled}, skipped=${totals.skipped}, errors=${totals.errors.length}`,
      details: summary,
    });

    return summary;
  }

  async function readLocalFileBuffer(file) {
    // Only works for the local upload provider. For remote providers we'd
    // have to fetch via file.url — which is supported too.
    if (file.provider && file.provider !== 'local' && file.url) {
      try {
        const res = await fetch(file.url);
        if (!res.ok) return null;
        const ab = await res.arrayBuffer();
        return Buffer.from(ab);
      } catch {
        return null;
      }
    }
    const uploadsDir = path.join(strapi.dirs?.static?.public || path.join(process.cwd(), 'public'), 'uploads');
    const filename = file.hash && file.ext ? `${file.hash}${file.ext}` : file.name;
    const full = path.join(uploadsDir, filename);
    try {
      return await fsp.readFile(full);
    } catch {
      return null;
    }
  }

  // ---------------------------------------------------------------------------
  // rsync strategy
  // ---------------------------------------------------------------------------

  function buildRsyncArgs(settings, mode) {
    const args = (settings.rsyncArgs || '-avz').trim().split(/\s+/).filter(Boolean);

    // SSH options if remote path looks like user@host:/path
    const isRemote = /:/.test(settings.remoteMediaPath) && !/^[A-Za-z]:\\/.test(settings.remoteMediaPath);
    if (isRemote && (settings.sshPort !== 22 || settings.sshIdentityFile)) {
      const parts = ['ssh'];
      if (settings.sshPort && settings.sshPort !== 22) parts.push('-p', String(settings.sshPort));
      if (settings.sshIdentityFile) parts.push('-i', settings.sshIdentityFile);
      args.push('-e', parts.join(' '));
    }

    for (const p of settings.includePatterns || []) args.push('--include', p);
    for (const p of settings.excludePatterns || []) args.push('--exclude', p);

    if (settings.dryRun) args.push('--dry-run');

    const src = mode === 'push' ? ensureTrailingSlash(settings.localMediaPath) : ensureTrailingSlash(settings.remoteMediaPath);
    const dst = mode === 'push' ? settings.remoteMediaPath : settings.localMediaPath;
    args.push(src, dst);

    return args;
  }

  function ensureTrailingSlash(p) {
    if (!p) return p;
    return p.endsWith('/') || p.endsWith('\\') ? p : p + '/';
  }

  function runRsync(settings, mode) {
    return new Promise((resolve, reject) => {
      const cmd = settings.rsyncCommand || 'rsync';
      const args = buildRsyncArgs(settings, mode);
      log.info(`[data-sync] rsync ${mode}: ${cmd} ${args.join(' ')}`);

      const child = spawn(cmd, args, { shell: false });
      let stdout = '';
      let stderr = '';
      const timeout = setTimeout(() => {
        try { child.kill('SIGKILL'); } catch (_) { /* ignore */ }
        reject(new Error(`rsync timed out after ${settings.rsyncTimeoutMs}ms`));
      }, settings.rsyncTimeoutMs || 30 * 60 * 1000);

      child.stdout.on('data', (d) => { stdout += d.toString(); });
      child.stderr.on('data', (d) => { stderr += d.toString(); });
      child.on('error', (err) => { clearTimeout(timeout); reject(err); });
      child.on('close', (code) => {
        clearTimeout(timeout);
        if (code === 0) resolve({ mode, stdout, stderr });
        else reject(new Error(`rsync exited with code ${code}: ${stderr || stdout}`));
      });
    });
  }

  async function syncMediaViaRsync(options = {}) {
    const settings = { ...(await getSettings()), ...options };
    if (settings.strategy !== 'rsync' && !options.force) {
      throw new Error('rsync strategy is not enabled');
    }
    const logService = plugin().service('syncLog');
    const started = Date.now();
    const results = [];

    if (settings.direction === 'push' || settings.direction === 'both') {
      results.push(await runRsync(settings, 'push'));
    }
    if (settings.direction === 'pull' || settings.direction === 'both') {
      results.push(await runRsync(settings, 'pull'));
    }

    const summary = {
      strategy: 'rsync',
      direction: settings.direction,
      dryRun: !!settings.dryRun,
      durationMs: Date.now() - started,
      runs: results.map((r) => ({ mode: r.mode, stdoutTail: tail(r.stdout), stderrTail: tail(r.stderr) })),
    };

    await setStatus({ lastRunAt: new Date().toISOString(), lastResult: summary, running: false });
    await logService?.log?.({
      action: 'media_sync',
      contentType: 'plugin::upload.file',
      direction: settings.direction,
      status: 'success',
      message: `rsync media sync (${settings.direction}) completed in ${summary.durationMs}ms`,
      details: summary,
    });

    return summary;
  }

  function tail(text, lines = 20) {
    if (!text) return '';
    const arr = text.split(/\r?\n/);
    return arr.slice(Math.max(0, arr.length - lines)).join('\n');
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  return {
    getSettings,
    setSettings,
    getStatus,

    async run(options = {}) {
      const settings = { ...(await getSettings()), ...options };
      if (settings.strategy === 'disabled') {
        throw new Error('Media sync is disabled. Choose a strategy in the Media tab first.');
      }
      await setStatus({ ...(await getStatus()), running: true });
      try {
        if (settings.strategy === 'rsync') return await syncMediaViaRsync(settings);
        return await syncMediaViaUrl(settings);
      } catch (err) {
        await setStatus({
          lastRunAt: new Date().toISOString(),
          lastResult: { error: err.message },
          running: false,
        });
        throw err;
      }
    },

    async testConnection() {
      const settings = await getSettings();
      if (settings.strategy === 'rsync') {
        // Just verify the binary is reachable; actual transfer isn't done.
        return new Promise((resolve) => {
          const child = spawn(settings.rsyncCommand || 'rsync', ['--version'], { shell: false });
          let out = '';
          child.stdout.on('data', (d) => { out += d.toString(); });
          child.on('error', (err) => resolve({ ok: false, error: err.message }));
          child.on('close', (code) => resolve({ ok: code === 0, version: out.split(/\r?\n/)[0] || '' }));
        });
      }
      // url strategy — hit /api/upload/files?pagination[pageSize]=1
      const configService = plugin().service('config');
      const remoteConfig = await configService.getConfig({ safe: false });
      if (!remoteConfig?.baseUrl) return { ok: false, error: 'Remote server not configured' };
      try {
        const url = new URL('/api/upload/files', remoteConfig.baseUrl);
        url.searchParams.set('pagination[pageSize]', '1');
        const res = await fetch(url.toString(), {
          headers: { Authorization: `Bearer ${remoteConfig.apiToken}` },
        });
        if (!res.ok) return { ok: false, error: `Remote ${res.status}: ${await safeReadBody(res)}` };
        return { ok: true };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    },
  };
};
