'use strict';

/**
 * Bulk Transfer service
 * -----------------------------------------------------------------------------
 * Provides one-click "full pull" / "full push" between local and the configured
 * remote across user-selected scopes:
 *   - content  : every user-defined collection type (api::*)
 *   - media    : every active media sync profile (files + morph links)
 *   - users    : plugin::users-permissions.user
 *   - admins   : admin::user
 *
 * A job is expanded into ordered chunks. Each chunk reuses an existing sync
 * primitive (syncContentType or syncMedia.runProfile). The UI can either
 * auto-run chunks to completion or stop after each chunk and wait for the
 * user to advance.
 *
 * Job state is held in memory (single-process). Restarting the server
 * cancels any running job.
 */

const PLUGIN_ID = 'strapi-content-sync-pro';
const HISTORY_STORE_KEY = 'bulk-transfer-history';
const HISTORY_MAX = 25;

// Module-level in-memory job registry. Single active job at a time is enough
// for this workflow; additional jobs may be queued/tracked by id if needed.
const jobs = new Map();

let jobSeq = 1;

function newJobId() {
  return `bulk-${Date.now()}-${jobSeq++}`;
}

function now() {
  return new Date().toISOString();
}

module.exports = ({ strapi }) => {
  function plugin() {
    return strapi.plugin(PLUGIN_ID);
  }

  function getStore() {
    return strapi.store({ type: 'plugin', name: PLUGIN_ID });
  }

  async function readHistory() {
    try {
      return (await getStore().get({ key: HISTORY_STORE_KEY })) || [];
    } catch {
      return [];
    }
  }

  // Serialize history writes. Multiple paths (auto-run loop, pause, status
  // polling, resume) can mutate history concurrently; without a queue the
  // classic read-modify-write pattern loses updates.
  let historyWriteChain = Promise.resolve();
  function queueHistoryWrite(task) {
    const next = historyWriteChain.then(task, task);
    // Swallow rejection on the chain so future tasks still run.
    historyWriteChain = next.catch(() => {});
    return next;
  }

  async function writeHistory(entries) {
    try {
      await getStore().set({ key: HISTORY_STORE_KEY, value: entries.slice(0, HISTORY_MAX) });
    } catch (err) {
      strapi.log?.warn?.(`[bulk-transfer] unable to persist history: ${err.message}`);
    }
  }

  function snapshotForHistory(job) {
    return {
      id: job.id,
      status: job.status,
      direction: job.direction,
      scopes: job.scopes,
      syncDeletions: job.syncDeletions,
      autoContinue: job.autoContinue,
      conflictStrategy: job.conflictStrategy,
      createdAt: job.createdAt,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
      pausedAt: job.pausedAt || null,
      resumedAt: job.resumedAt || null,
      resumedFrom: job.resumedFrom || null,
      cursor: job.cursor,
      total: job.chunks.length,
      errors: job.errors,
      chunks: job.chunks.map((c) => ({
        index: c.index,
        kind: c.kind,
        uid: c.uid || null,
        profileId: c.profileId || null,
        label: c.label,
        // Never persist transient 'running' — if the process is paused or
        // dies mid-chunk, reloaded entry must indicate the chunk needs to
        // be resumed (resumeFromHistory treats non-terminal chunks that way).
        status: c.status === 'running' ? 'paused' : c.status,
        selected: c.selected !== false,
        page: c.page || 0,
        pagesTotal: c.pagesTotal || null,
        pushed: c.pushed || 0,
        pulled: c.pulled || 0,
        errors: c.errors || 0,
        error: c.error || null,
        warning: c.warning || null,
        startedAt: c.startedAt || null,
        completedAt: c.completedAt || null,
      })),
    };
  }

  function persistJobToHistory(job) {
    // Serialize through the write queue so concurrent updaters (auto-run
    // loop, pause/resume, status polling) don't clobber each other. We
    // snapshot inside the queued task to match the in-memory state at
    // serialization time.
    return queueHistoryWrite(async () => {
      const history = await readHistory();
      const snap = snapshotForHistory(job);
      const existingIdx = history.findIndex((h) => h.id === job.id);
      if (existingIdx >= 0) history[existingIdx] = snap;
      else history.unshift(snap);
      await writeHistory(history);
    });
  }

  function listSyncableContentTypeUids() {
    const out = [];
    for (const [uid, ct] of Object.entries(strapi.contentTypes || {})) {
      if (!uid.startsWith('api::')) continue;
      if (ct.kind !== 'collectionType') continue;
      out.push(uid);
    }
    return out;
  }

  function orderByDependencies(uids) {
    const depResolver = plugin().service('dependencyResolver');
    const uidSet = new Set(uids);
    const inDegree = new Map();
    const adjacency = new Map();

    uids.forEach((uid) => {
      inDegree.set(uid, 0);
      adjacency.set(uid, []);
    });

    for (const uid of uids) {
      try {
        const rels = depResolver.analyzeContentType(uid)?.relations || [];
        for (const rel of rels) {
          const depUid = rel.target;
          if (!uidSet.has(depUid) || depUid === uid) continue;
          adjacency.get(depUid).push(uid);
          inDegree.set(uid, (inDegree.get(uid) || 0) + 1);
        }
      } catch (_) {
        // Ignore bad schema and keep fallback order.
      }
    }

    const queue = uids.filter((uid) => (inDegree.get(uid) || 0) === 0);
    const ordered = [];
    while (queue.length > 0) {
      const uid = queue.shift();
      ordered.push(uid);
      for (const next of adjacency.get(uid) || []) {
        const deg = (inDegree.get(next) || 0) - 1;
        inDegree.set(next, deg);
        if (deg === 0) queue.push(next);
      }
    }

    for (const uid of uids) {
      if (!ordered.includes(uid)) ordered.push(uid);
    }
    return ordered;
  }

  function listMediaProfilesToRun() {
    // Use the media service's own active-profile semantics by delegating
    // to runActiveProfiles at execute time; here we just need chunk labels.
    // We expand via getProfiles() to produce per-profile chunks.
    const syncMedia = plugin().service('syncMedia');
    if (!syncMedia?.getProfiles) return Promise.resolve([]);
    return syncMedia.getProfiles();
  }

  async function buildPlan({ direction, scopes }) {
    const chunks = [];

    if (scopes.content) {
      const orderedContentTypes = orderByDependencies(listSyncableContentTypeUids());
      for (const uid of orderedContentTypes) {
        chunks.push({ kind: 'content', uid, label: uid });
      }
    }

    if (scopes.users) {
      const uid = 'plugin::users-permissions.user';
      if (strapi.contentTypes?.[uid]) {
        chunks.push({ kind: 'users', uid, label: uid });
      }
    }

    if (scopes.admins) {
      const uid = 'admin::user';
      if (strapi.contentTypes?.[uid]) {
        chunks.push({
          kind: 'admins',
          uid,
          label: uid,
          warning: 'admin::user transfer is best-effort; passwords/roles may not be portable.',
        });
      }
    }

    if (scopes.media) {
      const profiles = await listMediaProfilesToRun();
      const active = (profiles || []).filter((p) => p.active && p.strategy !== 'disabled');
      if (active.length === 0) {
        chunks.push({
          kind: 'media',
          profileId: null,
          label: 'media:active',
          warning: 'No active media profiles found. Activate one in the Media tab first.',
        });
      } else {
        for (const p of active) {
          chunks.push({ kind: 'media', profileId: p.id, label: `media:${p.name || p.id}` });
        }
      }
    }

    // Tag index on each chunk so the UI can track progress reliably.
    chunks.forEach((c, i) => {
      c.index = i;
      c.status = 'pending';
      c.selected = true;
    });

    return chunks;
  }

  async function runContentChunk(job, chunk) {
    const syncService = plugin().service('sync');
    const syntheticProfile = {
      id: `bulk-${job.id}`,
      name: `Bulk ${job.direction}`,
      contentType: chunk.uid,
      direction: job.direction, // 'pull' or 'push'
      conflictStrategy: job.conflictStrategy || 'latest',
      isSimple: true,
      syncDeletions: !!job.syncDeletions,
    };

    // Initialize per-chunk page progress (resumable across pause cycles).
    chunk.page = chunk.page || 0;                 // last completed page
    chunk.pushed = chunk.pushed || 0;
    chunk.pulled = chunk.pulled || 0;
    chunk.errors = chunk.errors || 0;
    chunk.pageSize = chunk.pageSize || job.pageSize || null;
    chunk.pagesTotal = chunk.pagesTotal || null;  // populated after first page

    let hasMore = true;
    while (hasMore) {
      if (job.status !== 'running') {
        // Paused or cancelled: stop between pages so next resume picks up.
        return {
          paused: job.status === 'paused',
          cancelled: job.status === 'cancelled',
          page: chunk.page,
          pagesTotal: chunk.pagesTotal,
          pushed: chunk.pushed,
          pulled: chunk.pulled,
          errors: chunk.errors,
        };
      }

      const nextPage = chunk.page + 1;
      const res = await syncService.syncContentTypePage(chunk.uid, {
        profile: syntheticProfile,
        page: nextPage,
        pageSize: chunk.pageSize || undefined,
      });

      chunk.page = res.page;
      chunk.pageSize = res.pageSize;
      chunk.pushed += res.pushed;
      chunk.pulled += res.pulled;
      chunk.errors += res.errors;
      if (res.remotePageCount && !chunk.pagesTotal) {
        chunk.pagesTotal = res.remotePageCount;
      }
      chunk.lastPageAt = now();
      hasMore = !!res.hasMore;
    }

    return {
      page: chunk.page,
      pagesTotal: chunk.pagesTotal,
      pushed: chunk.pushed,
      pulled: chunk.pulled,
      errors: chunk.errors,
    };
  }

  async function runMediaChunk(job, chunk) {
    const syncMedia = plugin().service('syncMedia');
    if (!chunk.profileId) {
      // No active media profile; skip with a clear status.
      return { skipped: true, reason: chunk.warning || 'No media profile to run' };
    }

    // Media sync is not paginated internally — it runs as one long call per
    // profile. Mark the chunk as "page 1 of 1" so the UI shows progress
    // instead of a stale 0/0 while the job is working.
    chunk.pageSize = chunk.pageSize || null;
    chunk.page = 0;
    chunk.pagesTotal = 1;
    chunk.pushed = chunk.pushed || 0;
    chunk.pulled = chunk.pulled || 0;
    chunk.errors = chunk.errors || 0;
    chunk.lastPageAt = now();

    let summary;
    if (syncMedia.runProfile) {
      summary = await syncMedia.runProfile(chunk.profileId);
    } else if (syncMedia.run) {
      summary = await syncMedia.run({ profileId: chunk.profileId });
    } else {
      throw new Error('Media sync service does not expose runProfile/run');
    }

    // Normalize media summary onto chunk counters so summarize() (and the
    // admin UI) surfaces runtime stats for media chunks the same way it
    // does for content chunks.
    const pushed = Number(summary?.pushed) || 0;
    const pulled = Number(summary?.pulled) || 0;
    const dbRowsUpdated = Number(summary?.dbRowsUpdated) || 0;
    const morphLinksApplied = Number(summary?.morphLinksApplied) || 0;
    const errorsArr = Array.isArray(summary?.errors) ? summary.errors : [];

    // For media, "pushed/pulled" from the summary reflect file-byte ops.
    // Add DB row and morph link updates into the directional counter so
    // the UI's total isn't misleadingly zero for DB-rows-only profiles.
    if (job.direction === 'push') {
      chunk.pushed += pushed + dbRowsUpdated + morphLinksApplied;
    } else {
      chunk.pulled += pulled + dbRowsUpdated + morphLinksApplied;
    }
    chunk.errors += errorsArr.length;
    chunk.page = 1;
    chunk.pagesTotal = 1;
    chunk.lastPageAt = now();

    return {
      ...summary,
      pushed: chunk.pushed,
      pulled: chunk.pulled,
      errors: chunk.errors,
      page: chunk.page,
      pagesTotal: chunk.pagesTotal,
    };
  }

  async function executeChunk(job, chunk) {
    // When resuming a paused chunk, keep its accumulated progress.
    if (chunk.status !== 'paused') {
      chunk.status = 'running';
      chunk.startedAt = chunk.startedAt || now();
    } else {
      chunk.status = 'running';
    }
    try {
      let result;
      switch (chunk.kind) {
        case 'content':
        case 'users':
        case 'admins':
          result = await runContentChunk(job, chunk);
          break;
        case 'media':
          result = await runMediaChunk(job, chunk);
          break;
        default:
          throw new Error(`Unknown chunk kind: ${chunk.kind}`);
      }
      if (result?.paused) {
        chunk.status = 'paused';
        chunk.result = result;
        return { paused: true };
      }
      if (result?.cancelled) {
        // Leave the chunk in 'paused' state so its progress is preserved
        // and a future resume-from-history can pick it up.
        chunk.status = 'paused';
        chunk.result = result;
        return { cancelled: true };
      }
      chunk.status = result?.skipped ? 'skipped' : 'success';
      chunk.result = result || null;
    } catch (err) {
      chunk.status = 'error';
      chunk.error = err.message;
      job.errors.push({ index: chunk.index, label: chunk.label, error: err.message });
    } finally {
      if (chunk.status !== 'paused') {
        chunk.completedAt = now();
      }
    }
    return { paused: false };
  }

  async function assertRemoteConfigured() {
    const config = await plugin().service('config').getConfig({ safe: false });
    if (!config || !config.baseUrl) {
      throw new Error('Remote server not configured');
    }
    return config;
  }

  return {
    /**
     * POST /bulk-transfer/start
     * body: { direction: 'pull'|'push', scopes: {content,media,users,admins},
     *         syncDeletions, autoContinue, conflictStrategy? }
     */
    async start(options = {}) {
      const direction = options.direction === 'push' ? 'push' : 'pull';
      const scopes = {
        content: !!options?.scopes?.content,
        media: !!options?.scopes?.media,
        users: !!options?.scopes?.users,
        admins: !!options?.scopes?.admins,
      };
      if (!scopes.content && !scopes.media && !scopes.users && !scopes.admins) {
        throw new Error('Select at least one scope (content, media, users, admins).');
      }

      // Single-side mode: only pull is allowed.
      const pluginConfig = await plugin().service('config').getConfig({ safe: false });
      if (pluginConfig?.syncMode === 'single_side' && direction !== 'pull') {
        throw new Error('Single-side mode only supports pull bulk transfers.');
      }

      await assertRemoteConfigured();

      const chunks = await buildPlan({ direction, scopes });
      if (chunks.length === 0) {
        throw new Error('No chunks produced for the selected scopes.');
      }

      // Apply user-selected subset if provided. `selectedIndexes` is a list
      // of chunk indexes the user explicitly wants to run. Anything outside
      // the set is marked skipped so the cursor can walk over them cheaply
      // while the UI still shows the full plan.
      const selectedIndexes = Array.isArray(options.selectedIndexes)
        ? new Set(options.selectedIndexes.map((n) => Number(n)))
        : null;
      if (selectedIndexes && selectedIndexes.size > 0) {
        let anySelected = false;
        for (const c of chunks) {
          const sel = selectedIndexes.has(c.index);
          c.selected = sel;
          if (!sel) c.status = 'skipped';
          else anySelected = true;
        }
        if (!anySelected) {
          throw new Error('No chunks selected to run.');
        }
      }

      // Create a run report that the Stats tab will surface.
      const syncStats = plugin().service('syncStats');
      let reportHandle = null;
      if (syncStats?.createRunReport) {
        reportHandle = await syncStats.createRunReport({
          runType: 'bulk_transfer',
          trigger: `bulk_${direction}`,
          contentTypes: chunks.map((c) => c.label),
        });
      }

      const job = {
        id: newJobId(),
        direction,
        scopes,
        syncDeletions: !!options.syncDeletions,
        autoContinue: !!options.autoContinue,
        conflictStrategy: options.conflictStrategy || 'latest',
        pageSize: Number(options.pageSize) || null,
        status: 'running',
        createdAt: now(),
        startedAt: now(),
        completedAt: null,
        chunks,
        cursor: 0,
        errors: [],
        reportId: reportHandle?.reportId || null,
      };
      jobs.set(job.id, job);
      await persistJobToHistory(job);

      // Auto-run in background; each chunk runs sequentially.
      if (job.autoContinue) {
        this.runToCompletion(job.id).catch((err) => {
          strapi.log?.error?.(`[bulk-transfer] auto-run failed: ${err.message}`);
        });
      }

      return this.summarize(job);
    },

    /**
     * POST /bulk-transfer/:jobId/next
     * Manually run the next pending chunk (when autoContinue is false).
     */
    async next(jobId) {
      const job = jobs.get(jobId);
      if (!job) throw new Error('Job not found');
      if (job.status !== 'running') throw new Error(`Job is ${job.status}`);
      // Skip over any deselected chunks without running them.
      while (job.cursor < job.chunks.length && job.chunks[job.cursor].selected === false) {
        job.chunks[job.cursor].status = 'skipped';
        job.cursor += 1;
      }
      if (job.cursor >= job.chunks.length) {
        await this.finish(job);
        return this.summarize(job);
      }
      const chunk = job.chunks[job.cursor];
      const r = await executeChunk(job, chunk);
      if (!r.paused && !r.cancelled) {
        job.cursor += 1;
      }
      if (job.cursor >= job.chunks.length) await this.finish(job);
      await persistJobToHistory(job);
      return this.summarize(job);
    },

    /**
     * Run all remaining chunks without stopping.
     */
    async runToCompletion(jobId) {
      const job = jobs.get(jobId);
      if (!job) throw new Error('Job not found');
      while (job.status === 'running' && job.cursor < job.chunks.length) {
        const chunk = job.chunks[job.cursor];
        if (chunk.selected === false) {
          chunk.status = 'skipped';
          job.cursor += 1;
          continue;
        }
        // eslint-disable-next-line no-await-in-loop
        const r = await executeChunk(job, chunk);
        // eslint-disable-next-line no-await-in-loop
        await persistJobToHistory(job);
        if (r.paused || r.cancelled) break;
        job.cursor += 1;
      }
      if (job.status === 'running' && job.cursor >= job.chunks.length) await this.finish(job);
      await persistJobToHistory(job);
      return this.summarize(job);
    },

    async finish(job) {
      job.status = job.errors.length > 0 ? 'partial' : 'success';
      job.completedAt = now();

      const syncStats = plugin().service('syncStats');
      if (job.reportId && syncStats?.completeRunReport) {
        await syncStats.completeRunReport(job.reportId, {
          status: job.errors.length > 0 ? 'partial' : 'success',
          summary: {
            direction: job.direction,
            scopes: job.scopes,
            syncDeletions: job.syncDeletions,
            chunks: job.chunks.map((c) => ({
              label: c.label,
              status: c.status,
              error: c.error || null,
            })),
          },
          error: job.errors.length > 0 ? `${job.errors.length} chunk(s) failed` : null,
        });
      }
      await persistJobToHistory(job);
    },

    async cancel(jobId) {
      const job = jobs.get(jobId);
      if (!job) throw new Error('Job not found');
      if (job.status === 'running' || job.status === 'paused') {
        job.status = 'cancelled';
        job.completedAt = now();
        const syncStats = plugin().service('syncStats');
        if (job.reportId && syncStats?.completeRunReport) {
          await syncStats.completeRunReport(job.reportId, {
            status: 'error',
            summary: null,
            error: 'cancelled by user',
          });
        }
        await persistJobToHistory(job);
      }
      return this.summarize(job);
    },

    /**
     * Request a pause. The currently running chunk will exit at the next
     * page boundary. `next` / `resume` can then re-enter the same chunk
     * and pick up from the last completed page.
     */
    async pause(jobId) {
      const job = jobs.get(jobId);
      if (!job) throw new Error('Job not found');
      if (job.status === 'running') {
        job.status = 'paused';
        job.pausedAt = now();
        await persistJobToHistory(job);
      }
      return this.summarize(job);
    },

    /**
     * Resume a paused job. If autoContinue was set, resumes the background
     * run-to-completion loop; otherwise the UI will drive via `next`.
     */
    async resume(jobId) {
      const job = jobs.get(jobId);
      if (!job) throw new Error('Job not found');
      if (job.status !== 'paused') throw new Error(`Job is ${job.status}`);
      job.status = 'running';
      job.resumedAt = now();
      await persistJobToHistory(job);
      if (job.autoContinue) {
        this.runToCompletion(job.id).catch((err) => {
          strapi.log?.error?.(`[bulk-transfer] resume auto-run failed: ${err.message}`);
        });
      }
      return this.summarize(job);
    },

    getStatus(jobId) {
      const job = jobs.get(jobId);
      if (!job) return null;
      return this.summarize(job);
    },

    listJobs() {
      return [...jobs.values()].map((j) => this.summarize(j));
    },

    summarize(job) {
      return {
        id: job.id,
        status: job.status,
        direction: job.direction,
        scopes: job.scopes,
        syncDeletions: job.syncDeletions,
        autoContinue: job.autoContinue,
        cursor: job.cursor,
        total: job.chunks.length,
        createdAt: job.createdAt,
        startedAt: job.startedAt,
        completedAt: job.completedAt,
        errors: job.errors,
        chunks: job.chunks.map((c) => ({
          index: c.index,
          kind: c.kind,
          uid: c.uid || null,
          profileId: c.profileId || null,
          label: c.label,
          status: c.status,
          selected: c.selected !== false,
          error: c.error || null,
          warning: c.warning || null,
          startedAt: c.startedAt || null,
          completedAt: c.completedAt || null,
          page: c.page || 0,
          pagesTotal: c.pagesTotal || null,
          pageSize: c.pageSize || null,
          pushed: c.pushed || 0,
          pulled: c.pulled || 0,
          errors: c.errors || 0,
        })),
      };
    },

    /**
     * Return a preview plan without creating a job. Used by the UI to show
     * chunk counts before starting.
     */
    async preview({ direction, scopes }) {
      const chunks = await buildPlan({
        direction: direction === 'push' ? 'push' : 'pull',
        scopes: {
          content: !!scopes?.content,
          media: !!scopes?.media,
          users: !!scopes?.users,
          admins: !!scopes?.admins,
        },
      });
      return { total: chunks.length, chunks };
    },

    /**
     * Return the persisted bulk-transfer run history. Used by the admin UI
     * to let the user review previous runs and restart a new one using the
     * same (or adjusted) chunk selection.
     */
    async getHistory() {
      const history = await readHistory();
      return { total: history.length, items: history };
    },

    async clearHistory() {
      await writeHistory([]);
      return { total: 0, items: [] };
    },

    /**
     * Create a new job from a persisted history entry. By default the
     * previously selected chunks are reused, but the caller can override
     * `selectedIndexes`, `direction`, `scopes`, etc.
     *
     * Restart always starts from scratch (cursor = 0, fresh counters); the
     * prior job remains in history as a separate record.
     */
    async restart(historyId, overrides = {}) {
      const history = await readHistory();
      const source = history.find((h) => h.id === historyId);
      if (!source) throw new Error('History entry not found');

      const previouslySelected = (source.chunks || [])
        .filter((c) => c.selected !== false)
        .map((c) => c.index);

      return this.start({
        direction: overrides.direction || source.direction,
        scopes: overrides.scopes || source.scopes,
        syncDeletions: overrides.syncDeletions ?? source.syncDeletions,
        autoContinue: overrides.autoContinue ?? source.autoContinue,
        conflictStrategy: overrides.conflictStrategy || source.conflictStrategy,
        selectedIndexes: Array.isArray(overrides.selectedIndexes)
          ? overrides.selectedIndexes
          : previouslySelected,
      });
    },

    /**
     * Resume a run that was persisted to history (including across server
     * restarts). Rehydrates the chunk plan, carrying forward completed /
     * skipped chunks and the paused chunk's page progress so execution
     * picks up exactly where it left off.
     *
     * Only valid when the source run ended in a non-terminal state
     * (paused / cancelled). For success / partial runs, use restart().
     */
    async resumeFromHistory(historyId, overrides = {}) {
      const history = await readHistory();
      const source = history.find((h) => h.id === historyId);
      if (!source) throw new Error('History entry not found');
      if (['success', 'partial'].includes(source.status)) {
        throw new Error(`Run already ${source.status}; use restart instead.`);
      }

      await assertRemoteConfigured();

      // Rebuild the plan from the same scopes so chunk targets still exist.
      const direction = source.direction === 'push' ? 'push' : 'pull';
      const freshChunks = await buildPlan({ direction, scopes: source.scopes });

      // Merge prior per-chunk state onto the fresh plan by (kind,label).
      // Completed / skipped chunks stay that way; paused chunks keep their
      // page / counters so runContentChunk resumes on the next page.
      const byKey = new Map(
        (source.chunks || []).map((c) => [`${c.kind}::${c.label}`, c])
      );

      let cursor = 0;
      let cursorSet = false;
      freshChunks.forEach((fresh, i) => {
        const prior = byKey.get(`${fresh.kind}::${fresh.label}`);
        if (!prior) return;
        fresh.selected = prior.selected !== false;
        // Carry forward running counters
        fresh.page = prior.page || 0;
        fresh.pagesTotal = prior.pagesTotal || null;
        fresh.pushed = prior.pushed || 0;
        fresh.pulled = prior.pulled || 0;
        fresh.errors = prior.errors || 0;
        fresh.startedAt = prior.startedAt || null;
        // Decide chunk status for resume:
        //  - success/skipped/error: keep terminal, don't re-run
        //  - paused: reset to pending so executeChunk re-enters; progress kept
        //  - running (server died mid-run): treat as paused to resume safely
        //  - pending: stay pending
        if (['success', 'skipped', 'error'].includes(prior.status)) {
          fresh.status = prior.status;
          fresh.completedAt = prior.completedAt || null;
          fresh.error = prior.error || null;
        } else {
          fresh.status = 'pending';
          if (!cursorSet) {
            cursor = i;
            cursorSet = true;
          }
        }
      });

      // If every chunk is already terminal, there's nothing to resume.
      if (!cursorSet) {
        throw new Error('Nothing to resume — all chunks already finished.');
      }

      // Apply selection override if provided.
      if (Array.isArray(overrides.selectedIndexes)) {
        const set = new Set(overrides.selectedIndexes.map((n) => Number(n)));
        for (const c of freshChunks) c.selected = set.has(c.index);
      }

      const syncStats = plugin().service('syncStats');
      const reportHandle = syncStats?.createRunReport
        ? await syncStats.createRunReport({
            runType: 'bulk_transfer',
            trigger: `bulk_transfer_resume_${direction}`,
            contentTypes: freshChunks.filter((c) => c.uid).map((c) => c.uid),
          })
        : null;

      const job = {
        id: newJobId(),
        status: 'running',
        direction,
        scopes: source.scopes,
        syncDeletions: !!source.syncDeletions,
        autoContinue: overrides.autoContinue ?? !!source.autoContinue,
        conflictStrategy: overrides.conflictStrategy || source.conflictStrategy || 'latest',
        cursor,
        chunks: freshChunks,
        errors: [],
        createdAt: now(),
        startedAt: now(),
        completedAt: null,
        reportId: reportHandle?.reportId || null,
        resumedFrom: source.id,
      };

      jobs.set(job.id, job);
      await persistJobToHistory(job);

      if (job.autoContinue) {
        this.runToCompletion(job.id).catch((err) => {
          strapi.log?.error?.(`[bulk-transfer] resume-from-history auto-run failed: ${err.message}`);
        });
      }

      // Include the rehydrated form state so the admin UI can restore
      // direction / scopes / selection exactly as they were when the run
      // was paused. This makes resume visually "pick up where it left off".
      const summary = this.summarize(job);
      summary.restoredState = {
        direction,
        scopes: { ...source.scopes },
        syncDeletions: !!source.syncDeletions,
        autoContinue: job.autoContinue,
        conflictStrategy: job.conflictStrategy,
        selectedIndexes: freshChunks.filter((c) => c.selected !== false).map((c) => c.index),
      };
      return summary;
    },
  };
};
