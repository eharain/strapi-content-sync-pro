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
const { generateSignature } = require('../utils/hmac');
const { MEDIA_PHASE_CORE, MEDIA_PHASE_LINKS } = require('../utils/strategy');

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

  // ── In-memory run controls (pause/resume/cancel) per profile ─────────────
  // Key: profileId, Value: { signal: 'run' | 'pause' | 'cancel',
  //                          resumeDeferred: { promise, resolve } | null,
  //                          progress: { phase, processed, total, pushed, pulled, skipped, errors } }
  const runControls = {};

  function getControl(profileId) {
    if (!runControls[profileId]) {
      runControls[profileId] = {
        signal: 'run',
        resumeDeferred: null,
        progress: { phase: 'idle', processed: 0, total: 0, pushed: 0, pulled: 0, skipped: 0, errors: 0 },
      };
    }
    return runControls[profileId];
  }

  function makeDeferred() {
    let resolve;
    const promise = new Promise((r) => { resolve = r; });
    return { promise, resolve };
  }

  // Cooperative checkpoint — call between units of work. Returns:
  //   { cancelled: true } if the run should abort, or null to continue.
  async function checkpoint(profileId) {
    const c = getControl(profileId);
    if (c.signal === 'cancel') return { cancelled: true };
    if (c.signal === 'pause') {
      if (!c.resumeDeferred) c.resumeDeferred = makeDeferred();
      // Mirror pause state into persisted status so UI sees it
      try {
        const s = await store().get({ key: STATUS_KEY }) || {};
        s.paused = { ...(s.paused || {}), [profileId]: true };
        await store().set({ key: STATUS_KEY, value: s });
      } catch { /* ignore */ }
      await c.resumeDeferred.promise;
      c.resumeDeferred = null;
      try {
        const s = await store().get({ key: STATUS_KEY }) || {};
        if (s.paused) { delete s.paused[profileId]; }
        await store().set({ key: STATUS_KEY, value: s });
      } catch { /* ignore */ }
      if (c.signal === 'cancel') return { cancelled: true };
    }
    return null;
  }

  async function updateProgress(profileId, patch) {
    const c = getControl(profileId);
    c.progress = { ...c.progress, ...patch };
    try {
      const s = await store().get({ key: STATUS_KEY }) || {};
      s.progress = { ...(s.progress || {}), [profileId]: { ...c.progress } };
      await store().set({ key: STATUS_KEY, value: s });
    } catch { /* ignore */ }
  }

  function store() {
    return strapi.store({ type: 'plugin', name: PLUGIN_NAME });
  }

  function plugin() {
    return strapi.plugin(PLUGIN_NAME);
  }

  // ---------------------------------------------------------------------------
  // Morph join-table resolution
  // ---------------------------------------------------------------------------
  // Strapi's upload plugin stores polymorphic file↔entity links in a morph
  // join table whose name differs between Strapi versions (e.g.
  // `files_related_morphs` on some v4 builds vs `files_related_mph` on
  // Strapi v5). Resolve it from ORM metadata so the plugin works everywhere.
  let _morphTableCache = null;
  function resolveMorphTable() {
    if (_morphTableCache) return _morphTableCache;
    const candidates = [];
    try {
      const meta = strapi.db?.metadata?.get?.('plugin::upload.file');
      const attr = meta?.attributes?.related;
      if (attr?.joinTable?.name) candidates.push(attr.joinTable.name);
      if (attr?.pivotTable) candidates.push(attr.pivotTable);
    } catch {
      // ignore — fall back to known names below
    }
    // Known historical defaults, most-recent first.
    candidates.push('files_related_mph', 'files_related_morphs');
    _morphTableCache = candidates.find((n) => !!n) || 'files_related_mph';
    return _morphTableCache;
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
        paused: !!(s && s.paused && s.paused[p.id]),
        signal: runControls[p.id]?.signal || 'idle',
        progress: (s && s.progress && s.progress[p.id]) || null,
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

  async function exportMorphLinks() {
    const morphTable = resolveMorphTable();
    const rows = await strapi.db.connection(morphTable).select('*');
    const fileCache = new Map();
    const relatedDocCache = new Map();
    const out = [];

    for (const row of rows) {
      const fileId = Number(row.file_id);
      if (!fileCache.has(fileId)) {
        const file = await strapi.db.query('plugin::upload.file').findOne({
          where: { id: fileId },
          select: ['id', 'documentId', 'name', 'ext', 'size'],
        });
        fileCache.set(fileId, file || null);
      }

      const file = fileCache.get(fileId);
      if (!file?.id) continue;

      const relatedType = row.related_type;
      const relatedId = Number(row.related_id);
      const relatedKey = `${relatedType}:${relatedId}`;

      if (!relatedDocCache.has(relatedKey)) {
        try {
          const entity = await strapi.db.query(relatedType).findOne({
            where: { id: relatedId },
            select: ['id', 'documentId'],
          });
          relatedDocCache.set(relatedKey, entity?.documentId || null);
        } catch {
          relatedDocCache.set(relatedKey, null);
        }
      }

      const relatedDocumentId = relatedDocCache.get(relatedKey);
      if (!relatedDocumentId) continue;

      out.push({
        fileDocumentId: file.documentId,
        // Stable file identity: a URL-synced file gets a new documentId on the
        // peer, so the receiver matches on name/ext/size when documentId misses.
        fileName: file.name,
        fileExt: file.ext,
        fileSize: file.size,
        relatedType,
        relatedDocumentId,
        field: row.field || null,
        order: row.order || 1,
      });
    }

    return out;
  }

  async function applyMorphLinks(links = []) {
    const applied = [];
    const skipped = [];
    const errors = [];

    for (const link of links) {
      try {
        if ((!link?.fileDocumentId && !link?.fileName) || !link?.relatedType || !link?.relatedDocumentId) {
          skipped.push({ link, reason: 'missing required identity fields' });
          continue;
        }

        // Prefer documentId (exact), fall back to the stable name/ext/size key
        // because URL-synced files are re-uploaded and get a fresh documentId.
        let file = null;
        if (link.fileDocumentId) {
          file = await strapi.db.query('plugin::upload.file').findOne({
            where: { documentId: link.fileDocumentId },
            select: ['id', 'documentId'],
          });
        }
        if (!file?.id && link.fileName != null) {
          const where = { name: link.fileName };
          if (link.fileExt != null) where.ext = link.fileExt;
          if (link.fileSize != null) where.size = link.fileSize;
          file = await strapi.db.query('plugin::upload.file').findOne({
            where,
            select: ['id', 'documentId'],
          });
        }
        if (!file?.id) {
          skipped.push({ link, reason: 'file not found locally (documentId + name/ext/size)' });
          continue;
        }

        // A Draft & Publish document has TWO rows sharing one documentId (the
        // draft, and the published clone publishEntry makes of it) — fan the
        // link out to every row, not just whichever one findOne's unordered
        // lookup happens to return (in practice the lower id, i.e. the draft).
        // Without this, media never attaches to the row the public API
        // actually serves. Non-D&P types simply have one row here, so this is
        // a no-op fan-out (one row, one insert) for them.
        let relatedRows = [];
        try {
          relatedRows = await strapi.db.query(link.relatedType).findMany({
            where: { documentId: link.relatedDocumentId },
            select: ['id', 'documentId'],
          });
        } catch {
          skipped.push({ link, reason: 'related type not queryable locally' });
          continue;
        }

        if (!relatedRows?.length) {
          skipped.push({ link, reason: 'related documentId not found locally' });
          continue;
        }

        const morphTable = resolveMorphTable();
        let appliedAny = false;
        for (const related of relatedRows) {
          let existsQ = strapi.db.connection(morphTable)
            .where('file_id', file.id)
            .andWhere('related_id', related.id)
            .andWhere('related_type', link.relatedType);

          if (link.field) existsQ = existsQ.andWhere('field', link.field);
          else existsQ = existsQ.whereNull('field');

          const existing = await existsQ.first();
          if (existing) continue;

          await strapi.db.connection(morphTable).insert({
            file_id: file.id,
            related_id: related.id,
            related_type: link.relatedType,
            field: link.field || null,
            order: link.order || 1,
          });
          appliedAny = true;
        }

        if (!appliedAny) {
          skipped.push({ link, reason: 'morph link already exists on every local row' });
          continue;
        }

        applied.push(link);
      } catch (err) {
        errors.push({ link, error: err.message });
      }
    }

    return {
      total: links.length,
      applied: applied.length,
      skipped: skipped.length,
      errors,
    };
  }

  async function fetchRemoteMorphLinks(remoteConfig) {
    const url = new URL('/api/strapi-content-sync-pro/media-sync/morph-links', remoteConfig.baseUrl);
    const res = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${remoteConfig.apiToken}`,
        'Content-Type': 'application/json',
      },
    });

    if (!res.ok) {
      const body = await safeReadBody(res);
      const err = new Error(`Remote morph-links fetch failed (${res.status}): ${body}`);
      err.status = res.status;
      throw err;
    }

    const json = await res.json();
    return json?.data || [];
  }

  async function applyRemoteMorphLinks(remoteConfig, links = []) {
    const url = new URL('/api/strapi-content-sync-pro/media-sync/morph-links/apply', remoteConfig.baseUrl);
    const payload = { links };
    const timestamp = Date.now().toString();
    const signature = generateSignature(payload, remoteConfig.sharedSecret, timestamp);
    const res = await fetch(url.toString(), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${remoteConfig.apiToken}`,
        'Content-Type': 'application/json',
        'x-sync-signature': signature,
        'x-sync-timestamp': timestamp,
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const body = await safeReadBody(res);
      throw new Error(`Remote morph-links apply failed (${res.status}): ${body}`);
    }

    const json = await res.json();
    return json?.data || { total: links.length, applied: 0, skipped: 0, errors: [] };
  }

  // ---------------------------------------------------------------------------
  // Owner-side entity → file links (pass 2 of the media strategy)
  // ---------------------------------------------------------------------------
  // Media is a referenced target, never the relation driver: a file↔entity link
  // is exported and applied from the OWNING content type's media field, in one
  // direction. That replaces the old morph-table traversal, which wrote the same
  // link from the file side as well and made link state order-dependent.
  //
  // Link shape (one row per entity, all of its media fields together):
  //   { uid, documentId, fields: { cover: [fileRef], gallery: [fileRef, …] } }
  // where fileRef = { documentId, name, ext, size } — `documentId` is exact but
  // a URL-synced file is re-uploaded on the peer and gets a fresh one, so
  // name+ext+size is carried as the stable fallback identity.

  /**
   * Content types whose media links participate in a run: in-scope (enabled for
   * sync, or explicitly passed) api:: types that actually declare media fields.
   */
  async function resolveMediaLinkScope(scopeUids = []) {
    const dependencyResolver = plugin().service('dependencyResolver');

    let candidates = Array.isArray(scopeUids) ? scopeUids.filter(Boolean) : [];
    if (candidates.length === 0) {
      // No explicit scope — fall back to the content types enabled for sync.
      try {
        const syncConfig = await plugin().service('syncConfig').getSyncConfig();
        candidates = (syncConfig.contentTypes || []).filter((ct) => ct.enabled).map((ct) => ct.uid);
      } catch {
        candidates = [];
      }
    }
    if (candidates.length === 0) {
      candidates = Object.keys(strapi.contentTypes || {}).filter((uid) => uid.startsWith('api::'));
    }

    const out = [];
    const seen = new Set();
    for (const uid of candidates) {
      if (seen.has(uid)) continue;
      seen.add(uid);
      if (!strapi.contentTypes?.[uid]) continue;
      const mediaFields = dependencyResolver.getMediaFields(uid);
      if (mediaFields.length === 0) continue;
      out.push({ uid, mediaFields });
    }
    return out;
  }

  function fileRef(file) {
    if (!file || typeof file !== 'object') return null;
    if (!file.documentId && !file.name) return null;
    return {
      documentId: file.documentId || null,
      name: file.name || null,
      ext: file.ext || null,
      size: file.size != null ? file.size : null,
    };
  }

  function fileRefsFrom(value) {
    if (value == null) return [];
    if (Array.isArray(value)) return value.map(fileRef).filter(Boolean);
    const single = fileRef(value);
    return single ? [single] : [];
  }

  /**
   * Export one page of owner-side media links for a single content type.
   * Entities with no media attached are included with empty field lists so a
   * removal on the source propagates as a removal on the target.
   */
  async function exportEntityMediaLinks({ uid, page = 1, pageSize = 100 } = {}) {
    if (!uid) throw new Error('uid is required');
    const scope = await resolveMediaLinkScope([uid]);
    const entry = scope.find((s) => s.uid === uid);
    if (!entry) return { uid, page, pageSize, links: [], hasMore: false };

    const fieldNames = entry.mediaFields.map((f) => f.field);
    const size = Math.max(1, Math.min(Number(pageSize) || 100, 500));
    const p = Math.max(1, Number(page) || 1);
    const dp = !!(strapi.contentTypes?.[uid]?.options?.draftAndPublish);

    const params = {
      start: (p - 1) * size,
      limit: size,
      fields: ['documentId'],
      populate: fieldNames,
      sort: 'documentId:asc',
    };
    // Mirror the entities pass, which syncs the published version.
    if (dp) params.status = 'published';

    const records = (await strapi.documents(uid).findMany(params)) || [];

    const links = records
      .filter((r) => r?.documentId)
      .map((record) => {
        const fields = {};
        for (const { field, multiple } of entry.mediaFields) {
          fields[field] = { multiple: !!multiple, files: fileRefsFrom(record[field]) };
        }
        return { uid, documentId: record.documentId, fields };
      });

    return { uid, page: p, pageSize: size, links, hasMore: records.length === size };
  }

  /**
   * Resolve a remote file reference to a local upload row.
   * documentId is exact; name+ext+size is the stable cross-instance fallback
   * because a URL-synced file is re-uploaded and gets a fresh documentId.
   */
  async function resolveLocalFile(ref, cache) {
    const cacheKey = ref.documentId || `${ref.name}|${ref.ext}|${ref.size}`;
    if (cache.has(cacheKey)) return cache.get(cacheKey);

    let file = null;
    if (ref.documentId) {
      file = await strapi.db.query('plugin::upload.file').findOne({
        where: { documentId: ref.documentId },
        select: ['id', 'documentId'],
      });
    }
    if (!file?.id && ref.name) {
      const where = { name: ref.name };
      if (ref.ext != null) where.ext = ref.ext;
      if (ref.size != null) where.size = ref.size;
      file = await strapi.db.query('plugin::upload.file').findOne({ where, select: ['id', 'documentId'] });
    }
    if (!file?.id && ref.name) {
      // Last resort: name only. Size can legitimately differ when the peer's
      // upload provider re-encodes on ingest.
      file = await strapi.db.query('plugin::upload.file').findOne({
        where: { name: ref.name },
        select: ['id', 'documentId'],
      });
    }

    cache.set(cacheKey, file || null);
    return file || null;
  }

  /**
   * Apply owner-side media links locally.
   *
   * Safety rule: a field whose source list is non-empty but resolves to NO
   * local file is left untouched rather than cleared — that state means the
   * files have not been synced yet (pass 1 incomplete), not that the link was
   * removed. An empty source list IS applied, so real removals propagate.
   */
  async function applyEntityMediaLinks(links = []) {
    const { markAsRemoteUpdate } = require('../utils/sync-guard');
    const fileCache = new Map();

    let applied = 0;
    let unchanged = 0;
    let skipped = 0;
    const errors = [];

    for (const link of links) {
      try {
        if (!link?.uid || !link?.documentId || !link?.fields) {
          skipped++;
          continue;
        }
        if (!strapi.contentTypes?.[link.uid]) {
          skipped++;
          continue;
        }

        const dp = !!(strapi.contentTypes[link.uid]?.options?.draftAndPublish);
        const existing = await strapi.documents(link.uid).findOne({
          documentId: link.documentId,
          ...(dp ? { status: 'published' } : {}),
        });
        if (!existing) {
          // The entity itself has not been synced yet — pass 1 owns creating it.
          skipped++;
          continue;
        }

        const data = {};
        for (const [field, spec] of Object.entries(link.fields)) {
          const attr = strapi.contentTypes[link.uid]?.attributes?.[field];
          if (!attr || attr.type !== 'media') continue;

          const refs = Array.isArray(spec?.files) ? spec.files : [];
          if (refs.length === 0) {
            data[field] = attr.multiple ? [] : null;
            continue;
          }

          const ids = [];
          for (const ref of refs) {
            const file = await resolveLocalFile(ref, fileCache);
            if (file?.id) ids.push(file.id);
          }
          if (ids.length === 0) {
            // Nothing resolved — do not wipe an existing link.
            continue;
          }
          data[field] = attr.multiple ? ids : ids[0];
        }

        if (Object.keys(data).length === 0) {
          unchanged++;
          continue;
        }

        markAsRemoteUpdate(`${link.uid}:${link.documentId}`);
        await strapi.documents(link.uid).update({
          documentId: link.documentId,
          data,
          ...(dp ? { status: 'published' } : {}),
        });
        applied++;
      } catch (err) {
        errors.push({ uid: link?.uid, documentId: link?.documentId, error: err.message });
      }
    }

    return { total: links.length, applied, unchanged, skipped, errors };
  }

  async function fetchRemoteEntityMediaLinks(remoteConfig, { uid, page = 1, pageSize = 100 }) {
    const url = new URL('/api/strapi-content-sync-pro/media-sync/entity-media-links', remoteConfig.baseUrl);
    url.searchParams.set('uid', uid);
    url.searchParams.set('page', String(page));
    url.searchParams.set('pageSize', String(pageSize));

    const res = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${remoteConfig.apiToken}`,
        'Content-Type': 'application/json',
      },
    });

    if (!res.ok) {
      const body = await safeReadBody(res);
      const err = new Error(`Remote entity-media-links fetch failed (${res.status}): ${body}`);
      err.status = res.status;
      throw err;
    }

    const json = await res.json();
    return json?.data || { links: [], hasMore: false };
  }

  async function applyRemoteEntityMediaLinks(remoteConfig, links = []) {
    const url = new URL('/api/strapi-content-sync-pro/media-sync/entity-media-links/apply', remoteConfig.baseUrl);
    const payload = { links };
    const timestamp = Date.now().toString();
    const signature = generateSignature(payload, remoteConfig.sharedSecret, timestamp);

    const res = await fetch(url.toString(), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${remoteConfig.apiToken}`,
        'Content-Type': 'application/json',
        'x-sync-signature': signature,
        'x-sync-timestamp': timestamp,
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const body = await safeReadBody(res);
      const err = new Error(`Remote entity-media-links apply failed (${res.status}): ${body}`);
      err.status = res.status;
      throw err;
    }

    const json = await res.json();
    return json?.data || { total: links.length, applied: 0, skipped: 0, errors: [] };
  }

  // Strapi v5 REST returns a populated media field flat; a v4-shaped response
  // wraps it in `data`. Unwrap so both read the same downstream.
  function unwrapRestRelation(value) {
    if (value && typeof value === 'object' && !Array.isArray(value) && 'data' in value) return value.data;
    return value;
  }

  /**
   * Derive owner-side media links from the peer's STANDARD content REST API.
   *
   * This is the transport for a peer that does not run this plugin at all —
   * single-side mode, where only stock `/api/<plural>` and `/api/upload`
   * endpoints exist. Media fields come from the LOCAL schema (a single-side
   * peer mirrors the same content types), and the result carries the same link
   * shape `exportEntityMediaLinks` produces, so `applyEntityMediaLinks`
   * consumes either transport unchanged.
   */
  async function fetchRemoteEntityMediaLinksViaRest(remoteConfig, { uid, page = 1, pageSize = 100 }) {
    const { uidToPluralEndpoint } = require('../utils/fetcher');
    const scope = await resolveMediaLinkScope([uid]);
    const entry = scope.find((s) => s.uid === uid);
    if (!entry) return { uid, page, pageSize, links: [], hasMore: false };

    const size = Math.max(1, Math.min(Number(pageSize) || 100, 500));
    const p = Math.max(1, Number(page) || 1);

    const url = new URL(`/api/${uidToPluralEndpoint(uid)}`, remoteConfig.baseUrl);
    url.searchParams.set('fields[0]', 'documentId');
    entry.mediaFields.forEach(({ field }, i) => url.searchParams.set(`populate[${i}]`, field));
    url.searchParams.set('pagination[page]', String(p));
    url.searchParams.set('pagination[pageSize]', String(size));
    url.searchParams.set('sort', 'documentId:asc');

    const res = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${remoteConfig.apiToken}`,
        'Content-Type': 'application/json',
      },
    });

    if (!res.ok) {
      const body = await safeReadBody(res);
      const err = new Error(`Remote REST media-links fetch failed for ${uid} (${res.status}): ${body}`);
      err.status = res.status;
      throw err;
    }

    const json = await res.json();
    const records = Array.isArray(json?.data) ? json.data : [];

    const links = records
      .filter((r) => r?.documentId)
      .map((record) => {
        const fields = {};
        for (const { field, multiple } of entry.mediaFields) {
          fields[field] = { multiple: !!multiple, files: fileRefsFrom(unwrapRestRelation(record[field])) };
        }
        return { uid, documentId: record.documentId, fields };
      });

    const pageCount = json?.meta?.pagination?.pageCount;
    return {
      uid,
      page: p,
      pageSize: size,
      links,
      hasMore: pageCount ? p < pageCount : records.length === size,
    };
  }

  /**
   * Pass 2 for media: walk the in-scope owning content types and sync their
   * media links in the profile's direction.
   *
   * Pull transports are tried in order; the first one the peer actually serves
   * wins:
   *   1. entity-media-links — peer runs this plugin version
   *   2. morph-links        — peer runs an older plugin version
   *   3. plain content REST — peer runs no plugin at all, which is exactly what
   *                           single-side mode means. Links are derived from the
   *                           owning entities' populated media fields.
   * Push always needs the plugin on the peer: a stock Strapi has no endpoint
   * that can apply links, and single-side profiles are pull-only anyway.
   */
  async function syncMediaLinks(profile, settings, options = {}) {
    const configService = plugin().service('config');
    const remoteConfig = await configService.getConfig({ safe: false });
    if (!remoteConfig?.baseUrl) throw new Error('Remote server not configured');

    const pid = profile.id;
    const direction = options.direction || settings.direction;
    const pageSize = Math.max(1, Math.min(Number(settings.pageSize) || 100, 500));
    const scope = await resolveMediaLinkScope(options.scopeUids || []);
    const singleSide = (remoteConfig.syncMode || 'paired') === 'single_side';

    const out = {
      contentTypes: scope.map((s) => s.uid),
      pulled: 0,
      pushed: 0,
      skipped: 0,
      unchanged: 0,
      errors: [],
      legacyFallback: false,
      restFallback: false,
      cancelled: false,
    };

    if (settings.dryRun) return out;

    /**
     * Pull every in-scope content type through one transport.
     * `probe` marks a transport that may be absent on the peer entirely: a 404
     * then means "not served", and the caller moves on to the next transport
     * instead of recording a per-content-type failure.
     */
    const pullLinksWith = async (fetchPage, { probe = false } = {}) => {
      for (const { uid } of scope) {
        for (let page = 1; ; page += 1) {
          const abort = await checkpoint(pid);
          if (abort?.cancelled) { out.cancelled = true; return true; }
          let remote;
          try {
            remote = await fetchPage({ uid, page, pageSize });
          } catch (err) {
            if (probe && err.status === 404) return false;
            out.errors.push({ name: `media_links_pull:${uid}`, error: err.message });
            break;
          }
          const result = await applyEntityMediaLinks(remote.links || []);
          out.pulled += result.applied;
          out.skipped += result.skipped;
          out.unchanged += result.unchanged;
          if (result.errors.length) {
            out.errors.push(...result.errors.map((e) => ({ name: `media_links_pull:${uid}`, error: e.error })));
          }
          if (!remote.hasMore) break;
        }
        if (out.cancelled) break;
      }
      return true;
    };

    // ── PULL: remote owner entities → local links ───────────────────────────
    if (direction === 'pull' || direction === 'both') {
      // Single-side peers never serve plugin endpoints; don't waste a probe.
      let served = singleSide
        ? false
        : await pullLinksWith((a) => fetchRemoteEntityMediaLinks(remoteConfig, a), { probe: true });

      // Mixed-version pair: the peer predates owner-side link sync but still
      // serves the legacy morph transport.
      if (!served && !singleSide && !out.cancelled) {
        strapi.log?.warn?.('[data-sync] peer does not expose entity-media-links; falling back to legacy morph-link sync');
        try {
          const applyResult = await applyMorphLinks(await fetchRemoteMorphLinks(remoteConfig));
          out.pulled += applyResult.applied || 0;
          out.skipped += applyResult.skipped || 0;
          out.legacyFallback = true;
          served = true;
        } catch (err) {
          // Only a 404 means "transport absent" — anything else is a real failure
          // and must not be masked by cascading to the next transport.
          if (err.status !== 404) {
            out.errors.push({ name: 'media_links_legacy', error: err.message });
            out.legacyFallback = true;
            served = true;
          }
        }
      }

      // The peer serves no plugin endpoint at all — read its content API directly.
      if (!served && !out.cancelled) {
        out.restFallback = true;
        strapi.log?.warn?.('[data-sync] peer exposes no sync-plugin link endpoints; deriving media links from its content REST API');
        await pullLinksWith((a) => fetchRemoteEntityMediaLinksViaRest(remoteConfig, a));
      }
    }

    // ── PUSH: local owner entities → remote links ───────────────────────────
    if ((direction === 'push' || direction === 'both') && !out.cancelled) {
      if (singleSide) {
        out.errors.push({
          name: 'media_links_push',
          error: 'Media links cannot be pushed in single-side mode: the remote instance does not run this plugin.',
        });
      } else {
        let served = true;
        for (const { uid } of scope) {
          for (let page = 1; ; page += 1) {
            const abort = await checkpoint(pid);
            if (abort?.cancelled) { out.cancelled = true; break; }
            let local;
            try {
              local = await exportEntityMediaLinks({ uid, page, pageSize });
            } catch (err) {
              out.errors.push({ name: `media_links_push:${uid}`, error: err.message });
              break;
            }
            if (local.links.length > 0) {
              try {
                const result = await applyRemoteEntityMediaLinks(remoteConfig, local.links);
                out.pushed += result.applied || 0;
                out.skipped += result.skipped || 0;
                out.unchanged += result.unchanged || 0;
                if (Array.isArray(result.errors) && result.errors.length) {
                  out.errors.push(...result.errors.map((e) => ({ name: `media_links_push:${uid}`, error: e.error || 'remote apply error' })));
                }
              } catch (err) {
                if (err.status === 404) { served = false; break; }
                out.errors.push({ name: `media_links_push:${uid}`, error: err.message });
                break;
              }
            }
            if (!local.hasMore) break;
          }
          if (!served || out.cancelled) break;
        }

        if (!served && !out.cancelled) {
          out.legacyFallback = true;
          strapi.log?.warn?.('[data-sync] peer does not expose entity-media-links; falling back to legacy morph-link push');
          try {
            const applyResult = await applyRemoteMorphLinks(remoteConfig, await exportMorphLinks());
            out.pushed += applyResult.applied || 0;
            out.skipped += applyResult.skipped || 0;
          } catch (err) {
            out.errors.push({ name: 'media_links_legacy', error: err.message });
          }
        }
      }
    }

    return out;
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

  // Stable cross-instance identity for a file. `hash` is NOT usable: the upload
  // service regenerates a random hash on ingest, so a file synced from the peer
  // gets a different hash locally. name + ext + size is stable across instances
  // and is what we match on for dedup.
  function mediaStableKey(f) {
    const name = String(f?.name || '').trim().toLowerCase();
    const ext = String(f?.ext || '').toLowerCase();
    const size = f?.size != null ? String(f.size) : '';
    return `${name}|${ext}|${size}`;
  }

  function shouldSkip(localFile, remoteFile, settings) {
    if (!localFile || !remoteFile) return false;
    // Dedup on size (byte length is stable); hash is regenerated on upload and
    // would otherwise never match, causing the same file to re-import forever.
    if (settings.skipIfSameSize && localFile.size === remoteFile.size) {
      return true;
    }
    return false;
  }

  /**
   * Copy a page of files respecting settings.batchConcurrency.
   * If checkAbort() returns { cancelled: true }, remaining items are skipped.
   */
  async function processBatch(items, worker, concurrency, checkAbort) {
    const out = { success: 0, skipped: 0, errors: [], cancelled: false };
    const c = Math.max(1, Math.min(concurrency || 1, 10));
    let i = 0;
    async function run() {
      while (i < items.length) {
        if (checkAbort) {
          const abort = await checkAbort();
          if (abort && abort.cancelled) { out.cancelled = true; return; }
        }
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

  async function syncMediaViaUrl(profile, globalSettings, options = {}) {
    const settings = { ...globalSettings, ...profile };
    const configService = plugin().service('config');
    const logService = plugin().service('syncLog');
    const remoteConfig = await configService.getConfig({ safe: false });
    if (!remoteConfig?.baseUrl) throw new Error('Remote server not configured');

    // Media follows the same two-pass strategy as content:
    //   pass 1 (core)  — file bytes + upload rows, so files exist as targets
    //   pass 2 (links) — entity→file links, written from the owning entities
    const phases = Array.isArray(options.phases) && options.phases.length
      ? options.phases
      : [MEDIA_PHASE_CORE, MEDIA_PHASE_LINKS];
    const runCore = phases.includes(MEDIA_PHASE_CORE);
    const runLinks = phases.includes(MEDIA_PHASE_LINKS);

    const totals = { pushed: 0, pulled: 0, skipped: 0, dbRowsUpdated: 0, mediaLinksApplied: 0, mediaLinksSkipped: 0, errors: [] };
    const started = Date.now();
    const pid = profile.id;
    const abort = () => checkpoint(pid);

    const localIndex = new Map();
    if (runCore) {
      await updateProgress(pid, { phase: 'indexing-local', processed: 0, total: 0, pushed: 0, pulled: 0, skipped: 0, errors: 0 });
      for await (const batch of iterateLocalFiles(settings.pageSize)) {
        const a = await checkpoint(pid);
        if (a && a.cancelled) { totals.cancelled = true; break; }
        for (const f of batch) localIndex.set(mediaStableKey(f), f);
      }
    }

    // PULL: remote -> local
    if (runCore && !totals.cancelled && (settings.direction === 'pull' || settings.direction === 'both')) {
      await updateProgress(pid, { phase: 'pull' });
      for await (const remoteBatch of iterateRemoteFiles(remoteConfig, settings.pageSize)) {
        const a = await checkpoint(pid);
        if (a && a.cancelled) { totals.cancelled = true; break; }
        const filtered = remoteBatch.filter((f) => passesFilters(f, profile));
        const result = await processBatch(filtered, async (rf) => {
          const key = mediaStableKey(rf);
          const lf = localIndex.get(key);

          // File-byte sync first: uploadBufferToLocal goes through the upload
          // service, which CREATES the file row (with real metadata) itself.
          let didUpload = false;
          if (profile.syncFileBytes) {
            if (!shouldSkip(lf, rf, settings)) {
              if (!settings.dryRun) {
                const buf = await downloadToBuffer(remoteConfig, rf);
                await uploadBufferToLocal(rf, buf);
              }
              didUpload = true;
            }
          }

          // DB-row sync only when the byte upload did NOT already create/refresh
          // the row — otherwise both paths create a row for the same file
          // (the long-standing double-row bug). When bytes are disabled or the
          // file was skipped, this still syncs the metadata row.
          if (profile.syncDbRows && !didUpload) {
            const dbResult = await syncDbRowPull(rf, lf, profile);
            if (dbResult === 'created' || dbResult === 'updated') totals.dbRowsUpdated++;
          }

          if (profile.syncFileBytes && !didUpload) return 'skipped';
          return 'success';
        }, settings.batchConcurrency, abort);
        totals.pulled += result.success;
        totals.skipped += result.skipped;
        totals.errors.push(...result.errors);
        await updateProgress(pid, {
          pulled: totals.pulled,
          skipped: totals.skipped,
          errors: totals.errors.length,
          processed: totals.pulled + totals.pushed + totals.skipped,
        });
        if (result.cancelled) { totals.cancelled = true; break; }
      }
    }

    // PUSH: local -> remote
    if (runCore && !totals.cancelled && (settings.direction === 'push' || settings.direction === 'both')) {
      await updateProgress(pid, { phase: 'push-indexing-remote' });
      const remoteIndex = new Map();
      for await (const remoteBatch of iterateRemoteFiles(remoteConfig, settings.pageSize)) {
        const a = await checkpoint(pid);
        if (a && a.cancelled) { totals.cancelled = true; break; }
        for (const f of remoteBatch) remoteIndex.set(mediaStableKey(f), f);
      }

      if (!totals.cancelled) {
        await updateProgress(pid, { phase: 'push' });
        for await (const localBatch of iterateLocalFiles(settings.pageSize)) {
          const a = await checkpoint(pid);
          if (a && a.cancelled) { totals.cancelled = true; break; }
          const filtered = localBatch.filter((f) => passesFilters(f, profile));
          const result = await processBatch(filtered, async (lf) => {
            const key = mediaStableKey(lf);
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
          }, settings.batchConcurrency, abort);
          totals.pushed += result.success;
          totals.skipped += result.skipped;
          totals.errors.push(...result.errors);
          await updateProgress(pid, {
            pushed: totals.pushed,
            skipped: totals.skipped,
            errors: totals.errors.length,
            processed: totals.pulled + totals.pushed + totals.skipped,
          });
          if (result.cancelled) { totals.cancelled = true; break; }
        }
      }
    }

    // ── Pass 2: owner-side entity → file links ─────────────────────────────
    // Runs only after the files themselves exist as targets. Links are written
    // from the owning content types; the file side is never traversed.
    let links = null;
    if (runLinks && !totals.cancelled) {
      await updateProgress(pid, { phase: 'links' });
      try {
        links = await syncMediaLinks(profile, settings, {
          scopeUids: options.scopeUids || [],
          direction: settings.direction,
        });
        totals.mediaLinksApplied += (links.pulled || 0) + (links.pushed || 0);
        totals.mediaLinksSkipped += links.skipped || 0;
        if (links.errors?.length) totals.errors.push(...links.errors);
        if (links.cancelled) totals.cancelled = true;
      } catch (err) {
        totals.errors.push({ name: 'media_links', error: err.message });
      }
    }

    await updateProgress(pid, { phase: totals.cancelled ? 'cancelled' : 'done' });

    const summary = {
      strategy: 'url',
      profileId: profile.id,
      profileName: profile.name,
      direction: settings.direction,
      phases,
      dryRun: !!settings.dryRun,
      durationMs: Date.now() - started,
      links,
      ...totals,
    };

    await logService?.log?.({
      action: 'media_sync',
      contentType: 'plugin::upload.file',
      direction: settings.direction,
      status: totals.errors.length ? 'partial' : 'success',
      message: `URL media sync [${profile.name}] (${phases.join(' → ')}): pushed=${totals.pushed}, pulled=${totals.pulled}, dbRows=${totals.dbRowsUpdated}, links=${totals.mediaLinksApplied}, skipped=${totals.skipped}, errors=${totals.errors.length}`,
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
    // `--` ends option parsing so a path beginning with `-` can't be treated as
    // an rsync flag. (spawn runs with shell:false, so shell metacharacters in
    // paths are already inert.)
    args.push('--', src, dst);

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

    // Reset run controls for a fresh execution
    const control = getControl(profileId);
    control.signal = 'run';
    control.resumeDeferred = null;
    control.progress = { phase: 'starting', processed: 0, total: 0, pushed: 0, pulled: 0, skipped: 0, errors: 0 };

    const statusData = await store().get({ key: STATUS_KEY }) || {};
    statusData.running = true;
    statusData.runningProfiles = { ...(statusData.runningProfiles || {}), [profileId]: true };
    statusData.progress = { ...(statusData.progress || {}), [profileId]: { ...control.progress } };
    if (statusData.paused) delete statusData.paused[profileId];
    await setStatus(statusData);

    const phases = Array.isArray(options.phases) && options.phases.length
      ? options.phases
      : [MEDIA_PHASE_CORE, MEDIA_PHASE_LINKS];

    try {
      let result;
      if (merged.strategy === 'rsync') {
        // rsync moves bytes only; it has no way to resolve entity→file links
        // (the upload rows it needs are not part of a file-level copy).
        result = await syncMediaViaRsync(merged, globalSettings);
        if (phases.includes(MEDIA_PHASE_LINKS)) {
          result.linksSkipped = 'rsync strategy transfers file bytes only — use the URL strategy to sync entity media links';
        }
      } else {
        result = await syncMediaViaUrl(merged, globalSettings, {
          phases,
          scopeUids: options.scopeUids || [],
        });
      }

      // Update profile last execution
      await updateProfile(profileId, { lastExecutedAt: new Date().toISOString() });

      const s2 = await store().get({ key: STATUS_KEY }) || {};
      delete (s2.runningProfiles || {})[profileId];
      if (s2.paused) delete s2.paused[profileId];
      s2.running = Object.keys(s2.runningProfiles || {}).length > 0;
      s2.lastRunAt = new Date().toISOString();
      s2.lastResult = result;
      await setStatus(s2);

      return result;
    } catch (err) {
      const s2 = await store().get({ key: STATUS_KEY }) || {};
      delete (s2.runningProfiles || {})[profileId];
      if (s2.paused) delete s2.paused[profileId];
      s2.running = Object.keys(s2.runningProfiles || {}).length > 0;
      s2.lastRunAt = new Date().toISOString();
      s2.lastResult = { error: err.message };
      await setStatus(s2);
      throw err;
    }
  }

  /**
   * Run ONE media phase of a profile. Used by the content sync orchestrators so
   * media can be interleaved into the global two-pass ordering: core media with
   * the entities pass, media links with the relations pass.
   *
   * `scopeUids` narrows the link pass to the content types the caller is
   * syncing, so a partial run doesn't rewrite links for types it never touched.
   */
  async function runProfilePhase(profileId, phase, options = {}) {
    return runProfile(profileId, { ...options, phases: [phase] });
  }

  async function pauseProfile(profileId) {
    const c = getControl(profileId);
    if (c.signal === 'cancel') return { ok: false, message: 'Run is cancelling' };
    c.signal = 'pause';
    return { ok: true, signal: c.signal };
  }

  async function resumeProfile(profileId) {
    const c = getControl(profileId);
    if (c.signal !== 'pause') return { ok: false, message: `Run is not paused (signal=${c.signal})` };
    c.signal = 'run';
    if (c.resumeDeferred) { c.resumeDeferred.resolve(); }
    return { ok: true, signal: c.signal };
  }

  async function cancelProfile(profileId) {
    const c = getControl(profileId);
    c.signal = 'cancel';
    if (c.resumeDeferred) { c.resumeDeferred.resolve(); } // unblock any pause wait
    return { ok: true, signal: c.signal };
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
    runProfilePhase,
    runActiveProfiles,
    pauseProfile,
    resumeProfile,
    cancelProfile,

    // Owner-side entity → file link APIs (the current strategy)
    exportEntityMediaLinks,
    applyEntityMediaLinks,
    resolveMediaLinkScope,
    // Single-side transport: same links, read off a plugin-less peer's REST API
    fetchRemoteEntityMediaLinksViaRest,

    // Legacy morph link APIs. No longer part of the strategy — kept so a peer
    // running an older plugin version can still exchange links with this one
    // (see the fallback in syncMediaLinks).
    exportMorphLinks,
    applyMorphLinks,

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
