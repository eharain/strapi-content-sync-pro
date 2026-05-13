'use strict';

const verifySignature = require('./verify-signature');

/**
 * Strapi v5 plugin middleware registry.
 * Each entry must be a middleware factory: (config, { strapi }) => (ctx, next) => {...}.
 * Middlewares are referenced by name string in route configs:
 *   middlewares: ['plugin::strapi-content-sync-pro.verifySignature']
 */
module.exports = {
  verifySignature,
};
