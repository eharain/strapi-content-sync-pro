'use strict';

const PLUGIN_ID = 'strapi-content-sync-pro';

module.exports = ({ strapi }) => ({
  async getSnapshot(ctx) {
    try {
      const data = await strapi.plugin(PLUGIN_ID).service('syncStats').getLatestSnapshot();
      ctx.body = { data };
    } catch (err) {
      ctx.throw(500, err.message);
    }
  },

  async getReports(ctx) {
    const { page, pageSize } = ctx.query;
    try {
      const data = await strapi.plugin(PLUGIN_ID).service('syncStats').getReports({
        page: page ? parseInt(page, 10) : 1,
        pageSize: pageSize ? parseInt(pageSize, 10) : 10,
      });
      ctx.body = data;
    } catch (err) {
      ctx.throw(500, err.message);
    }
  },

  async clearReports(ctx) {
    try {
      const result = await strapi.plugin(PLUGIN_ID).service('syncStats').clearReports();
      ctx.body = { data: result };
    } catch (err) {
      ctx.throw(500, err.message);
    }
  },

  async runRetention(ctx) {
    const body = ctx.request.body || {};
    try {
      const syncStats = strapi.plugin(PLUGIN_ID).service('syncStats');
      const syncLog = strapi.plugin(PLUGIN_ID).service('syncLog');
      const reports = await syncStats.applyRetention({ maxReports: body.maxReports });
      const logs = await syncLog.applyRetention({ maxLogs: body.maxLogs });
      ctx.body = { data: { reports, logs } };
    } catch (err) {
      ctx.throw(400, err.message);
    }
  },


});
