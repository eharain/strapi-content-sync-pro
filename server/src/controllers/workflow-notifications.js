'use strict';

const PLUGIN_ID = 'strapi-content-sync-pro';

module.exports = ({ strapi }) => ({
  async emit(ctx) {
    try {
      const payload = ctx.request.body || {};
      const data = await strapi.plugin(PLUGIN_ID).service('workflowNotifications').emit(payload);
      ctx.body = { data };
    } catch (err) {
      ctx.throw(400, err.message);
    }
  },

  async find(ctx) {
    try {
      const { page, pageSize, sourceApp, workflow, event, status } = ctx.query;
      const result = await strapi.plugin(PLUGIN_ID).service('workflowNotifications').list({
        page: page ? parseInt(page, 10) : 1,
        pageSize: pageSize ? parseInt(pageSize, 10) : 25,
        sourceApp,
        workflow,
        event,
        status,
      });

      ctx.body = result;
    } catch (err) {
      ctx.throw(500, err.message);
    }
  },

  async getTemplates(ctx) {
    try {
      const templates = await strapi.plugin(PLUGIN_ID).service('workflowNotifications').getTemplates();
      ctx.body = { data: templates };
    } catch (err) {
      ctx.throw(500, err.message);
    }
  },

  async seedTemplates(ctx) {
    try {
      const result = await strapi.plugin(PLUGIN_ID).service('workflowNotifications').seedTemplates();
      ctx.body = { data: result };
    } catch (err) {
      ctx.throw(500, err.message);
    }
  },
});