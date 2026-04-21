'use strict';

const CONTENT_TYPE_UID = 'plugin::strapi-content-sync-pro.sync-log';

module.exports = ({ strapi }) => ({
  async log({ action, contentType, recordId, syncId, direction, status, message, details }) {
    try {
      await strapi.documents(CONTENT_TYPE_UID).create({
        data: {
          action: action || 'unknown',
          contentType: contentType || '',
          recordId: recordId || '',
          syncId: syncId || '',
          direction: direction || '',
          status: status || 'info',
          message: message || '',
          details: details || null,
        },
      });
    } catch (err) {
      strapi.log.error(`[data-sync] Failed to write log: ${err.message}`);
      strapi.log.info(`[data-sync] ${action} | ${contentType} | ${status} | ${message}`);
    }
  },

  async getLogs({ page = 1, pageSize = 25, status, contentType, action } = {}) {
    const filters = {};
    if (status) filters.status = status;
    if (contentType) filters.contentType = contentType;
    if (action) filters.action = action;

    const start = (page - 1) * pageSize;

    const [entries, count] = await Promise.all([
      strapi.documents(CONTENT_TYPE_UID).findMany({
        filters,
        sort: { createdAt: 'desc' },
        limit: pageSize,
        start,
      }),
      strapi.documents(CONTENT_TYPE_UID).count({ filters }),
    ]);

    return {
      data: entries,
      meta: {
        pagination: {
          page,
          pageSize,
          pageCount: Math.ceil(count / pageSize),
          total: count,
        },
      },
    };
  },

  async clearLogs() {
    const existing = await strapi.documents(CONTENT_TYPE_UID).findMany({
      fields: ['documentId'],
      limit: 10000,
      sort: { createdAt: 'desc' },
    });

    for (const entry of existing) {
      if (!entry?.documentId) continue;
      await strapi.documents(CONTENT_TYPE_UID).delete({ documentId: entry.documentId });
    }

    return { deleted: existing.length };
  },

  async applyRetention({ maxLogs = 2000 } = {}) {
    const safeMax = Math.max(100, Number(maxLogs) || 2000);
    const count = await strapi.documents(CONTENT_TYPE_UID).count();
    if (count <= safeMax) return { pruned: 0, remaining: count };

    const excess = count - safeMax;
    const toDelete = await strapi.documents(CONTENT_TYPE_UID).findMany({
      fields: ['documentId'],
      sort: { createdAt: 'asc' },
      limit: excess,
      start: 0,
    });

    for (const entry of toDelete) {
      if (!entry?.documentId) continue;
      await strapi.documents(CONTENT_TYPE_UID).delete({ documentId: entry.documentId });
    }

    return { pruned: toDelete.length, remaining: count - toDelete.length };
  },
});
