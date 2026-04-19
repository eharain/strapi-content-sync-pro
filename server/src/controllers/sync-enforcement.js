'use strict';

const PLUGIN_ID = 'strapi-to-strapi-data-sync';

module.exports = ({ strapi }) => ({
  /**
   * GET /enforcement/settings
   * Get enforcement settings
   */
  async getSettings(ctx) {
    try {
      const settings = await strapi.plugin(PLUGIN_ID).service('syncEnforcement').getSettings();
      ctx.body = { data: settings };
    } catch (err) {
      ctx.throw(500, err.message);
    }
  },

  /**
   * PUT /enforcement/settings
   * Update enforcement settings
   */
  async updateSettings(ctx) {
    const body = ctx.request.body;
    try {
      const settings = await strapi.plugin(PLUGIN_ID).service('syncEnforcement').updateSettings(body);
      ctx.body = { data: settings };
    } catch (err) {
      ctx.throw(400, err.message);
    }
  },

  /**
   * GET /enforcement/local-info
   * Get local version and schema info
   */
  async getLocalInfo(ctx) {
    try {
      const service = strapi.plugin(PLUGIN_ID).service('syncEnforcement');
      const versionInfo = service.getLocalVersionInfo();
      ctx.body = { data: versionInfo };
    } catch (err) {
      ctx.throw(500, err.message);
    }
  },

  /**
   * GET /enforcement/schema/:uid
   * Get local schema for a content type
   */
  async getLocalSchema(ctx) {
    const { uid } = ctx.params;
    try {
      const schema = strapi.plugin(PLUGIN_ID).service('syncEnforcement').getLocalSchema(uid);
      if (!schema) {
        return ctx.throw(404, `Content type "${uid}" not found`);
      }
      ctx.body = { data: { uid, schema } };
    } catch (err) {
      ctx.throw(500, err.message);
    }
  },

  /**
   * POST /enforcement/check
   * Run pre-sync enforcement checks
   */
  async runChecks(ctx) {
    const { contentType, remoteInfo } = ctx.request.body;
    if (!contentType) {
      return ctx.throw(400, 'contentType is required');
    }
    if (!remoteInfo) {
      return ctx.throw(400, 'remoteInfo is required');
    }
    try {
      const results = await strapi.plugin(PLUGIN_ID).service('syncEnforcement').runPreSyncChecks(contentType, remoteInfo);
      ctx.body = { data: results };
    } catch (err) {
      ctx.throw(400, err.message);
    }
  },

  /**
   * GET /enforcement/summary
   * Get enforcement summary for UI
   */
  async getSummary(ctx) {
    try {
      const summary = await strapi.plugin(PLUGIN_ID).service('syncEnforcement').getEnforcementSummary();
      ctx.body = { data: summary };
    } catch (err) {
      ctx.throw(500, err.message);
    }
  },
});
