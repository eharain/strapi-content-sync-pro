'use strict';

const { uidToPluralEndpoint } = require('../utils/fetcher');

const RUN_REPORT_UID = 'plugin::strapi-content-sync-pro.sync-run-report';

module.exports = ({ strapi }) => {
  function plugin() {
    return strapi.plugin('strapi-content-sync-pro');
  }

  async function getEnabledContentTypes() {
    const syncConfig = await plugin().service('syncConfig').getSyncConfig();
    return (syncConfig.contentTypes || []).filter((ct) => ct.enabled).map((ct) => ct.uid);
  }

  async function fetchRemoteStats(remoteConfig, uid) {
    const { baseUrl, apiToken } = remoteConfig || {};
    if (!baseUrl || !apiToken) {
      return { count: null, newestUpdatedAt: null, error: 'Remote server is not configured' };
    }

    const endpoint = uidToPluralEndpoint(uid);

    try {
      const countUrl = new URL(`/api/${endpoint}`, baseUrl);
      countUrl.searchParams.set('pagination[page]', '1');
      countUrl.searchParams.set('pagination[pageSize]', '1');
      countUrl.searchParams.set('fields[0]', 'updatedAt');
      const countRes = await fetch(countUrl.toString(), {
        method: 'GET',
        headers: { Authorization: `Bearer ${apiToken}`, 'Content-Type': 'application/json' },
      });
      if (!countRes.ok) {
        return { count: null, newestUpdatedAt: null, error: `Remote count fetch failed (${countRes.status})` };
      }
      const countBody = await countRes.json();
      const count = countBody?.meta?.pagination?.total ?? null;

      const newestUrl = new URL(`/api/${endpoint}`, baseUrl);
      newestUrl.searchParams.set('pagination[page]', '1');
      newestUrl.searchParams.set('pagination[pageSize]', '1');
      newestUrl.searchParams.set('sort', 'updatedAt:desc');
      newestUrl.searchParams.set('fields[0]', 'updatedAt');
      const newestRes = await fetch(newestUrl.toString(), {
        method: 'GET',
        headers: { Authorization: `Bearer ${apiToken}`, 'Content-Type': 'application/json' },
      });
      if (!newestRes.ok) {
        return { count, newestUpdatedAt: null, error: `Remote newest fetch failed (${newestRes.status})` };
      }

      const newestBody = await newestRes.json();
      const newestUpdatedAt = newestBody?.data?.[0]?.updatedAt || null;
      return { count, newestUpdatedAt, error: null };
    } catch (err) {
      return { count: null, newestUpdatedAt: null, error: err.message };
    }
  }

  function whereNewest(localTs, remoteTs) {
    if (!localTs && !remoteTs) return 'equal';
    if (localTs && !remoteTs) return 'local';
    if (!localTs && remoteTs) return 'remote';
    const l = new Date(localTs).getTime();
    const r = new Date(remoteTs).getTime();
    if (l === r) return 'equal';
    return l > r ? 'local' : 'remote';
  }

  return {
    async collectSnapshot({ contentTypes } = {}) {
      const configService = plugin().service('config');
      const remoteConfig = await configService.getConfig({ safe: false });
      const targets = Array.isArray(contentTypes) && contentTypes.length > 0
        ? contentTypes
        : await getEnabledContentTypes();

      const rows = [];
      for (const uid of targets) {
        let localCount = null;
        let localNewestUpdatedAt = null;
        let localError = null;
        try {
          localCount = await strapi.documents(uid).count({});
          const newest = await strapi.documents(uid).findMany({
            sort: { updatedAt: 'desc' },
            limit: 1,
            fields: ['updatedAt'],
          });
          localNewestUpdatedAt = newest?.[0]?.updatedAt || null;
        } catch (err) {
          localError = err.message;
        }

        const remote = await fetchRemoteStats(remoteConfig, uid);
        rows.push({
          uid,
          localCount,
          remoteCount: remote.count,
          localNewestUpdatedAt,
          remoteNewestUpdatedAt: remote.newestUpdatedAt,
          newestSide: whereNewest(localNewestUpdatedAt, remote.newestUpdatedAt),
          localError,
          remoteError: remote.error,
        });
      }

      return {
        generatedAt: new Date().toISOString(),
        contentTypes: targets,
        rows,
      };
    },

    async createRunReport({ runType = 'content', trigger = 'manual', contentTypes = [], beforeStats = null }) {
      const startedAt = new Date().toISOString();
      const baseBefore = beforeStats || await this.collectSnapshot({ contentTypes });
      const doc = await strapi.documents(RUN_REPORT_UID).create({
        data: {
          runType,
          trigger,
          status: 'running',
          startedAt,
          completedAt: null,
          contentTypes: baseBefore.contentTypes,
          beforeStats: baseBefore,
          afterStats: null,
          summary: null,
          error: null,
        },
      });
      return { reportId: doc.documentId, startedAt, beforeStats: baseBefore };
    },

    async completeRunReport(reportId, { status = 'success', summary = null, error = null } = {}) {
      if (!reportId) return null;
      const report = await strapi.documents(RUN_REPORT_UID).findFirst({
        filters: { documentId: reportId },
        fields: ['documentId'],
      });
      if (!report?.documentId) return null;

      const before = await strapi.documents(RUN_REPORT_UID).findFirst({
        filters: { documentId: reportId },
        fields: ['contentTypes'],
      });

      const afterStats = await this.collectSnapshot({ contentTypes: before?.contentTypes || [] });
      await strapi.documents(RUN_REPORT_UID).update({
        documentId: report.documentId,
        data: {
          status,
          completedAt: new Date().toISOString(),
          afterStats,
          summary: summary || null,
          error: error || null,
        },
      });
      return { reportId: report.documentId, status };
    },

    async getLatestSnapshot() {
      return this.collectSnapshot({});
    },

    async getReports({ page = 1, pageSize = 10 } = {}) {
      const start = (page - 1) * pageSize;
      const [data, total] = await Promise.all([
        strapi.documents(RUN_REPORT_UID).findMany({
          sort: { createdAt: 'desc' },
          start,
          limit: pageSize,
        }),
        strapi.documents(RUN_REPORT_UID).count(),
      ]);

      return {
        data,
        meta: {
          pagination: {
            page,
            pageSize,
            pageCount: Math.ceil(total / pageSize),
            total,
          },
        },
      };
    },

    async clearReports() {
      const existing = await strapi.documents(RUN_REPORT_UID).findMany({
        fields: ['documentId'],
        sort: { createdAt: 'desc' },
        limit: 10000,
      });

      for (const report of existing) {
        if (!report?.documentId) continue;
        await strapi.documents(RUN_REPORT_UID).delete({ documentId: report.documentId });
      }

      return { deleted: existing.length };
    },

    async applyRetention({ maxReports = 200 } = {}) {
      const safeMax = Math.max(10, Number(maxReports) || 200);
      const total = await strapi.documents(RUN_REPORT_UID).count();
      if (total <= safeMax) return { pruned: 0, remaining: total };

      const excess = total - safeMax;
      const oldReports = await strapi.documents(RUN_REPORT_UID).findMany({
        fields: ['documentId'],
        sort: { createdAt: 'asc' },
        limit: excess,
      });

      for (const report of oldReports) {
        if (!report?.documentId) continue;
        await strapi.documents(RUN_REPORT_UID).delete({ documentId: report.documentId });
      }

      return { pruned: oldReports.length, remaining: total - oldReports.length };
    },
  };
};
