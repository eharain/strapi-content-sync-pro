'use strict';

const { fetchLocalRecords, fetchRemoteRecords, fetchLocalPage, fetchRemotePage } = require('../utils/fetcher');
const { compareRecords } = require('../utils/comparator');
const { applyLocal, applyRemote, deleteLocal, deleteRemote } = require('../utils/applier');

const LAST_SYNC_STORE_KEY = 'last-sync-timestamps';

module.exports = ({ strapi }) => {
  function getStore() {
    return strapi.store({ type: 'plugin', name: 'strapi-content-sync-pro' });
  }

  function plugin() {
    return strapi.plugin('strapi-content-sync-pro');
  }

  async function getLastSyncTimestamps() {
    const store = getStore();
    return (await store.get({ key: LAST_SYNC_STORE_KEY })) || {};
  }

  async function setLastSyncTimestamp(uid, timestamp) {
    const store = getStore();
    const timestamps = await getLastSyncTimestamps();
    timestamps[uid] = timestamp;
    await store.set({ key: LAST_SYNC_STORE_KEY, value: timestamps });
  }

  return {
    /**
     * Step 6 + 7 + 10 — Execute a manual / incremental sync for every
     * enabled content type.
     * 
     * Now supports field-level policies from Sync Profiles.
     */
    async syncNow() {
      const logService = plugin().service('syncLog');
      const configService = plugin().service('config');
      const syncConfigService = plugin().service('syncConfig');
      const syncProfilesService = plugin().service('syncProfiles');
      const dependencyResolver = plugin().service('dependencyResolver');
      const executionService = plugin().service('syncExecution');

      const remoteConfig = await configService.getConfig({ safe: false });
      if (!remoteConfig || !remoteConfig.baseUrl) {
        throw new Error('Remote server not configured');
      }

      const syncConfig = await syncConfigService.getSyncConfig();
      const enabledTypes = (syncConfig.contentTypes || []).filter((ct) => ct.enabled);

      // Reorder enabled types so dependency targets are processed before
      // dependents. This improves relation consistency during full sync.
      const enabledSet = new Set(enabledTypes.map((ct) => ct.uid));
      const inDegree = new Map();
      const adjacency = new Map();
      enabledTypes.forEach((ct) => {
        inDegree.set(ct.uid, 0);
        adjacency.set(ct.uid, []);
      });
      for (const ct of enabledTypes) {
        try {
          const rels = dependencyResolver.analyzeContentType(ct.uid)?.relations || [];
          for (const rel of rels) {
            const depUid = rel.target;
            if (!enabledSet.has(depUid) || depUid === ct.uid) continue;
            adjacency.get(depUid).push(ct.uid);
            inDegree.set(ct.uid, (inDegree.get(ct.uid) || 0) + 1);
          }
        } catch (_) {
          // Ignore schema parse failures and keep original order fallback.
        }
      }
      const queue = enabledTypes.map((ct) => ct.uid).filter((uid) => (inDegree.get(uid) || 0) === 0);
      const orderedUids = [];
      while (queue.length > 0) {
        const uid = queue.shift();
        orderedUids.push(uid);
        for (const next of adjacency.get(uid) || []) {
          const deg = (inDegree.get(next) || 0) - 1;
          inDegree.set(next, deg);
          if (deg === 0) queue.push(next);
        }
      }
      // Cycle fallback: append any remaining in original order.
      for (const ct of enabledTypes) {
        if (!orderedUids.includes(ct.uid)) orderedUids.push(ct.uid);
      }
      const enabledTypesOrdered = orderedUids
        .map((uid) => enabledTypes.find((ct) => ct.uid === uid))
        .filter(Boolean);

      // Pagination — remote + local fetches are chunked to keep memory bounded
      // for large datasets. Page size is a global setting tunable in the Sync tab.
      const globalExec = (await executionService.getGlobalSettings?.()) || {};

      const syncStatsService = plugin().service('syncStats');
      const reportHandle = await syncStatsService.createRunReport({
        runType: 'sync_now',
        trigger: 'manual_sync_now',
        contentTypes: enabledTypesOrdered.map((ct) => ct.uid),
      });

      try {
        if (enabledTypes.length === 0) {
          throw new Error('No content types configured for sync');
        }

        const pageSize = Number(globalExec.syncPageSize) || 100;

        const timestamps = await getLastSyncTimestamps();
        const conflictStrategy = syncConfig.conflictStrategy || 'latest';
        const results = [];

        for (const ctConfig of enabledTypesOrdered) {
          const { uid, direction, fields } = ctConfig;
          const lastSyncAt = timestamps[uid] || null;
          const syncStartTime = new Date().toISOString();

          // Get field-level policies from active profile (if any)
          const fieldPolicies = await syncProfilesService.getFieldPoliciesForContentType(uid);

          try {
            // Both sides are fetched in pages of `pageSize` records under the
            // hood (see utils/fetcher.js). We aggregate per content-type because
            // the comparator needs the full set to diff by syncId, but each
            // network/DB call still only returns a bounded chunk.
            const localRecords = await fetchLocalRecords(strapi, uid, { fields, lastSyncAt, pageSize });
            const remoteRecords = await fetchRemoteRecords(remoteConfig, uid, { fields, lastSyncAt, pageSize });

            const profileForOptions = await syncProfilesService.getActiveProfileForContentType(uid);
            const syncDeletions = !!(profileForOptions?.syncDeletions);

            const diff = compareRecords(localRecords, remoteRecords, {
              direction,
              conflictStrategy,
              syncDeletions,
            });

            let pushed = 0;
            let pulled = 0;
            let errors = 0;

            // Apply field policies to records before pushing/pulling
            for (const { local } of diff.toPush) {
              try {
                const filteredRecord = syncProfilesService.filterFieldsByPolicy(local, fieldPolicies, 'push');
                await applyRemote(remoteConfig, uid, filteredRecord, fields);
                pushed++;
              } catch (err) {
                errors++;
                await logService.log({ action: 'push', contentType: uid, syncId: local.syncId, direction: 'push', status: 'error', message: err.message });
              }
            }

            for (const { remote } of diff.toPull) {
              try {
                const filteredRecord = syncProfilesService.filterFieldsByPolicy(remote, fieldPolicies, 'pull');
                await applyLocal(strapi, uid, filteredRecord, fields);
                pulled++;
              } catch (err) {
                errors++;
                await logService.log({ action: 'pull', contentType: uid, syncId: remote.syncId, direction: 'pull', status: 'error', message: err.message });
              }
            }

            for (const record of diff.toCreateRemote) {
              try {
                const filteredRecord = syncProfilesService.filterFieldsByPolicy(record, fieldPolicies, 'push');
                await applyRemote(remoteConfig, uid, filteredRecord, fields);
                pushed++;
              } catch (err) {
                errors++;
                await logService.log({ action: 'create_remote', contentType: uid, syncId: record.syncId, direction: 'push', status: 'error', message: err.message });
              }
            }

            for (const record of diff.toCreateLocal) {
              try {
                const filteredRecord = syncProfilesService.filterFieldsByPolicy(record, fieldPolicies, 'pull');
                await applyLocal(strapi, uid, filteredRecord, fields);
                pulled++;
              } catch (err) {
                errors++;
                await logService.log({ action: 'create_local', contentType: uid, syncId: record.syncId, direction: 'pull', status: 'error', message: err.message });
              }
            }

            for (const record of diff.toDeleteRemote) {
              try {
                await deleteRemote(remoteConfig, uid, record);
                await logService.log({ action: 'delete_remote', contentType: uid, syncId: record.syncId, direction: 'push', status: 'success', message: `Deleted remote record ${record.syncId}` });
              } catch (err) {
                errors++;
                await logService.log({ action: 'delete_remote', contentType: uid, syncId: record.syncId, direction: 'push', status: 'error', message: err.message });
              }
            }

            for (const record of diff.toDeleteLocal) {
              try {
                await deleteLocal(strapi, uid, record);
                await logService.log({ action: 'delete_local', contentType: uid, syncId: record.syncId, direction: 'pull', status: 'success', message: `Deleted local record ${record.syncId}` });
              } catch (err) {
                errors++;
                await logService.log({ action: 'delete_local', contentType: uid, syncId: record.syncId, direction: 'pull', status: 'error', message: err.message });
              }
            }

            await setLastSyncTimestamp(uid, syncStartTime);

            const summary = { uid, pushed, pulled, errors, hasFieldPolicies: !!fieldPolicies };
            results.push(summary);

            await logService.log({
              action: 'sync_complete',
              contentType: uid,
              direction,
              status: errors > 0 ? 'partial' : 'success',
              message: `Pushed: ${pushed}, Pulled: ${pulled}, Errors: ${errors}${fieldPolicies ? ' (with field policies)' : ''}`,
              details: summary,
            });
          } catch (err) {
            results.push({ uid, error: err.message });
            await logService.log({
              action: 'sync_error',
              contentType: uid,
              direction,
              status: 'error',
              message: err.message,
            });
          }
        }

        const response = { syncedAt: new Date().toISOString(), results };
        await syncStatsService.completeRunReport(reportHandle.reportId, {
          status: 'success',
          summary: response,
        });
        await plugin().service('syncLog').applyRetention({ maxLogs: globalExec.maxLogEntries });
        await syncStatsService.applyRetention({ maxReports: globalExec.maxReportEntries });
        return response;
      } catch (err) {
        await syncStatsService.completeRunReport(reportHandle.reportId, {
          status: 'error',
          summary: null,
          error: err.message,
        });
        await plugin().service('syncLog').applyRetention({ maxLogs: globalExec.maxLogEntries });
        await syncStatsService.applyRetention({ maxReports: globalExec.maxReportEntries });
        throw err;
      }
    },

    /**
     * Sync a single content type using a given profile.
     * Called by the execution service (on-demand / scheduled / live runs).
     *
     * options:
     *   - profile: sync profile { contentType, direction, conflictStrategy, isSimple, fieldPolicies }
     *   - syncDependencies: boolean (currently informational; dependency resolution handled upstream)
     *   - dependencyDepth: number
     */
    async syncContentType(uid, options = {}) {
      if (!uid) {
        throw new Error('Content type uid is required');
      }

      const logService = plugin().service('syncLog');
      const configService = plugin().service('config');
      const syncConfigService = plugin().service('syncConfig');
      const syncProfilesService = plugin().service('syncProfiles');
      const executionService = plugin().service('syncExecution');

      const remoteConfig = await configService.getConfig({ safe: false });
      if (!remoteConfig || !remoteConfig.baseUrl) {
        throw new Error('Remote server not configured');
      }

      const { profile } = options;
      const syncConfig = await syncConfigService.getSyncConfig();
      const ctConfig = (syncConfig.contentTypes || []).find((ct) => ct.uid === uid) || { uid, fields: [] };

      const direction = profile?.direction || ctConfig.direction || 'both';
      const conflictStrategy = profile?.conflictStrategy || syncConfig.conflictStrategy || 'latest';
      const syncDeletions = !!(profile?.syncDeletions);
      const fields = ctConfig.fields || [];

      // Field-level policies: prefer the policies on the provided profile,
      // otherwise fall back to the active profile for the content type.
      let fieldPolicies = null;
      if (profile) {
        if (!profile.isSimple && Array.isArray(profile.fieldPolicies) && profile.fieldPolicies.length > 0) {
          fieldPolicies = {};
          for (const fp of profile.fieldPolicies) {
            fieldPolicies[fp.field] = fp.direction;
          }
        }
      } else {
        fieldPolicies = await syncProfilesService.getFieldPoliciesForContentType(uid);
      }

      const globalExec = (await executionService.getGlobalSettings?.()) || {};
      const pageSize = Number(globalExec.syncPageSize) || 100;

      const timestamps = await getLastSyncTimestamps();
      const lastSyncAt = timestamps[uid] || null;
      const syncStartTime = new Date().toISOString();

      let pushed = 0;
      let pulled = 0;
      let errors = 0;

      try {
        const localRecords = await fetchLocalRecords(strapi, uid, { fields, lastSyncAt, pageSize });
        const remoteRecords = await fetchRemoteRecords(remoteConfig, uid, { fields, lastSyncAt, pageSize });

        const diff = compareRecords(localRecords, remoteRecords, { direction, conflictStrategy, syncDeletions });

        for (const { local } of diff.toPush) {
          try {
            const filteredRecord = syncProfilesService.filterFieldsByPolicy(local, fieldPolicies, 'push');
            await applyRemote(remoteConfig, uid, filteredRecord, fields);
            pushed++;
          } catch (err) {
            errors++;
            await logService.log({ action: 'push', contentType: uid, syncId: local.syncId, direction: 'push', status: 'error', message: err.message });
          }
        }

        for (const { remote } of diff.toPull) {
          try {
            const filteredRecord = syncProfilesService.filterFieldsByPolicy(remote, fieldPolicies, 'pull');
            await applyLocal(strapi, uid, filteredRecord, fields);
            pulled++;
          } catch (err) {
            errors++;
            await logService.log({ action: 'pull', contentType: uid, syncId: remote.syncId, direction: 'pull', status: 'error', message: err.message });
          }
        }

        for (const record of diff.toCreateRemote) {
          try {
            const filteredRecord = syncProfilesService.filterFieldsByPolicy(record, fieldPolicies, 'push');
            await applyRemote(remoteConfig, uid, filteredRecord, fields);
            pushed++;
          } catch (err) {
            errors++;
            await logService.log({ action: 'create_remote', contentType: uid, syncId: record.syncId, direction: 'push', status: 'error', message: err.message });
          }
        }

        for (const record of diff.toCreateLocal) {
          try {
            const filteredRecord = syncProfilesService.filterFieldsByPolicy(record, fieldPolicies, 'pull');
            await applyLocal(strapi, uid, filteredRecord, fields);
            pulled++;
          } catch (err) {
            errors++;
            await logService.log({ action: 'create_local', contentType: uid, syncId: record.syncId, direction: 'pull', status: 'error', message: err.message });
          }
        }

        for (const record of diff.toDeleteRemote) {
          try {
            await deleteRemote(remoteConfig, uid, record);
            await logService.log({ action: 'delete_remote', contentType: uid, syncId: record.syncId, direction: 'push', status: 'success', message: `Deleted remote record ${record.syncId}` });
          } catch (err) {
            errors++;
            await logService.log({ action: 'delete_remote', contentType: uid, syncId: record.syncId, direction: 'push', status: 'error', message: err.message });
          }
        }

        for (const record of diff.toDeleteLocal) {
          try {
            await deleteLocal(strapi, uid, record);
            await logService.log({ action: 'delete_local', contentType: uid, syncId: record.syncId, direction: 'pull', status: 'success', message: `Deleted local record ${record.syncId}` });
          } catch (err) {
            errors++;
            await logService.log({ action: 'delete_local', contentType: uid, syncId: record.syncId, direction: 'pull', status: 'error', message: err.message });
          }
        }

        await setLastSyncTimestamp(uid, syncStartTime);

        const summary = {
          uid,
          pushed,
          pulled,
          errors,
          hasFieldPolicies: !!fieldPolicies,
          profile: profile ? { id: profile.id, name: profile.name } : null,
        };

        await logService.log({
          action: 'sync_complete',
          contentType: uid,
          direction,
          status: errors > 0 ? 'partial' : 'success',
          message: `Pushed: ${pushed}, Pulled: ${pulled}, Errors: ${errors}${fieldPolicies ? ' (with field policies)' : ''}`,
          details: summary,
        });

        return { syncedAt: new Date().toISOString(), ...summary };
      } catch (err) {
        await logService.log({
          action: 'sync_error',
          contentType: uid,
          direction,
          status: 'error',
          message: err.message,
        });
        throw err;
      }
    },

    /**
     * Sync a SINGLE PAGE of a content type. Used by the bulk-transfer (Full
     * Sync) engine to process large content types page-by-page so that
     * progress can be reported and the job can be paused / resumed between
     * pages.
     *
     * options:
     *   - profile: synthetic/real profile (direction, conflictStrategy, syncDeletions)
     *   - page: 1-based page number (default 1)
     *   - pageSize: records per page (default from global settings or 100)
     *   - lastSyncAt: optional ISO timestamp; when omitted this runs a full
     *     page scan (preferred for bulk transfer). When provided it acts
     *     incremental.
     *
     * Returns:
     *   { uid, page, pageSize, pushed, pulled, errors, hasMore,
     *     localCount, remoteCount, remoteTotal, remotePageCount }
     */
    async syncContentTypePage(uid, options = {}) {
      if (!uid) throw new Error('Content type uid is required');

      const logService = plugin().service('syncLog');
      const configService = plugin().service('config');
      const syncConfigService = plugin().service('syncConfig');
      const syncProfilesService = plugin().service('syncProfiles');
      const executionService = plugin().service('syncExecution');

      const remoteConfig = await configService.getConfig({ safe: false });
      if (!remoteConfig || !remoteConfig.baseUrl) {
        throw new Error('Remote server not configured');
      }

      const { profile } = options;
      const syncConfig = await syncConfigService.getSyncConfig();
      const ctConfig = (syncConfig.contentTypes || []).find((ct) => ct.uid === uid) || { uid, fields: [] };

      const direction = profile?.direction || ctConfig.direction || 'both';
      const conflictStrategy = profile?.conflictStrategy || syncConfig.conflictStrategy || 'latest';
      const syncDeletions = !!(profile?.syncDeletions);
      const fields = ctConfig.fields || [];

      let fieldPolicies = null;
      if (profile && !profile.isSimple && Array.isArray(profile.fieldPolicies) && profile.fieldPolicies.length > 0) {
        fieldPolicies = {};
        for (const fp of profile.fieldPolicies) fieldPolicies[fp.field] = fp.direction;
      } else if (!profile) {
        fieldPolicies = await syncProfilesService.getFieldPoliciesForContentType(uid);
      }

      const globalExec = (await executionService.getGlobalSettings?.()) || {};
      const pageSize = Number(options.pageSize) || Number(globalExec.syncPageSize) || 100;
      const page = Math.max(1, Number(options.page) || 1);
      const lastSyncAt = options.lastSyncAt || null;

      let pushed = 0;
      let pulled = 0;
      let errors = 0;

      const localPageRes = await fetchLocalPage(strapi, uid, { fields, lastSyncAt, page, pageSize });
      const remotePageRes = await fetchRemotePage(remoteConfig, uid, { fields, lastSyncAt, page, pageSize });

      const localRecords = localPageRes.records || [];
      const remoteRecords = remotePageRes.records || [];

      // NOTE: comparator works on the page slice only. Cross-side deletion
      // detection is intentionally disabled here because a record missing
      // from this page may live on another page; full-set deletion sync
      // should use the incremental path instead.
      const diff = compareRecords(localRecords, remoteRecords, {
        direction,
        conflictStrategy,
        syncDeletions: false,
      });

      for (const { local } of diff.toPush) {
        try {
          const filtered = syncProfilesService.filterFieldsByPolicy(local, fieldPolicies, 'push');
          await applyRemote(remoteConfig, uid, filtered, fields);
          pushed++;
        } catch (err) {
          errors++;
          await logService.log({ action: 'push', contentType: uid, syncId: local.syncId, direction: 'push', status: 'error', message: err.message });
        }
      }

      for (const { remote } of diff.toPull) {
        try {
          const filtered = syncProfilesService.filterFieldsByPolicy(remote, fieldPolicies, 'pull');
          await applyLocal(strapi, uid, filtered, fields);
          pulled++;
        } catch (err) {
          errors++;
          await logService.log({ action: 'pull', contentType: uid, syncId: remote.syncId, direction: 'pull', status: 'error', message: err.message });
        }
      }

      for (const record of diff.toCreateRemote) {
        try {
          const filtered = syncProfilesService.filterFieldsByPolicy(record, fieldPolicies, 'push');
          await applyRemote(remoteConfig, uid, filtered, fields);
          pushed++;
        } catch (err) {
          errors++;
          await logService.log({ action: 'create_remote', contentType: uid, syncId: record.syncId, direction: 'push', status: 'error', message: err.message });
        }
      }

      for (const record of diff.toCreateLocal) {
        try {
          const filtered = syncProfilesService.filterFieldsByPolicy(record, fieldPolicies, 'pull');
          await applyLocal(strapi, uid, filtered, fields);
          pulled++;
        } catch (err) {
          errors++;
          await logService.log({ action: 'create_local', contentType: uid, syncId: record.syncId, direction: 'pull', status: 'error', message: err.message });
        }
      }

      // hasMore is the OR of both sides so we keep paging until both are drained
      const hasMore = !!(localPageRes.hasMore || remotePageRes.hasMore);

      return {
        uid,
        page,
        pageSize,
        pushed,
        pulled,
        errors,
        hasMore,
        localCount: localRecords.length,
        remoteCount: remoteRecords.length,
        remoteTotal: remotePageRes.total,
        remotePageCount: remotePageRes.pageCount,
      };
    },

    /**
     * Step 8 — Push a single record to the remote (called by lifecycle hooks).
     * Now supports field-level policies.
     */
    async pushRecord(uid, record) {
      const configService = plugin().service('config');
      const logService = plugin().service('syncLog');
      const syncProfilesService = plugin().service('syncProfiles');

      const remoteConfig = await configService.getConfig({ safe: false });
      if (!remoteConfig || !remoteConfig.baseUrl) return;

      const syncConfigService = plugin().service('syncConfig');
      const syncConfig = await syncConfigService.getSyncConfig();
      const ctConfig = (syncConfig.contentTypes || []).find(
        (ct) => ct.uid === uid && ct.enabled
      );

      if (!ctConfig) return;
      if (ctConfig.direction === 'pull') return;

      // Get field-level policies from active profile (if any)
      const fieldPolicies = await syncProfilesService.getFieldPoliciesForContentType(uid);
      const filteredRecord = syncProfilesService.filterFieldsByPolicy(record, fieldPolicies, 'push');

      try {
        await applyRemote(remoteConfig, uid, filteredRecord, ctConfig.fields);
        await logService.log({
          action: 'event_push',
          contentType: uid,
          syncId: record.syncId,
          direction: 'push',
          status: 'success',
          message: `Record ${record.syncId} pushed to remote${fieldPolicies ? ' (with field policies)' : ''}`,
        });
      } catch (err) {
        await logService.log({
          action: 'event_push',
          contentType: uid,
          syncId: record.syncId,
          direction: 'push',
          status: 'error',
          message: err.message,
        });
      }
    },

    /**
     * Step 9 — Receive a record pushed from a remote instance.
     * Now supports field-level policies.
     */
    async receiveRecord(uid, data, syncId, isDelete = false, documentId = null) {
      const logService = plugin().service('syncLog');
      const syncProfilesService = plugin().service('syncProfiles');

      const key = documentId || syncId;

      try {
        if (isDelete) {
          await deleteLocal(strapi, uid, { documentId, syncId });
          await logService.log({
            action: 'receive_delete',
            contentType: uid,
            syncId: key,
            direction: 'pull',
            status: 'success',
            message: `Delete received for ${key} from remote`,
          });
          return { success: true, deleted: true };
        }

        // Get field-level policies from active profile (if any)
        const fieldPolicies = await syncProfilesService.getFieldPoliciesForContentType(uid);
        const filteredData = syncProfilesService.filterFieldsByPolicy(data, fieldPolicies, 'pull');

        await applyLocal(strapi, uid, { ...filteredData, documentId, syncId }, []);

        await logService.log({
          action: 'receive',
          contentType: uid,
          syncId: key,
          direction: 'pull',
          status: 'success',
          message: `Record ${key} received from remote${fieldPolicies ? ' (with field policies)' : ''}`,
        });

        return { success: true };
      } catch (err) {
        await logService.log({
          action: isDelete ? 'receive_delete' : 'receive',
          contentType: uid,
          syncId: key,
          direction: 'pull',
          status: 'error',
          message: err.message,
        });
        throw err;
      }
    },
  };
};
