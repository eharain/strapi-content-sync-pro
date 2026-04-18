'use strict';

const { ensureSyncId } = require('./utils/sync-id');
const { isRemoteUpdate } = require('./utils/sync-guard');

const bootstrap = ({ strapi }) => {
  // Subscribe to DB lifecycle events for all content types
  strapi.db.lifecycles.subscribe({
    /**
     * Step 5 — Automatically generate a syncId (UUID) for every new
     * record in an api:: content type that does not already have one.
     */
    async beforeCreate(event) {
      const { model, params } = event;
      if (!model.uid.startsWith('api::')) return;

      if (params.data) {
        ensureSyncId(params.data);
      }
    },

    /**
     * Step 8 — After a local record is created, push it to the remote
     * instance unless it originated from a remote sync.
     */
    async afterCreate(event) {
      const { model, result } = event;
      if (!model.uid.startsWith('api::')) return;

      const key = `${model.uid}:${result.syncId}`;
      if (isRemoteUpdate(key)) return;

      try {
        const syncService = strapi.plugin('strapi-to-strapi-data-sync').service('sync');
        await syncService.pushRecord(model.uid, result);
      } catch (err) {
        strapi.log.error(`[data-sync] afterCreate push failed: ${err.message}`);
      }
    },

    /**
     * Step 8 — After a local record is updated, push it to the remote
     * instance unless it originated from a remote sync.
     */
    async afterUpdate(event) {
      const { model, result } = event;
      if (!model.uid.startsWith('api::')) return;

      const key = `${model.uid}:${result.syncId}`;
      if (isRemoteUpdate(key)) return;

      try {
        const syncService = strapi.plugin('strapi-to-strapi-data-sync').service('sync');
        await syncService.pushRecord(model.uid, result);
      } catch (err) {
        strapi.log.error(`[data-sync] afterUpdate push failed: ${err.message}`);
      }
    },
  });
};

module.exports = bootstrap;
