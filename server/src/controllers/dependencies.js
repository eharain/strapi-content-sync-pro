'use strict';

const PLUGIN_ID = 'strapi-to-strapi-data-sync';

module.exports = ({ strapi }) => ({
  /**
   * GET /dependencies/:uid
   * Get dependency analysis for a content type
   */
  async analyze(ctx) {
    const { uid } = ctx.params;
    try {
      const analysis = strapi.plugin(PLUGIN_ID).service('dependencyResolver').analyzeContentType(uid);
      ctx.body = { data: analysis };
    } catch (err) {
      ctx.throw(400, err.message);
    }
  },

  /**
   * GET /dependencies/:uid/graph
   * Get dependency graph for a content type
   */
  async getGraph(ctx) {
    const { uid } = ctx.params;
    const depth = parseInt(ctx.query.depth, 10) || 1;
    try {
      const graph = strapi.plugin(PLUGIN_ID).service('dependencyResolver').buildDependencyGraph(uid, depth);
      ctx.body = { data: graph };
    } catch (err) {
      ctx.throw(400, err.message);
    }
  },

  /**
   * GET /dependencies/:uid/sync-order
   * Get sync order for a content type
   */
  async getSyncOrder(ctx) {
    const { uid } = ctx.params;
    const depth = parseInt(ctx.query.depth, 10) || 1;
    try {
      const order = strapi.plugin(PLUGIN_ID).service('dependencyResolver').getSyncOrder(uid, depth);
      ctx.body = { data: order };
    } catch (err) {
      ctx.throw(400, err.message);
    }
  },

  /**
   * GET /dependencies/:uid/summary
   * Get dependency summary for UI
   */
  async getSummary(ctx) {
    const { uid } = ctx.params;
    const depth = parseInt(ctx.query.depth, 10) || 1;
    try {
      const summary = strapi.plugin(PLUGIN_ID).service('dependencyResolver').getDependencySummary(uid, depth);
      ctx.body = { data: summary };
    } catch (err) {
      ctx.throw(400, err.message);
    }
  },

  /**
   * POST /dependencies/clear-cache
   * Clear dependency cache
   */
  async clearCache(ctx) {
    try {
      strapi.plugin(PLUGIN_ID).service('dependencyResolver').clearCache();
      ctx.body = { data: { success: true } };
    } catch (err) {
      ctx.throw(500, err.message);
    }
  },
});
