'use strict';

const PLUGIN_ID = 'strapi-content-sync-pro';

module.exports = ({ strapi }) => ({
  /**
   * GET /alerts/settings
   * Get alert settings
   */
  async getSettings(ctx) {
    try {
      const settings = await strapi.plugin(PLUGIN_ID).service('alerts').getSettings();
      ctx.body = { data: settings };
    } catch (err) {
      ctx.throw(500, err.message);
    }
  },

  /**
   * PUT /alerts/settings
   * Update alert settings
   */
  async updateSettings(ctx) {
    const body = ctx.request.body;
    try {
      const settings = await strapi.plugin(PLUGIN_ID).service('alerts').updateSettings(body);
      ctx.body = { data: settings };
    } catch (err) {
      ctx.throw(400, err.message);
    }
  },

  /**
   * POST /alerts/test/:channel
   * Test an alert channel
   */
  async testChannel(ctx) {
    const { channel } = ctx.params;
    try {
      const result = await strapi.plugin(PLUGIN_ID).service('alerts').testChannel(channel);
      ctx.body = { data: result };
    } catch (err) {
      ctx.throw(400, err.message);
    }
  },

  /**
   * GET /alerts/stats
   * Get alert statistics
   */
  async getStats(ctx) {
    try {
      const stats = strapi.plugin(PLUGIN_ID).service('alerts').getAlertStats();
      ctx.body = { data: stats };
    } catch (err) {
      ctx.throw(500, err.message);
    }
  },
});
