'use strict';

const { verifySignature } = require('../utils/hmac');

/**
 * Strapi v5 middleware factory. Validates the HMAC signature sent by a
 * remote Strapi instance. Used on the /receive endpoint.
 */
module.exports = (config, { strapi }) => async (ctx, next) => {
  const signature = ctx.request.headers['x-sync-signature'];
  const timestamp = ctx.request.headers['x-sync-timestamp'];

  if (!signature || !timestamp) {
    return ctx.unauthorized('Missing x-sync-signature or x-sync-timestamp header');
  }

  const configService = strapi.plugin('strapi-content-sync-pro').service('config');
  const serverConfig = await configService.getConfig({ safe: false });

  if (!serverConfig || !serverConfig.sharedSecret) {
    return ctx.unauthorized('Server not configured for sync');
  }

  const body = ctx.request.body || {};
  const isValid = verifySignature(body, serverConfig.sharedSecret, signature, timestamp);

  if (!isValid) {
    return ctx.unauthorized('Invalid sync signature');
  }

  await next();
};
