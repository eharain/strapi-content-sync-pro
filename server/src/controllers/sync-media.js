'use strict';

const PLUGIN_ID = 'strapi-to-strapi-data-sync';

function service(strapi) {
  return strapi.plugin(PLUGIN_ID).service('syncMedia');
}

module.exports = ({ strapi }) => ({
  async getSettings(ctx) {
    try {
      ctx.body = { data: await service(strapi).getSettings() };
    } catch (err) {
      ctx.throw(500, err.message);
    }
  },

  async updateSettings(ctx) {
    try {
      const body = ctx.request.body || {};
      ctx.body = { data: await service(strapi).setSettings(body) };
    } catch (err) {
      ctx.throw(400, err.message);
    }
  },

  async getStatus(ctx) {
    try {
      ctx.body = { data: await service(strapi).getStatus() };
    } catch (err) {
      ctx.throw(500, err.message);
    }
  },

  async test(ctx) {
    try {
      ctx.body = { data: await service(strapi).testConnection() };
    } catch (err) {
      ctx.throw(500, err.message);
    }
  },

  async run(ctx) {
    try {
      const options = ctx.request.body || {};
      const result = await service(strapi).run(options);
      ctx.body = { data: result };
    } catch (err) {
      ctx.throw(400, err.message);
    }
  },
});
