'use strict';

const destroy = ({ strapi }) => {
  // Tear down in-process schedulers (interval / timeout / cron handles) so they
  // don't leak across dev hot-reloads or a clean shutdown.
  try {
    const executionService = strapi
      .plugin('strapi-content-sync-pro')
      .service('syncExecution');
    if (executionService && typeof executionService.stopAllSchedulers === 'function') {
      executionService.stopAllSchedulers();
    }
  } catch (err) {
    strapi.log?.error?.(`[data-sync] destroy: failed to stop schedulers: ${err.message}`);
  }
};

module.exports = destroy;
