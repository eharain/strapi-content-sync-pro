'use strict';

const { fetchLocalRecords, fetchRemoteRecords } = require('../utils/fetcher');
const { compareRecords } = require('../utils/comparator');
const { applyLocal, applyRemote } = require('../utils/applier');

const LAST_SYNC_STORE_KEY = 'last-sync-timestamps';

module.exports = ({ strapi }) => {
  function getStore() {
    return strapi.store({ type: 'plugin', name: 'strapi-to-strapi-data-sync' });
  }

  function plugin() {
    return strapi.plugin('strapi-to-strapi-data-sync');
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
     */
    async syncNow() {
      const logService = plugin().service('syncLog');
      const configService = plugin().service('config');
      const syncConfigService = plugin().service('syncConfig');

      const remoteConfig = await configService.getConfig({ safe: false });
      if (!remoteConfig || !remoteConfig.baseUrl) {
        throw new Error('Remote server not configured');
      }

      const syncConfig = await syncConfigService.getSyncConfig();
      const enabledTypes = (syncConfig.contentTypes || []).filter((ct) => ct.enabled);

      if (enabledTypes.length === 0) {
        throw new Error('No content types configured for sync');
      }

      const timestamps = await getLastSyncTimestamps();
      const conflictStrategy = syncConfig.conflictStrategy || 'latest';
      const results = [];

      for (const ctConfig of enabledTypes) {
        const { uid, direction, fields } = ctConfig;
        const lastSyncAt = timestamps[uid] || null;
        const syncStartTime = new Date().toISOString();

        try {
          const localRecords = await fetchLocalRecords(strapi, uid, { fields, lastSyncAt });
          const remoteRecords = await fetchRemoteRecords(remoteConfig, uid, { fields, lastSyncAt });

          const diff = compareRecords(localRecords, remoteRecords, {
            direction,
            conflictStrategy,
          });

          let pushed = 0;
          let pulled = 0;
          let errors = 0;

          for (const { local } of diff.toPush) {
            try { await applyRemote(remoteConfig, uid, local, fields); pushed++; }
            catch (err) { errors++; await logService.log({ action: 'push', contentType: uid, syncId: local.syncId, direction: 'push', status: 'error', message: err.message }); }
          }

          for (const { remote } of diff.toPull) {
            try { await applyLocal(strapi, uid, remote, fields); pulled++; }
            catch (err) { errors++; await logService.log({ action: 'pull', contentType: uid, syncId: remote.syncId, direction: 'pull', status: 'error', message: err.message }); }
          }

          for (const record of diff.toCreateRemote) {
            try { await applyRemote(remoteConfig, uid, record, fields); pushed++; }
            catch (err) { errors++; await logService.log({ action: 'create_remote', contentType: uid, syncId: record.syncId, direction: 'push', status: 'error', message: err.message }); }
          }

          for (const record of diff.toCreateLocal) {
            try { await applyLocal(strapi, uid, record, fields); pulled++; }
            catch (err) { errors++; await logService.log({ action: 'create_local', contentType: uid, syncId: record.syncId, direction: 'pull', status: 'error', message: err.message }); }
          }

          await setLastSyncTimestamp(uid, syncStartTime);

          const summary = { uid, pushed, pulled, errors };
          results.push(summary);

          await logService.log({
            action: 'sync_complete',
            contentType: uid,
            direction,
            status: errors > 0 ? 'partial' : 'success',
            message: `Pushed: ${pushed}, Pulled: ${pulled}, Errors: ${errors}`,
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

      return { syncedAt: new Date().toISOString(), results };
    },

    /**
     * Step 8 — Push a single record to the remote (called by lifecycle hooks).
     */
    async pushRecord(uid, record) {
      const configService = plugin().service('config');
      const logService = plugin().service('syncLog');

      const remoteConfig = await configService.getConfig({ safe: false });
      if (!remoteConfig || !remoteConfig.baseUrl) return;

      const syncConfigService = plugin().service('syncConfig');
      const syncConfig = await syncConfigService.getSyncConfig();
      const ctConfig = (syncConfig.contentTypes || []).find(
        (ct) => ct.uid === uid && ct.enabled
      );

      if (!ctConfig) return;
      if (ctConfig.direction === 'pull') return;

      try {
        await applyRemote(remoteConfig, uid, record, ctConfig.fields);
        await logService.log({
          action: 'event_push',
          contentType: uid,
          syncId: record.syncId,
          direction: 'push',
          status: 'success',
          message: `Record ${record.syncId} pushed to remote`,
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
     */
    async receiveRecord(uid, data, syncId) {
      const logService = plugin().service('syncLog');

      try {
        await applyLocal(strapi, uid, { ...data, syncId }, []);

        await logService.log({
          action: 'receive',
          contentType: uid,
          syncId,
          direction: 'pull',
          status: 'success',
          message: `Record ${syncId} received from remote`,
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
