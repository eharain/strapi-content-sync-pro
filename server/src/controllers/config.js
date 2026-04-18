'use strict';

module.exports = {
  async get(ctx) {
    const configService = strapi.plugin('strapi-to-strapi-data-sync').service('config');
    const config = await configService.getConfig({ safe: true });

    ctx.body = { data: config };
  },

  async set(ctx) {
    const { body } = ctx.request;

    if (!body || typeof body !== 'object') {
      return ctx.badRequest('Request body must be a JSON object');
    }

    const configService = strapi.plugin('strapi-to-strapi-data-sync').service('config');

    try {
      const saved = await configService.setConfig(body);

      const sanitized = { ...saved };
      if (sanitized.apiToken) {
        sanitized.apiToken = '••••••••';
      }
      if (sanitized.sharedSecret) {
        sanitized.sharedSecret = '••••••••';
      }

      ctx.body = { data: sanitized };
    } catch (err) {
      return ctx.badRequest(err.message);
    }
  },
};
