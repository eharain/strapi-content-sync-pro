'use strict';

const PLUGIN_ID = 'strapi-content-sync-pro';

module.exports = {
  /**
   * Signed peer endpoint — return local users (with password hash + role type)
   * for the caller to pull. Protected by the HMAC verifySignature middleware.
   */
  async export(ctx) {
    const { since } = ctx.request.body || {};
    try {
      const data = await strapi.plugin(PLUGIN_ID).service('userSync').exportUsers({ since: since || null });
      ctx.body = { data };
    } catch (err) {
      return ctx.badRequest(err.message);
    }
  },

  /**
   * Signed peer endpoint — upsert the users the caller pushes.
   */
  async import(ctx) {
    const { users } = ctx.request.body || {};
    if (!Array.isArray(users)) {
      return ctx.badRequest('users must be an array');
    }
    try {
      const data = await strapi.plugin(PLUGIN_ID).service('userSync').applyUsers(users);
      ctx.body = { data };
    } catch (err) {
      return ctx.badRequest(err.message);
    }
  },

  /**
   * Admin endpoint — trigger a two-way user sync.
   */
  async sync(ctx) {
    const opts = ctx.request.body || {};
    try {
      const data = await strapi.plugin(PLUGIN_ID).service('userSync').syncUsers(opts);
      ctx.body = { data };
    } catch (err) {
      return ctx.badRequest(err.message);
    }
  },
};
