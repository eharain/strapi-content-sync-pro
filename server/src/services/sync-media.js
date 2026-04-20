'use strict';

/**
 * Sync Media Service
 *
 * Profile-based media synchronization between two Strapi instances.
 * Each media profile defines direction, strategy, conflict resolution,
 * file-type filters, and execution settings — mirroring how content-type
 * sync profiles work.
 *
 * Strategies:
 *   1. url    — HTTP upload/download via /api/upload
 *   2. rsync  — file-level copy via rsync binary
 *   3. disabled — no media sync
 *
 * Sync scope:
 *   - DB rows  : plugin::upload.file metadata (name, caption, alt, mime, …)
 *   - File bytes: actual media assets (via URL or rsync)
 *   - Both can be toggled independently per profile.
 */

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { pipeline } = require('node:stream/promises');
const { Readable } = require('node:stream');

const PROFILES_KEY = 'media-sync-profiles';
const GLOBAL_SETTINGS_KEY = 'media-sync-global-settings';
const STATUS_KEY = 'media-sync-status';
const PLUGIN_NAME = 'strapi-content-sync-pro';

// ── Default MIME type groups ────────────────────────────────────────────────
const DEFAULT_MIME_IMAGES = ['image/'];
const DEFAULT_MIME_VIDEOS = [
  'video/mp4', 'video/webm', 'video/x-msvideo', 'video/quicktime',
  'video/x-matroska', 'video/ogg', 'video/3gpp',
];
const DEFAULT_MIME_DOCUMENTS = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.oasis.opendocument.text',
  'application/vnd.oasis.opendocument.spreadsheet',
  'text/csv',
  'text/plain',
];
const DEFAULT_MIME_ALL = [...DEFAULT_MIME_IMAGES, ...DEFAULT_MIME_VIDEOS, ...DEFAULT_MIME_DOCUMENTS];

const VALID_STRATEGIES = ['disabled', 'url', 'rsync'];
const VALID_DIRECTIONS = ['push', 'pull', 'both'];
const VALID_CONFLICT_STRATEGIES = ['latest_wins', 'local_wins', 'remote_wins'];
const VALID_EXECUTION_MODES = ['on_demand', 'scheduled', 'live'];
const VALID_SCHEDULE_TYPES = ['interval', 'timeout', 'cron', 'external'];

// ── Default global settings ─────────────────────────────────────────────────
const DEFAULT_GLOBAL_SETTINGS = {
  pageSize: 50,
  batchConcurrency: 2,
  skipIfSameSize: true,
  // rsync defaults
  rsyncCommand: 'rsync',
  rsyncArgs: '-avz --delete-after',
  localMediaPath: '',
  remoteMediaPath: '',
  sshPort: 22,
  sshIdentityFile: '',
  rsyncTimeoutMs: 30 * 60 * 1000,
};

// ── Default media profile template ──────────────────────────────────────────
function makeDefaultProfile(overrides = {}) {
  return {
    id: overrides.id || `media-profile-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: overrides.name || 'Media Sync',
    strategy: overrides.strategy || 'url',
    direction: overrides.direction || 'both',
    conflictStrategy: overrides.conflictStrategy || 'latest_wins',
    active: overrides.active !== undefined ? overrides.active : false,
    // What to sync
    syncDbRows: overrides.syncDbRows !== undefined ? overrides.syncDbRows : true,
    syncFileBytes: overrides.syncFileBytes !== undefined ? overrides.syncFileBytes : true,
    // File-type filters
    includeMime: overrides.includeMime || [],
    excludeMime: overrides.excludeMime || [],
    includePatterns: overrides.includePatterns || [],
    excludePatterns: overrides.excludePatterns || [],
    dryRun: overrides.dryRun || false,
    // Execution settings (per profile, like content sync)
    executionMode: overrides.executionMode || 'on_demand',
    scheduleType: overrides.scheduleType || 'interval',
    scheduleInterval: overrides.scheduleInterval || 60,
    cronExpression: overrides.cronExpression || '',
    enabled: overrides.enabled !== undefined ? overrides.enabled : true,
    lastExecutedAt: overrides.lastExecutedAt || null,
    nextExecutionAt: overrides.nextExecutionAt || null,
    createdAt: overrides.createdAt || new Date().toISOString(),
    updatedAt: overrides.updatedAt || new Date().toISOString(),
  };
}

// Auto-generated default profiles when media sync is first enabled
function generateDefaultProfiles() {
  return [
    makeDefaultProfile({
      id: 'media-full-push',
      name: 'Full Push (Media)',
      strategy: 'url',
      direction: 'push',
      conflictStrategy: 'local_wins',
      active: false,
      includeMime: [...DEFAULT_MIME_ALL],
      syncDbRows: true,
      syncFileBytes: true,
    }),
    makeDefaultProfile({
      id: 'media-full-pull',
      name: 'Full Pull (Media)',
      strategy: 'url',
      direction: 'pull',
      conflictStrategy: 'remote_wins',
      active: false,
      includeMime: [...DEFAULT_MIME_ALL],
      syncDbRows: true,
      syncFileBytes: true,
    }),
    makeDefaultProfile({
      id: 'media-bidirectional',
      name: 'Bidirectional (Media)',
      strategy: 'url',
      direction: 'both',
      conflictStrategy: 'latest_wins',
      active: true,
      includeMime: [...DEFAULT_MIME_ALL],
      syncDbRows: true,
      syncFileBytes: true,
    }),
  ];
}

module.exports = ({ strapi }) => {
  const log = strapi.log;
  const schedulerHandles = {};

  function store() {
    return strapi.store({ type: 'plugin', name: PLUGIN_NAME });
  }

  function plugin() {
    return strapi.plugin(PLUGIN_NAME);
  }

  // ---------------------------------------------------------------------------
  // Profile CRUD
  // ---------------------------------------------------------------------------

  async function getProfiles() {
    const data = await store().get({ key: PROFILES_KEY });
    if (!data || !Array.isArray(data) || data.length === 0) {
      // First time — generate defaults
      const defaults = generateDefaultProfiles();
      await store().set({ key: PROFILES_KEY, value: defaults });
      return defaults;
    }
    return data;
  }

  async function getProfile(profileId) {
    const profiles = await getProfiles();
    return profiles.find((p) => p.id === profileId) || null;
  }

  async function getActiveProfile() {
    const profiles = await getProfiles();
    return profiles.find((p) => p.active) || null;
  }

  async function createProfile(data) {
    const profiles = await getProfiles();
    const profile = makeDefaultProfile({ ...data, id: undefined });
    profiles.push(profile);
    await store().set({ key: PROFILES_KEY, value: profiles });
    return profile;
  }

  async function updateProfile(profileId, data) {
    const profiles = await getProfiles();
    const idx = profiles.findIndex((p) => p.id === profileId);
    if (idx === -1) throw new Error(`Media profile "${profileId}" not found`);
    const updated = { ...profiles[idx], ...data, id: profileId, updatedAt: new Date().toISOString() };
    validateProfile(updated);
    profiles[idx] = updated;
    await store().set({ key: PROFILES_KEY, value: profiles });
    return updated;
  }

  async function deleteProfile(profileId) {
    let profiles = await getProfiles();
    profiles = profiles.filter((p) => p.id !== profileId);
    await store().set({ key: PROFILES_KEY, value: profiles });
    clearHandles(profileId);
    return { success: true };
  }

  async function activateProfile(profileId) {
    const profiles = await getProfiles();
    for (const p of profiles) {
      p.active = p.id === profileId;
    }
    await store().set({ key: PROFILES_KEY, value: profiles });
    return profiles.find((p) => p.id === profileId);
  }

  function validateProfile(p) {
    if (!VALID_STRATEGIES.includes(p.strategy)) throw new Error(`Invalid strategy "${p.strategy}"`);
    if (!VALID_DIRECTIONS.includes(p.direction)) throw new Error(`Invalid direction "${p.direction}"`);
    if (!VALID_CONFLICT_STRATEGIES.includes(p.conflictStrategy)) throw new Error(`Invalid conflict strategy "${p.conflictStrategy}"`);
    if (!VALID_EXECUTION_MODES.includes(p.executionMode)) throw new Error(`Invalid execution mode "${p.executionMode}"`);
  }

  // ---------------------------------------------------------------------------
  // Global settings
  // ---------------------------------------------------------------------------

  async function getGlobalSettings() {
    const s = await store().get({ key: GLOBAL_SETTINGS_KEY });
    return { ...DEFAULT_GLOBAL_SETTINGS, ...(s || {}) };
  }

  async function setGlobalSettings(partial) {
    const current = await getGlobalSettings();
    const merged = { ...current, ...partial, updatedAt: new Date().toISOString() };
    await store().set({ key: GLOBAL_SETTINGS_KEY, value: merged });
    return merged;
  }

  // Back-compat: old flat settings → global + active profile
  async function getSettings() {
    const global = await getGlobalSettings();
    const active = await getActiveProfile();
    return { ...global, ...(active || {}), profiles: await getProfiles() };
  }

  async function setSettings(partial) {
    // Back-compat: writes to global settings
    return setGlobalSettings(partial);
  }

  // ---------------------------------------------------------------------------
  // Status
  // ---------------------------------------------------------------------------

  async function getStatus() {
    const s = await store().get({ key: STATUS_KEY });
    const profiles = await getProfiles();
    return {
      profiles: profiles.map((p) => ({
        id: p.id,
        name: p.name,
        active: p.active,
        executionMode: p.executionMode,
        enabled: p.enabled,
        lastExecutedAt: p.lastExecutedAt,
        nextExecutionAt: p.nextExecutionAt,
        running: !!(s && s.runningProfiles && s.runningProfiles[p.id]),
      })),
      lastRunAt: s?.lastRunAt || null,
      lastResult: s?.lastResult || null,
      running: s?.running || false,
    };
  }

  async function setStatus(status) {
    await store().set({ key: STATUS_KEY, value: status });
  }

  // ---------------------------------------------------------------------------
  // Scheduler helpers (mirrors sync-execution patterns)
  // ---------------------------------------------------------------------------

  function clearHandles(profileId) {
    const h = schedulerHandles[profileId];
    if (!h) return;
    if (h.interval) clearInterval(h.interval);
    if (h.timeout) clearTimeout(h.timeout);
    if (h.cronJob && typeof h.cronJob.cancel === 'function') h.cronJob.cancel();
    delete schedulerHandles[profileId];
  }

  async function updateScheduler(profile) {
    clearHandles(profile.id);
    if (!profile.enabled || profile.executionMode !== 'scheduled') return;
    const type = profile.scheduleType || 'interval';
    if (type === 'external') return; // nothing to schedule in-process

    const ms = (profile.scheduleInterval || 60) * 60 * 1000;

    if (type === 'interval') {
      schedulerHandles[profile.id] = {
        interval: setInterval(() => runProfile(profile.id).catch((e) => log.error(`[media-sched] ${e.message}`)), ms),
      };
    } else if (type === 'timeout') {
      async function chain() {
        try { await runProfile(profile.id); } catch (e) { log.error(`[media-sched] ${e.message}`); }
        const p = await getProfile(profile.id);
        if (p && p.enabled && p.executionMode === 'scheduled' && p.scheduleType === 'timeout') {
          schedulerHandles[profile.id] = { timeout: setTimeout(chain, ms) };
        }
      }
      schedulerHandles[profile.id] = { timeout: setTimeout(chain, ms) };
    } else if (type === 'cron') {
      try {
        const cronTask = strapi.cron.add({ [profile.cronExpression]: () => runProfile(profile.id).catch((e) => log.error(`[media-sched] ${e.message}`)) });
        schedulerHandles[profile.id] = { cronJob: cronTask };
      } catch (e) {
        log.warn(`[media-sched] cron add failed for ${profile.id}: ${e.message}`);
      }
    }
  }

  async function initializeSchedulers() {
    const profiles = await getProfiles();
    for (const p of profiles) {
      if (p.enabled && p.executionMode === 'scheduled') {
        await updateScheduler(p);
      }
    }
  }

  function stopAllSchedulers() {
    for (const id of Object.keys(schedulerHandles)) clearHandles(id);
  }

  // ---------------------------------------------------------------------------
  // DB-row sync helpers (sync plugin::upload.file metadata without file bytes)
  // ---------------------------------------------------------------------------

  async function syncDbRowPull(remoteFile, localFile, profile) {
    // Update or create a local DB row for the remote file's metadata
    const meta = {
      name: remoteFile.name,
      alternativeText: remoteFile.alternativeText || '',
      caption: remoteFile.caption || '',
      width: remoteFile.width || null,
      height: remoteFile.height || null,
      formats: remoteFile.formats || null,
      mime: remoteFile.mime,
      size: remoteFile.size,
      ext: remoteFile.ext,
      hash: remoteFile.hash,
      url: remoteFile.url,
      provider: remoteFile.provider || 'local',
      folderPath: remoteFile.folderPath || '',
    };

    if (localFile) {
      // Conflict resolution
      if (profile.conflictStrategy === 'local_wins') return 'skipped';
      if (profile.conflictStrategy === 'latest_wins') {
        const remoteTs = new Date(remoteFile.updatedAt || 0).getTime();
        const localTs = new Date(localFile.updatedAt || 0).getTime();
        if (localTs >= remoteTs) return 'skipped';
      }
      await strapi.db.query('plugin::upload.file').update({ where: { id: localFile.id }, data: meta });
      return 'updated';
    }
    await strapi.db.query('plugin::upload.file').create({ data: meta });
    return 'created';
  }

  async function syncDbRowPush(localFile, remoteFile, profile, remoteConfig) {
    const meta = {
      name: localFile.name,
      alternativeText: localFile.alternativeText || '',
      caption: localFile.caption || '',
      mime: localFile.mime,
      size: localFile.size,
    };

    if (remoteFile) {
      if (profile.conflictStrategy === 'remote_wins') return 'skipped';
      if (profile.conflictStrategy === 'latest_wins') {
        const localTs = new Date(localFile.updatedAt || 0).getTime();
        const remoteTs = new Date(remoteFile.updatedAt || 0).getTime();
        if (remoteTs >= localTs) return 'skipped';
      }
      // Update remote metadata via REST
      try {
        const url = new URL(`/api/upload/files/${remoteFile.id}`, remoteConfig.baseUrl);
        const res = await fetch(url.toString(), {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${remoteConfig.apiToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ fileInfo: meta }),
        });
        if (!res.ok) return 'error';
      } catch { return 'error'; }
      return 'updated';
    }
    // New file — bytes must be pushed separately
    return 'needs_bytes';
  }

  // ---------------------------------------------------------------------------
  // URL strategy
  // ---------------------------------------------------------------------------

  function passesFilters(file, profile) {
    const mime = file.mime || '';
    if (profile.includeMime?.length && !profile.includeMime.some((p) => mime.startsWith(p))) return false;
    if (profile.excludeMime?.length && profile.excludeMime.some((p) => mime.startsWith(p))) return false;
    const name = file.name || '';
    if (profile.excludePatterns?.length && profile.excludePatterns.some((p) => globLike(p, name))) return false;
    if (profile.includePatterns?.length && !profile.includePatterns.some((p) => globLike(p, name))) return false;
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

  async function syncMediaViaUrl(profile, globalSettings) {
    const settings = { ...globalSettings, ...profile };
    const configService = plugin().service('config');
    const logService = plugin().service('syncLog');
    const remoteConfig = await configService.getConfig({ safe: false });
    if (!remoteConfig?.baseUrl) throw new Error('Remote server not configured');

    const totals = { pushed: 0, pulled: 0, skipped: 0, dbRowsUpdated: 0, errors: [] };
    const started = Date.now();

    const localIndex = new Map();
    for await (const batch of iterateLocalFiles(settings.pageSize)) {
      for (const f of batch) localIndex.set(`${f.hash}|${f.name}`, f);
    }

    // PULL: remote -> local
    if (settings.direction === 'pull' || settings.direction === 'both') {
      for await (const remoteBatch of iterateRemoteFiles(remoteConfig, settings.pageSize)) {
        const filtered = remoteBatch.filter((f) => passesFilters(f, profile));
        const result = await processBatch(filtered, async (rf) => {
          const key = `${rf.hash}|${rf.name}`;
          const lf = localIndex.get(key);

          // DB-row sync
          if (profile.syncDbRows) {
            const dbResult = await syncDbRowPull(rf, lf, profile);
            if (dbResult === 'created' || dbResult === 'updated') totals.dbRowsUpdated++;
          }

          // File-byte sync
          if (profile.syncFileBytes) {
            if (shouldSkip(lf, rf, settings)) return 'skipped';
            if (settings.dryRun) return 'success';
            const buf = await downloadToBuffer(remoteConfig, rf);
            await uploadBufferToLocal(rf, buf);
          }
          return 'success';
        }, settings.batchConcurrency);
        totals.pulled += result.success;
        totals.skipped += result.skipped;
        totals.errors.push(...result.errors);
      }
    }

    // PUSH: local -> remote
    if (settings.direction === 'push' || settings.direction === 'both') {
      const remoteIndex = new Map();
      for await (const remoteBatch of iterateRemoteFiles(remoteConfig, settings.pageSize)) {
        for (const f of remoteBatch) remoteIndex.set(`${f.hash}|${f.name}`, f);
      }

      for await (const localBatch of iterateLocalFiles(settings.pageSize)) {
        const filtered = localBatch.filter((f) => passesFilters(f, profile));
        const result = await processBatch(filtered, async (lf) => {
          const key = `${lf.hash}|${lf.name}`;
          const rf = remoteIndex.get(key);

          // DB-row sync (push metadata)
          if (profile.syncDbRows && rf) {
            const dbResult = await syncDbRowPush(lf, rf, profile, remoteConfig);
            if (dbResult === 'updated') totals.dbRowsUpdated++;
          }

          // File-byte sync
          if (profile.syncFileBytes) {
            if (shouldSkip(lf, rf, settings)) return 'skipped';
            if (settings.dryRun) return 'success';
            const buf = await readLocalFileBuffer(lf);
            if (!buf) return 'skipped';
            await uploadBufferToRemote(remoteConfig, lf, buf);
          }
          return 'success';
        }, settings.batchConcurrency);
        totals.pushed += result.success;
        totals.skipped += result.skipped;
        totals.errors.push(...result.errors);
      }
    }

    const summary = {
      strategy: 'url',
      profileId: profile.id,
      profileName: profile.name,
      direction: settings.direction,
      dryRun: !!settings.dryRun,
      durationMs: Date.now() - started,
      ...totals,
    };

    await logService?.log?.({
      action: 'media_sync',
      contentType: 'plugin::upload.file',
      direction: settings.direction,
      status: totals.errors.length ? 'partial' : 'success',
      message: `URL media sync [${profile.name}]: pushed=${totals.pushed}, pulled=${totals.pulled}, dbRows=${totals.dbRowsUpdated}, skipped=${totals.skipped}, errors=${totals.errors.length}`,
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

  async function syncMediaViaRsync(profile, globalSettings) {
    const settings = { ...globalSettings, ...profile };
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
      profileId: profile.id,
      profileName: profile.name,
      direction: settings.direction,
      dryRun: !!settings.dryRun,
      durationMs: Date.now() - started,
      runs: results.map((r) => ({ mode: r.mode, stdoutTail: tail(r.stdout), stderrTail: tail(r.stderr) })),
    };

    await logService?.log?.({
      action: 'media_sync',
      contentType: 'plugin::upload.file',
      direction: settings.direction,
      status: 'success',
      message: `rsync media sync [${profile.name}] (${settings.direction}) completed in ${summary.durationMs}ms`,
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
  // Profile execution
  // ---------------------------------------------------------------------------

  async function runProfile(profileId, options = {}) {
    const profile = await getProfile(profileId);
    if (!profile) throw new Error(`Media profile "${profileId}" not found`);
    if (profile.strategy === 'disabled') throw new Error(`Profile "${profile.name}" has strategy disabled.`);

    const globalSettings = await getGlobalSettings();
    const merged = { ...globalSettings, ...profile, ...options };

    const statusData = await store().get({ key: STATUS_KEY }) || {};
    statusData.running = true;
    statusData.runningProfiles = { ...(statusData.runningProfiles || {}), [profileId]: true };
    await setStatus(statusData);

    try {
      let result;
      if (merged.strategy === 'rsync') {
        result = await syncMediaViaRsync(merged, globalSettings);
      } else {
        result = await syncMediaViaUrl(merged, globalSettings);
      }

      // Update profile last execution
      await updateProfile(profileId, { lastExecutedAt: new Date().toISOString() });

      const s2 = await store().get({ key: STATUS_KEY }) || {};
      delete (s2.runningProfiles || {})[profileId];
      s2.running = Object.keys(s2.runningProfiles || {}).length > 0;
      s2.lastRunAt = new Date().toISOString();
      s2.lastResult = result;
      await setStatus(s2);

      return result;
    } catch (err) {
      const s2 = await store().get({ key: STATUS_KEY }) || {};
      delete (s2.runningProfiles || {})[profileId];
      s2.running = Object.keys(s2.runningProfiles || {}).length > 0;
      s2.lastRunAt = new Date().toISOString();
      s2.lastResult = { error: err.message };
      await setStatus(s2);
      throw err;
    }
  }

  async function runActiveProfiles() {
    const profiles = await getProfiles();
    const active = profiles.filter((p) => p.active && p.strategy !== 'disabled');
    const results = [];
    for (const p of active) {
      try {
        results.push(await runProfile(p.id));
      } catch (err) {
        results.push({ profileId: p.id, error: err.message });
      }
    }
    return results;
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  return {
    // Profile CRUD
    getProfiles,
    getProfile,
    getActiveProfile,
    createProfile,
    updateProfile,
    deleteProfile,
    activateProfile,

    // Global settings
    getGlobalSettings,
    setGlobalSettings,

    // Back-compat
    getSettings,
    setSettings,

    // Status
    getStatus,

    // Execution
    runProfile,
    runActiveProfiles,

    // Schedulers
    initializeSchedulers,
    stopAllSchedulers,
    updateScheduler,

    // Constants for UI
    getDefaults() {
      return {
        mimeImages: DEFAULT_MIME_IMAGES,
        mimeVideos: DEFAULT_MIME_VIDEOS,
        mimeDocuments: DEFAULT_MIME_DOCUMENTS,
        mimeAll: DEFAULT_MIME_ALL,
        strategies: VALID_STRATEGIES,
        directions: VALID_DIRECTIONS,
        conflictStrategies: VALID_CONFLICT_STRATEGIES,
        executionModes: VALID_EXECUTION_MODES,
        scheduleTypes: VALID_SCHEDULE_TYPES,
      };
    },

    // Legacy run (back-compat for existing /media-sync/run endpoint)
    async run(options = {}) {
      if (options.profileId) {
        return runProfile(options.profileId, options);
      }
      // Run the active profile
      const active = await getActiveProfile();
      if (!active) throw new Error('No active media profile. Create or activate one in the Media tab.');
      return runProfile(active.id, options);
    },

    async testConnection() {
      const globalSettings = await getGlobalSettings();
      if (globalSettings.rsyncCommand && globalSettings.localMediaPath) {
        // rsync test
        return new Promise((resolve) => {
          const child = spawn(globalSettings.rsyncCommand || 'rsync', ['--version'], { shell: false });
          let out = '';
          child.stdout.on('data', (d) => { out += d.toString(); });
          child.on('error', (err) => resolve({ ok: false, error: err.message }));
          child.on('close', (code) => resolve({ ok: code === 0, version: out.split(/\r?\n/)[0] || '' }));
        });
      }
      // URL strategy test
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
