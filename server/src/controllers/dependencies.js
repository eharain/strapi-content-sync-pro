'use strict';

const PLUGIN_ID = 'strapi-content-sync-pro';

module.exports = ({ strapi }) => ({
  /**
   * GET /dependencies/all
   * Get dependency analysis for all enabled content types
   */
  async analyzeAll(ctx) {
    try {
      const dependencyResolver = strapi.plugin(PLUGIN_ID).service('dependencyResolver');
      const syncConfig = strapi.plugin(PLUGIN_ID).service('syncConfig');

      const config = await syncConfig.getSyncConfig();
      const enabledTypes = (config.contentTypes || [])
        .filter((ct) => ct.enabled)
        .map((ct) => ct.uid);

      const allDependencies = {};

      for (const uid of enabledTypes) {
        try {
          const analysis = dependencyResolver.analyzeContentType(uid);
          allDependencies[uid] = analysis.relations || [];
        } catch (err) {
          // Skip if content type doesn't exist
          allDependencies[uid] = [];
        }
      }

      ctx.body = { data: allDependencies };
    } catch (err) {
      ctx.throw(500, err.message);
    }
  },

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
