'use strict';

module.exports = {
  async find(ctx) {
    const service = strapi.plugin('strapi-content-sync-pro').service('contentTypeDiscovery');
    const contentTypes = service.getSyncableContentTypes();
    ctx.body = { data: contentTypes };
  },
};
