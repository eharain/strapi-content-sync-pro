'use strict';

const PLUGIN_ID = 'strapi-content-sync-pro';

module.exports = ({ strapi }) => ({
  /**
   * GET /sync-execution/settings
   * Get all execution settings
   */
  async getSettings(ctx) {
    try {
      const settings = await strapi.plugin(PLUGIN_ID).service('syncExecution').getExecutionSettings();
      ctx.body = { data: settings };
    } catch (err) {
      ctx.throw(500, err.message);
    }
  },

  /**
   * GET /sync-execution/settings/:profileId
   * Get execution settings for a profile
   */
  async getProfileSettings(ctx) {
    const { profileId } = ctx.params;
    try {
      const settings = await strapi.plugin(PLUGIN_ID).service('syncExecution').getProfileExecutionSettings(profileId);
      ctx.body = { data: settings };
    } catch (err) {
      ctx.throw(500, err.message);
    }
  },

  /**
   * PUT /sync-execution/settings/:profileId
   * Update execution settings for a profile
   */
  async updateProfileSettings(ctx) {
    const { profileId } = ctx.params;
    const body = ctx.request.body;
    try {
      const settings = await strapi.plugin(PLUGIN_ID).service('syncExecution').setProfileExecutionSettings(profileId, body);
      ctx.body = { data: settings };
    } catch (err) {
      ctx.throw(400, err.message);
    }
  },

  /**
   * GET /sync-execution/global-settings
   * Get global execution settings
   */
  async getGlobalSettings(ctx) {
    try {
      const settings = await strapi.plugin(PLUGIN_ID).service('syncExecution').getGlobalSettings();
      ctx.body = { data: settings };
    } catch (err) {
      ctx.throw(500, err.message);
    }
  },

  /**
   * PUT /sync-execution/global-settings
   * Update global execution settings
   */
  async updateGlobalSettings(ctx) {
    const body = ctx.request.body;
    try {
      const settings = await strapi.plugin(PLUGIN_ID).service('syncExecution').setGlobalSettings(body);
      ctx.body = { data: settings };
    } catch (err) {
      ctx.throw(400, err.message);
    }
  },

  /**
   * POST /sync-execution/execute/:profileId
   * Execute a profile on-demand
   */
  async executeProfile(ctx) {
    const { profileId } = ctx.params;
    const options = ctx.request.body || {};
    try {
      const result = await strapi.plugin(PLUGIN_ID).service('syncExecution').executeProfile(profileId, options);
      ctx.body = { data: result };
    } catch (err) {
      ctx.throw(400, err.message);
    }
  },

  /**
   * POST /sync-execution/execute-batch
   * Execute multiple profiles
   */
  async executeProfiles(ctx) {
    const { profileIds, options } = ctx.request.body;
    if (!profileIds || !Array.isArray(profileIds)) {
      return ctx.throw(400, 'profileIds array is required');
    }
    try {
      const result = await strapi.plugin(PLUGIN_ID).service('syncExecution').executeProfiles(profileIds, options || {});
      ctx.body = { data: result };
    } catch (err) {
      ctx.throw(400, err.message);
    }
  },

  /**
   * POST /sync-execution/execute-content-type/:uid
   * Execute active profile for a content type
   */
  async executeContentType(ctx) {
    const { uid } = ctx.params;
    const options = ctx.request.body || {};
    try {
      const result = await strapi.plugin(PLUGIN_ID).service('syncExecution').executeContentType(uid, options);
      ctx.body = { data: result };
    } catch (err) {
      ctx.throw(400, err.message);
    }
  },

  /**
   * GET /sync-execution/status
   * Get execution status for all profiles
   */
  async getStatus(ctx) {
    try {
      const status = await strapi.plugin(PLUGIN_ID).service('syncExecution').getExecutionStatus();
      ctx.body = { data: status };
    } catch (err) {
      ctx.throw(500, err.message);
    }
  },
});
