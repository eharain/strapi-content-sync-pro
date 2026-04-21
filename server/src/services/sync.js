'use strict';

const { fetchLocalRecords, fetchRemoteRecords } = require('../utils/fetcher');
const { compareRecords } = require('../utils/comparator');
const { applyLocal, applyRemote } = require('../utils/applier');

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
      const executionService = plugin().service('syncExecution');

      const remoteConfig = await configService.getConfig({ safe: false });
      if (!remoteConfig || !remoteConfig.baseUrl) {
        throw new Error('Remote server not configured');
      }

      const syncConfig = await syncConfigService.getSyncConfig();
      const enabledTypes = (syncConfig.contentTypes || []).filter((ct) => ct.enabled);

      // Pagination — remote + local fetches are chunked to keep memory bounded
      // for large datasets. Page size is a global setting tunable in the Sync tab.
      const globalExec = (await executionService.getGlobalSettings?.()) || {};

      const syncStatsService = plugin().service('syncStats');
      const reportHandle = await syncStatsService.createRunReport({
        runType: 'sync_now',
        trigger: 'manual_sync_now',
        contentTypes: enabledTypes.map((ct) => ct.uid),
      });

      try {
        if (enabledTypes.length === 0) {
          throw new Error('No content types configured for sync');
        }

        const pageSize = Number(globalExec.syncPageSize) || 100;

        const timestamps = await getLastSyncTimestamps();
        const conflictStrategy = syncConfig.conflictStrategy || 'latest';
        const results = [];

        for (const ctConfig of enabledTypes) {
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

            const diff = compareRecords(localRecords, remoteRecords, {
              direction,
              conflictStrategy,
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

        const diff = compareRecords(localRecords, remoteRecords, { direction, conflictStrategy });

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
    async receiveRecord(uid, data, syncId) {
      const logService = plugin().service('syncLog');
      const syncProfilesService = plugin().service('syncProfiles');

      // Get field-level policies from active profile (if any)
      const fieldPolicies = await syncProfilesService.getFieldPoliciesForContentType(uid);
      const filteredData = syncProfilesService.filterFieldsByPolicy(data, fieldPolicies, 'pull');

      try {
        await applyLocal(strapi, uid, { ...filteredData, syncId }, []);

        await logService.log({
          action: 'receive',
          contentType: uid,
          syncId,
          direction: 'pull',
          status: 'success',
          message: `Record ${syncId} received from remote${fieldPolicies ? ' (with field policies)' : ''}`,
        });

        return { success: true };
      } catch (err) {
        await logService.log({
          action: 'receive',
          contentType: uid,
          syncId,
          direction: 'pull',
          status: 'error',
          message: err.message,
        });
        throw err;
      }
    },
  };
};
