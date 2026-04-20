'use strict';

module.exports = {
  async get(ctx) {
    const service = strapi.plugin('strapi-content-sync-pro').service('syncConfig');
    const config = await service.getSyncConfig();
    ctx.body = { data: config };
  },

  async set(ctx) {
    const { body } = ctx.request;

    if (!body || typeof body !== 'object') {
      return ctx.badRequest('Request body must be a JSON object');
    }

    const service = strapi.plugin('strapi-content-sync-pro').service('syncConfig');

    try {
      const saved = await service.setSyncConfig(body);
      ctx.body = { data: saved };
    } catch (err) {
      return ctx.badRequest(err.message);
    }
  },
};
