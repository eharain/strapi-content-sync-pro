'use strict';

const { DEPENDENCY_DEPTH } = require('../utils/strategy');

const PLUGIN_ID = 'strapi-content-sync-pro';

/**
 * The set of content types currently in sync scope. Dependency expansion is
 * in-scope only, so every read endpoint filters through this unless the caller
 * explicitly asks for the unscoped view (`?scope=all`) to see what enabling
 * more types would make available.
 */
async function scopeFor(strapi, ctx) {
  if ((ctx.query.scope || 'enabled') === 'all') return new Set();
  const config = await strapi.plugin(PLUGIN_ID).service('syncConfig').getSyncConfig();
  return new Set((config.contentTypes || []).filter((ct) => ct.enabled).map((ct) => ct.uid));
}

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
   * Direct (depth-1, owner-side) dependency graph for a content type.
   * A `depth` query parameter is accepted for back-compat and ignored — depth
   * is fixed by the strategy contract.
   */
  async getGraph(ctx) {
    const { uid } = ctx.params;
    try {
      const scope = await scopeFor(strapi, ctx);
      const graph = strapi.plugin(PLUGIN_ID).service('dependencyResolver')
        .buildDependencyGraph(uid, DEPENDENCY_DEPTH, scope);
      ctx.body = { data: graph, meta: { depth: DEPENDENCY_DEPTH, depthFixed: true } };
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
    try {
      const scope = await scopeFor(strapi, ctx);
      const order = strapi.plugin(PLUGIN_ID).service('dependencyResolver')
        .getSyncOrder(uid, DEPENDENCY_DEPTH, scope);
      ctx.body = { data: order, meta: { depth: DEPENDENCY_DEPTH, depthFixed: true } };
    } catch (err) {
      ctx.throw(400, err.message);
    }
  },

  /**
   * GET /dependencies/:uid/summary
   * Get dependency summary for UI, including what the constraints excluded.
   */
  async getSummary(ctx) {
    const { uid } = ctx.params;
    try {
      const scope = await scopeFor(strapi, ctx);
      const summary = strapi.plugin(PLUGIN_ID).service('dependencyResolver')
        .getDependencySummary(uid, DEPENDENCY_DEPTH, scope);
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
