'use strict';

const PLUGIN_ID = 'strapi-content-sync-pro';

function service(strapi) {
  return strapi.plugin(PLUGIN_ID).service('syncMedia');
}

module.exports = ({ strapi }) => ({
  // ── Profile CRUD ──────────────────────────────────────────────────────────

  async getProfiles(ctx) {
    try {
      ctx.body = { data: await service(strapi).getProfiles() };
    } catch (err) {
      ctx.throw(500, err.message);
    }
  },

  async getProfile(ctx) {
    try {
      const profile = await service(strapi).getProfile(ctx.params.id);
      if (!profile) return ctx.throw(404, 'Media profile not found');
      ctx.body = { data: profile };
    } catch (err) {
      ctx.throw(500, err.message);
    }
  },

  async createProfile(ctx) {
    try {
      const body = ctx.request.body || {};
      ctx.body = { data: await service(strapi).createProfile(body) };
    } catch (err) {
      ctx.throw(400, err.message);
    }
  },

  async updateProfile(ctx) {
    try {
      const body = ctx.request.body || {};
      ctx.body = { data: await service(strapi).updateProfile(ctx.params.id, body) };
    } catch (err) {
      ctx.throw(400, err.message);
    }
  },

  async deleteProfile(ctx) {
    try {
      ctx.body = { data: await service(strapi).deleteProfile(ctx.params.id) };
    } catch (err) {
      ctx.throw(400, err.message);
    }
  },

  async activateProfile(ctx) {
    try {
      ctx.body = { data: await service(strapi).activateProfile(ctx.params.id) };
    } catch (err) {
      ctx.throw(400, err.message);
    }
  },

  // ── Global settings ───────────────────────────────────────────────────────

  async getGlobalSettings(ctx) {
    try {
      ctx.body = { data: await service(strapi).getGlobalSettings() };
    } catch (err) {
      ctx.throw(500, err.message);
    }
  },

  async updateGlobalSettings(ctx) {
    try {
      const body = ctx.request.body || {};
      ctx.body = { data: await service(strapi).setGlobalSettings(body) };
    } catch (err) {
      ctx.throw(400, err.message);
    }
  },

  // ── Defaults / constants ──────────────────────────────────────────────────

  async getDefaults(ctx) {
    try {
      ctx.body = { data: service(strapi).getDefaults() };
    } catch (err) {
      ctx.throw(500, err.message);
    }
  },

  // ── Execution ─────────────────────────────────────────────────────────────

  async runProfile(ctx) {
    try {
      const options = ctx.request.body || {};
      const result = await service(strapi).runProfile(ctx.params.id, options);
      ctx.body = { data: result };
    } catch (err) {
      ctx.throw(400, err.message);
    }
  },

  async runActiveProfiles(ctx) {
    try {
      const results = await service(strapi).runActiveProfiles();
      ctx.body = { data: results };
    } catch (err) {
      ctx.throw(400, err.message);
    }
  },

  // ── Back-compat (old flat endpoints) ──────────────────────────────────────

  async getSettings(ctx) {
    try {
      ctx.body = { data: await service(strapi).getSettings() };
    } catch (err) {
      ctx.throw(500, err.message);
    }
  },

  async updateSettings(ctx) {
    try {
      const body = ctx.request.body || {};
      ctx.body = { data: await service(strapi).setSettings(body) };
    } catch (err) {
      ctx.throw(400, err.message);
    }
  },

  async getStatus(ctx) {
    try {
      ctx.body = { data: await service(strapi).getStatus() };
    } catch (err) {
      ctx.throw(500, err.message);
    }
  },

  async test(ctx) {
    try {
      ctx.body = { data: await service(strapi).testConnection() };
    } catch (err) {
      ctx.throw(500, err.message);
    }
  },

  async run(ctx) {
    try {
      const options = ctx.request.body || {};
      const result = await service(strapi).run(options);
      ctx.body = { data: result };
    } catch (err) {
      ctx.throw(400, err.message);
    }
  },
});
