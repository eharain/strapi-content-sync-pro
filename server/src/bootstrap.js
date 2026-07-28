'use strict';

const { isRemoteUpdate } = require('./utils/sync-guard');

const bootstrap = ({ strapi }) => {
  /**
   * Check if live sync is enabled for a content type
   */
  const isLiveSyncEnabled = async (contentTypeUid) => {
    try {
      const executionService = strapi.plugin('strapi-content-sync-pro').service('syncExecution');
      const profilesService = strapi.plugin('strapi-content-sync-pro').service('syncProfiles');

      // Get active profile for this content type
      const profile = await profilesService.getActiveProfileForContentType(contentTypeUid);
      if (!profile) return false;

      // Get execution settings
      const execSettings = await executionService.getProfileExecutionSettings(profile.id);

      // Check if live mode is enabled
      return execSettings.executionMode === 'live' && execSettings.enabled;
    } catch (err) {
      strapi.log.error(`[data-sync] Error checking live sync: ${err.message}`);
      return false;
    }
  };

  /**
   * Execute live sync for a record
   */
  const executeLiveSync = async (contentTypeUid, record, action) => {
    try {
      const executionService = strapi.plugin('strapi-content-sync-pro').service('syncExecution');
      const profilesService = strapi.plugin('strapi-content-sync-pro').service('syncProfiles');
      const syncService = strapi.plugin('strapi-content-sync-pro').service('sync');
      const logService = strapi.plugin('strapi-content-sync-pro').service('syncLog');

      const profile = await profilesService.getActiveProfileForContentType(contentTypeUid);
      if (!profile) return;

      // Log the live sync trigger
      await logService.log({
        action: `live_${action}`,
        contentType: contentTypeUid,
        syncId: record.syncId,
        direction: profile.direction,
        status: 'info',
        message: `Live sync triggered: ${action} on ${contentTypeUid}`,
        details: { profileId: profile.id, recordId: record.id },
      });

      // Push the record based on profile direction
      if (profile.direction === 'push' || profile.direction === 'both') {
        await syncService.pushRecord(contentTypeUid, record);
      }
    } catch (err) {
      strapi.log.error(`[data-sync] Live sync failed: ${err.message}`);
    }
  };

  // Subscribe to DB lifecycle events for all content types.
  //
  // The loop-guard key is `${uid}:${documentId}` — matching exactly what
  // applyLocal marks via markAsRemoteUpdate (server/src/utils/applier.js), which
  // prefers documentId and only falls back to syncId for legacy installs that
  // still have that column. No Rutba content type declares a `syncId`
  // attribute, so Strapi's entity-manager silently drops it from `params.data`
  // before insert (processData iterates known schema attributes only) — a
  // record's `syncId` is therefore always undefined here, and keying the guard
  // on it never matched applyLocal's mark, defeating the loop guard entirely
  // whenever a profile's executionMode is 'live'. documentId is always present
  // on every created/updated/deleted record and needs no schema change.
  strapi.db.lifecycles.subscribe({
    /**
     * After a local record is created, push it to the remote
     * instance if live sync is enabled.
     */
    async afterCreate(event) {
      const { model, result } = event;
      if (!model.uid.startsWith('api::')) return;

      const key = `${model.uid}:${result.documentId}`;
      if (isRemoteUpdate(key)) return;

      // Check if live sync is enabled
      const liveEnabled = await isLiveSyncEnabled(model.uid);
      if (!liveEnabled) return;

      await executeLiveSync(model.uid, result, 'create');
    },

    /**
     * After a local record is updated, push it to the remote
     * instance if live sync is enabled.
     */
    async afterUpdate(event) {
      const { model, result } = event;
      if (!model.uid.startsWith('api::')) return;

      const key = `${model.uid}:${result.documentId}`;
      if (isRemoteUpdate(key)) return;

      // Check if live sync is enabled
      const liveEnabled = await isLiveSyncEnabled(model.uid);
      if (!liveEnabled) return;

      await executeLiveSync(model.uid, result, 'update');
    },

    /**
     * After a local record is deleted, notify the remote
     * instance if live sync is enabled.
     */
    async afterDelete(event) {
      const { model, result } = event;
      if (!model.uid.startsWith('api::')) return;
      if (!result?.documentId) return;

      const key = `${model.uid}:${result.documentId}`;
      if (isRemoteUpdate(key)) return;

      // Check if live sync is enabled
      const liveEnabled = await isLiveSyncEnabled(model.uid);
      if (!liveEnabled) return;

      await executeLiveSync(model.uid, result, 'delete');
    },
  });

  // Initialize scheduled syncs after Strapi is ready
  strapi.server.use(async (ctx, next) => {
    await next();
  });

  // Defer scheduler initialization
  setImmediate(async () => {
    try {
      const workflowNotificationsService = strapi.plugin('strapi-content-sync-pro').service('workflowNotifications');
      const seedResult = await workflowNotificationsService.seedTemplates();
      if (seedResult.seeded) {
        strapi.log.info(`[data-sync] Seeded ${seedResult.total} workflow notification templates`);
      }

      const executionService = strapi.plugin('strapi-content-sync-pro').service('syncExecution');
      await executionService.initializeSchedulers();
      strapi.log.info('[data-sync] Scheduled sync jobs initialized');
    } catch (err) {
      strapi.log.error(`[data-sync] Failed to initialize schedulers: ${err.message}`);
    }
  });
};

module.exports = bootstrap;
