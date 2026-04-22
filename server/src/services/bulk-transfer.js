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

  function listSyncableContentTypeUids() {
    const out = [];
    for (const [uid, ct] of Object.entries(strapi.contentTypes || {})) {
      if (!uid.startsWith('api::')) continue;
      if (ct.kind !== 'collectionType') continue;
      out.push(uid);
    }
    return out;
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
      for (const uid of listSyncableContentTypeUids()) {
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
    if (syncMedia.runProfile) {
      return syncMedia.runProfile(chunk.profileId);
    }
    if (syncMedia.run) {
      return syncMedia.run({ profileId: chunk.profileId });
    }
    throw new Error('Media sync service does not expose runProfile/run');
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
      if (job.cursor >= job.chunks.length) {
        await this.finish(job);
        return this.summarize(job);
      }
      const chunk = job.chunks[job.cursor];
      const r = await executeChunk(job, chunk);
      if (!r.paused) {
        job.cursor += 1;
      }
      if (job.cursor >= job.chunks.length) await this.finish(job);
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
        // eslint-disable-next-line no-await-in-loop
        const r = await executeChunk(job, chunk);
        if (r.paused) break;
        job.cursor += 1;
      }
      if (job.status === 'running' && job.cursor >= job.chunks.length) await this.finish(job);
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
          label: c.label,
          status: c.status,
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
  };
};
