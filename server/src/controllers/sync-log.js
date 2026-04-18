'use strict';

module.exports = {
  async find(ctx) {
    const { page, pageSize, status, contentType, action } = ctx.query;

    const service = strapi.plugin('strapi-to-strapi-data-sync').service('syncLog');
    const result = await service.getLogs({
      page: page ? parseInt(page, 10) : 1,
      pageSize: pageSize ? parseInt(pageSize, 10) : 25,
      status,
      contentType,
      action,
    });

    ctx.body = result;
  },
};
