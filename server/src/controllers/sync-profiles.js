'use strict';

const PLUGIN_ID = 'strapi-content-sync-pro';

module.exports = ({ strapi }) => ({
  /**
   * GET /sync-profiles
   * List all sync profiles
   */
  async find(ctx) {
    try {
      const profiles = await strapi.plugin(PLUGIN_ID).service('syncProfiles').getProfiles();
      ctx.body = { data: profiles };
    } catch (err) {
      ctx.throw(500, err.message);
    }
  },

  /**
   * GET /sync-profiles/:id
   * Get a single sync profile
   */
  async findOne(ctx) {
    const { id } = ctx.params;
    try {
      const profile = await strapi.plugin(PLUGIN_ID).service('syncProfiles').getProfile(id);
      if (!profile) {
        return ctx.throw(404, `Profile with id "${id}" not found`);
      }
      ctx.body = { data: profile };
    } catch (err) {
      ctx.throw(500, err.message);
    }
  },

  /**
   * GET /sync-profiles/content-type/:uid
   * Get all profiles for a content type
   */
  async findByContentType(ctx) {
    const { uid } = ctx.params;
    try {
      const profiles = await strapi.plugin(PLUGIN_ID).service('syncProfiles').getProfilesForContentType(uid);
      ctx.body = { data: profiles };
    } catch (err) {
      ctx.throw(500, err.message);
    }
  },

  /**
   * GET /sync-profiles/content-type/:uid/active
   * Get active profile for a content type
   */
  async findActiveByContentType(ctx) {
    const { uid } = ctx.params;
    try {
      const profile = await strapi.plugin(PLUGIN_ID).service('syncProfiles').getActiveProfileForContentType(uid);
      ctx.body = { data: profile };
    } catch (err) {
      ctx.throw(500, err.message);
    }
  },

  /**
   * POST /sync-profiles
   * Create a new sync profile
   */
  async create(ctx) {
    const body = ctx.request.body;
    try {
      const profile = await strapi.plugin(PLUGIN_ID).service('syncProfiles').createProfile(body);
      ctx.body = { data: profile };
    } catch (err) {
      ctx.throw(400, err.message);
    }
  },

  /**
   * POST /sync-profiles/auto-generate
   * Auto-generate default profiles for a content type
   */
  async autoGenerate(ctx) {
    const { contentType } = ctx.request.body;
    if (!contentType) {
      return ctx.throw(400, 'contentType is required');
    }
    try {
      const profiles = await strapi.plugin(PLUGIN_ID).service('syncProfiles').autoGenerateProfiles(contentType);
      ctx.body = { data: profiles };
    } catch (err) {
      ctx.throw(400, err.message);
    }
  },

  /**
   * POST /sync-profiles/simple
   * Create a simple preset profile
   */
  async createSimple(ctx) {
    const { contentType, preset } = ctx.request.body;
    if (!contentType) {
      return ctx.throw(400, 'contentType is required');
    }
    if (!preset) {
      return ctx.throw(400, 'preset is required');
    }
    try {
      const profile = await strapi.plugin(PLUGIN_ID).service('syncProfiles').createSimpleProfile(contentType, preset);
      ctx.body = { data: profile };
    } catch (err) {
      ctx.throw(400, err.message);
    }
  },

  /**
   * PUT /sync-profiles/:id
   * Update an existing sync profile
   */
  async update(ctx) {
    const { id } = ctx.params;
    const body = ctx.request.body;
    try {
      const profile = await strapi.plugin(PLUGIN_ID).service('syncProfiles').updateProfile(id, body);
      ctx.body = { data: profile };
    } catch (err) {
      if (err.message.includes('not found')) {
        return ctx.throw(404, err.message);
      }
      ctx.throw(400, err.message);
    }
  },

  /**
   * DELETE /sync-profiles/:id
   * Delete a sync profile
   */
  async delete(ctx) {
    const { id } = ctx.params;
    try {
      const result = await strapi.plugin(PLUGIN_ID).service('syncProfiles').deleteProfile(id);
      ctx.body = { data: result };
    } catch (err) {
      if (err.message.includes('not found')) {
        return ctx.throw(404, err.message);
      }
      ctx.throw(500, err.message);
    }
  },

  /**
   * GET /content-type-schema/:uid
   * Get schema/fields for a content type (for UI to display available fields)
   */
  async getContentTypeSchema(ctx) {
    const { uid } = ctx.params;
    try {
      const contentType = strapi.contentTypes[uid];
      if (!contentType) {
        return ctx.throw(404, `Content type "${uid}" not found`);
      }

      const attributes = contentType.attributes || {};
      const fields = Object.entries(attributes).map(([name, attr]) => ({
        name,
        type: attr.type,
        required: attr.required || false,
        relation: attr.type === 'relation' ? attr.relation : null,
        target: attr.target || null,
      }));

      ctx.body = {
        data: {
          uid,
          displayName: contentType.info?.displayName || uid,
          fields,
        },
      };
    } catch (err) {
      ctx.throw(500, err.message);
    }
  },
});
