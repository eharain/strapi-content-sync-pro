'use strict';

const { describeContract } = require('../utils/strategy');

const PLUGIN_ID = 'strapi-content-sync-pro';

function service(strapi) {
  return strapi.plugin(PLUGIN_ID).service('syncConfig');
}

module.exports = {
  async get(ctx) {
    const config = await service(strapi).getSyncConfig();
    ctx.body = { data: config };
  },

  async set(ctx) {
    const { body } = ctx.request;

    if (!body || typeof body !== 'object') {
      return ctx.badRequest('Request body must be a JSON object');
    }

    try {
      const saved = await service(strapi).setSyncConfig(body);
      ctx.body = { data: saved };
    } catch (err) {
      return ctx.badRequest(err.message);
    }
  },

  /**
   * POST /sync-config/enable-preview
   * body: { uid | uids, withDependencies }
   * Dry run: what enabling would switch on, what is already on, and what is
   * skipped (with reasons). Nothing is written.
   */
  async enablePreview(ctx) {
    const body = ctx.request.body || {};
    const uids = body.uids || (body.uid ? [body.uid] : []);
    try {
      const data = await service(strapi).previewEnable({
        uids,
        withDependencies: !!body.withDependencies,
      });
      ctx.body = { data };
    } catch (err) {
      return ctx.badRequest(err.message);
    }
  },

  /**
   * POST /sync-config/enable
   * body: { uid | uids, withDependencies, profileMode: 'quick' | 'none' }
   */
  async enable(ctx) {
    const body = ctx.request.body || {};
    const uids = body.uids || (body.uid ? [body.uid] : []);
    try {
      const data = await service(strapi).enable({
        uids,
        withDependencies: !!body.withDependencies,
        profileMode: body.profileMode === 'none' ? 'none' : 'quick',
      });
      ctx.body = { data };
    } catch (err) {
      return ctx.badRequest(err.message);
    }
  },

  /**
   * POST /sync-config/disable
   * body: { uid | uids }
   */
  async disable(ctx) {
    const body = ctx.request.body || {};
    const uids = body.uids || (body.uid ? [body.uid] : []);
    try {
      const data = await service(strapi).disable({ uids });
      ctx.body = { data };
    } catch (err) {
      return ctx.badRequest(err.message);
    }
  },

  /**
   * GET /strategy
   * The execution strategy contract, so the admin UI renders hints from the
   * same source that drives the behaviour.
   */
  async getStrategy(ctx) {
    ctx.body = { data: describeContract() };
  },
};
