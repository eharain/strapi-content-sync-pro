'use strict';

const PLUGIN_ID = 'strapi-content-sync-pro';

function svc(strapi) {
  return strapi.plugin(PLUGIN_ID).service('bulkTransfer');
}

module.exports = ({ strapi }) => ({
  async preview(ctx) {
    try {
      const body = ctx.request.body || {};
      const data = await svc(strapi).preview({
        direction: body.direction,
        scopes: body.scopes,
      });
      ctx.body = { data };
    } catch (err) {
      ctx.throw(400, err.message);
    }
  },

  async start(ctx) {
    try {
      const body = ctx.request.body || {};
      const data = await svc(strapi).start(body);
      ctx.body = { data };
    } catch (err) {
      ctx.throw(400, err.message);
    }
  },

  async next(ctx) {
    try {
      const { jobId } = ctx.params;
      const data = await svc(strapi).next(jobId);
      ctx.body = { data };
    } catch (err) {
      ctx.throw(400, err.message);
    }
  },

  async runAll(ctx) {
    try {
      const { jobId } = ctx.params;
      const data = await svc(strapi).runToCompletion(jobId);
      ctx.body = { data };
    } catch (err) {
      ctx.throw(400, err.message);
    }
  },

  async status(ctx) {
    try {
      const { jobId } = ctx.params;
      const data = svc(strapi).getStatus(jobId);
      if (!data) return ctx.notFound('Job not found');
      ctx.body = { data };
    } catch (err) {
      ctx.throw(500, err.message);
    }
  },

  async cancel(ctx) {
    try {
      const { jobId } = ctx.params;
      const data = await svc(strapi).cancel(jobId);
      ctx.body = { data };
    } catch (err) {
      ctx.throw(400, err.message);
    }
  },

  async pause(ctx) {
    try {
      const { jobId } = ctx.params;
      const data = await svc(strapi).pause(jobId);
      ctx.body = { data };
    } catch (err) {
      ctx.throw(400, err.message);
    }
  },

  async resume(ctx) {
    try {
      const { jobId } = ctx.params;
      const data = await svc(strapi).resume(jobId);
      ctx.body = { data };
    } catch (err) {
      ctx.throw(400, err.message);
    }
  },

  async list(ctx) {
    try {
      ctx.body = { data: svc(strapi).listJobs() };
    } catch (err) {
      ctx.throw(500, err.message);
    }
  },

  async history(ctx) {
    try {
      const data = await svc(strapi).getHistory();
      ctx.body = { data };
    } catch (err) {
      ctx.throw(500, err.message);
    }
  },

  async clearHistory(ctx) {
    try {
      const data = await svc(strapi).clearHistory();
      ctx.body = { data };
    } catch (err) {
      ctx.throw(500, err.message);
    }
  },

  async restart(ctx) {
    try {
      const { historyId } = ctx.params;
      const body = ctx.request.body || {};
      const data = await svc(strapi).restart(historyId, body);
      ctx.body = { data };
    } catch (err) {
      ctx.throw(400, err.message);
    }
  },

  async resumeFromHistory(ctx) {
    try {
      const { historyId } = ctx.params;
      const body = ctx.request.body || {};
      const data = await svc(strapi).resumeFromHistory(historyId, body);
      ctx.body = { data };
    } catch (err) {
      ctx.throw(400, err.message);
    }
  },
});
