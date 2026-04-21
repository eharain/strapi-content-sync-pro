'use strict';

module.exports = {
  async syncNow(ctx) {
    const syncService = strapi.plugin('strapi-content-sync-pro').service('sync');

    try {
      const result = await syncService.syncNow();
      ctx.body = { data: result };
    } catch (err) {
      return ctx.badRequest(err.message);
    }
  },

  async receive(ctx) {
    const { body } = ctx.request;

    if (!body || !body.uid || (!body.syncId && !body.documentId)) {
      return ctx.badRequest('Missing uid, data, or documentId/syncId');
    }

    const syncService = strapi.plugin('strapi-content-sync-pro').service('sync');

    try {
      const result = await syncService.receiveRecord(
        body.uid,
        body.data || {},
        body.syncId || null,
        !!body.delete,
        body.documentId || null,
      );
      ctx.body = { data: result };
    } catch (err) {
      return ctx.badRequest(err.message);
    }
  },
};
