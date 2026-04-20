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
});
