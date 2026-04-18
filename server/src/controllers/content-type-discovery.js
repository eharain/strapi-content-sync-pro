'use strict';

module.exports = {
  async find(ctx) {
    const service = strapi.plugin('strapi-to-strapi-data-sync').service('contentTypeDiscovery');
    const contentTypes = service.getSyncableContentTypes();
    ctx.body = { data: contentTypes };
  },
};
