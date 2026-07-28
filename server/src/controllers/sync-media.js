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

  async pauseProfile(ctx) {
    try {
      ctx.body = { data: await service(strapi).pauseProfile(ctx.params.id) };
    } catch (err) {
      ctx.throw(400, err.message);
    }
  },

  async resumeProfile(ctx) {
    try {
      ctx.body = { data: await service(strapi).resumeProfile(ctx.params.id) };
    } catch (err) {
      ctx.throw(400, err.message);
    }
  },

  async cancelProfile(ctx) {
    try {
      ctx.body = { data: await service(strapi).cancelProfile(ctx.params.id) };
    } catch (err) {
      ctx.throw(400, err.message);
    }
  },

  // ── Owner-side entity → file links (current media link strategy) ─────────

  /**
   * GET /media-sync/entity-media-links?uid=…&page=…&pageSize=…
   * Called by the peer during a pull. Returns one page of media links for a
   * single owning content type.
   */
  async getEntityMediaLinks(ctx) {
    try {
      const { uid, page, pageSize } = ctx.query || {};
      if (!uid) return ctx.badRequest('uid query parameter is required');
      const data = await service(strapi).exportEntityMediaLinks({
        uid,
        page: Number(page) || 1,
        pageSize: Number(pageSize) || 100,
      });
      ctx.body = { data };
    } catch (err) {
      ctx.throw(400, err.message);
    }
  },

  /**
   * POST /media-sync/entity-media-links/apply
   * Called by the peer during a push. HMAC-signed like /receive — applying
   * links mutates content, so a bare API token must not be enough.
   */
  async applyEntityMediaLinks(ctx) {
    try {
      const links = ctx.request.body?.links || [];
      ctx.body = { data: await service(strapi).applyEntityMediaLinks(links) };
    } catch (err) {
      ctx.throw(400, err.message);
    }
  },

  /**
   * GET /media-sync/link-scope
   * The owning content types whose media links participate in a run.
   */
  async getMediaLinkScope(ctx) {
    try {
      const uids = (ctx.query?.uids || '').split(',').map((s) => s.trim()).filter(Boolean);
      const scope = await service(strapi).resolveMediaLinkScope(uids);
      ctx.body = { data: scope };
    } catch (err) {
      ctx.throw(400, err.message);
    }
  },

  // ── Legacy morph link sync (back-compat with older peers only) ───────────

  async getMorphLinks(ctx) {
    try {
      ctx.body = { data: await service(strapi).exportMorphLinks() };
    } catch (err) {
      ctx.throw(500, err.message);
    }
  },

  async applyMorphLinks(ctx) {
    try {
      const links = ctx.request.body?.links || [];
      ctx.body = { data: await service(strapi).applyMorphLinks(links) };
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
