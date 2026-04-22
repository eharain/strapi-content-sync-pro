'use strict';

const verifySignature = require('../middlewares/verify-signature');

/**
 * Strapi v5 plugin routes MUST be split between:
 *   - content-api: exposed under /api/<plugin>/...  (remote server calls)
 *   - admin:       exposed under /<plugin>/...      (local admin UI calls)
 */

const contentApiRoutes = [
  { method: 'GET',  path: '/ping',                    handler: 'ping.index',                     config: { policies: [], auth: false } },
  { method: 'GET',  path: '/enforcement/local-info',  handler: 'syncEnforcement.getLocalInfo',   config: { policies: [] } },
  { method: 'GET',  path: '/enforcement/schema/:uid', handler: 'syncEnforcement.getLocalSchema', config: { policies: [] } },
  { method: 'POST', path: '/receive',                 handler: 'sync.receive',                   config: { policies: [], auth: false, middlewares: [verifySignature] } },

  // Media morph-link sync (called by the peer instance during runProfile)
  { method: 'GET',  path: '/media-sync/morph-links',       handler: 'syncMedia.getMorphLinks',   config: { policies: [] } },
  { method: 'POST', path: '/media-sync/morph-links/apply', handler: 'syncMedia.applyMorphLinks', config: { policies: [] } },
];

const adminRoutes = [
  // Config
  { method: 'GET',  path: '/config',              handler: 'config.get',         config: { policies: [] } },
  { method: 'POST', path: '/config',              handler: 'config.set',         config: { policies: [] } },
  { method: 'POST', path: '/config/remote-login', handler: 'config.remoteLogin', config: { policies: [] } },
  { method: 'GET',  path: '/config/test',         handler: 'config.test',        config: { policies: [] } },

  // Content-type discovery
  { method: 'GET', path: '/content-types', handler: 'contentTypeDiscovery.find', config: { policies: [] } },

  // Sync configuration
  { method: 'GET',  path: '/sync-config', handler: 'syncConfig.get', config: { policies: [] } },
  { method: 'POST', path: '/sync-config', handler: 'syncConfig.set', config: { policies: [] } },

  // Manual sync trigger
  { method: 'POST', path: '/sync-now', handler: 'sync.syncNow', config: { policies: [] } },

  // Logs
  { method: 'GET', path: '/logs', handler: 'syncLog.find', config: { policies: [] } },

  // Stats and retention
  { method: 'GET',  path: '/stats/snapshot',  handler: 'syncStats.getSnapshot',  config: { policies: [] } },
  { method: 'GET',  path: '/stats/reports',   handler: 'syncStats.getReports',   config: { policies: [] } },
  { method: 'POST', path: '/stats/reports/clear', handler: 'syncStats.clearReports', config: { policies: [] } },
  { method: 'POST', path: '/stats/retention/run', handler: 'syncStats.runRetention', config: { policies: [] } },
  { method: 'POST', path: '/logs/clear', handler: 'syncLog.clear', config: { policies: [] } },

  // Sync Profiles
  { method: 'GET',    path: '/sync-profiles',                          handler: 'syncProfiles.find',                    config: { policies: [] } },
  { method: 'GET',    path: '/sync-profiles/:id',                      handler: 'syncProfiles.findOne',                 config: { policies: [] } },
  { method: 'GET',    path: '/sync-profiles/content-type/:uid',        handler: 'syncProfiles.findByContentType',       config: { policies: [] } },
  { method: 'GET',    path: '/sync-profiles/content-type/:uid/active', handler: 'syncProfiles.findActiveByContentType', config: { policies: [] } },
  { method: 'POST',   path: '/sync-profiles',                          handler: 'syncProfiles.create',                  config: { policies: [] } },
  { method: 'POST',   path: '/sync-profiles/auto-generate',            handler: 'syncProfiles.autoGenerate',            config: { policies: [] } },
  { method: 'POST',   path: '/sync-profiles/simple',                   handler: 'syncProfiles.createSimple',            config: { policies: [] } },
  { method: 'PUT',    path: '/sync-profiles/:id',                      handler: 'syncProfiles.update',                  config: { policies: [] } },
  { method: 'DELETE', path: '/sync-profiles/:id',                      handler: 'syncProfiles.delete',                  config: { policies: [] } },
  { method: 'GET',    path: '/content-type-schema/:uid',               handler: 'syncProfiles.getContentTypeSchema',    config: { policies: [] } },

  // Sync Execution
  { method: 'GET',  path: '/sync-execution/settings',                  handler: 'syncExecution.getSettings',           config: { policies: [] } },
  { method: 'GET',  path: '/sync-execution/settings/:profileId',       handler: 'syncExecution.getProfileSettings',    config: { policies: [] } },
  { method: 'PUT',  path: '/sync-execution/settings/:profileId',       handler: 'syncExecution.updateProfileSettings', config: { policies: [] } },
  { method: 'GET',  path: '/sync-execution/global-settings',           handler: 'syncExecution.getGlobalSettings',     config: { policies: [] } },
  { method: 'PUT',  path: '/sync-execution/global-settings',           handler: 'syncExecution.updateGlobalSettings',  config: { policies: [] } },
  { method: 'POST', path: '/sync-execution/execute/:profileId',        handler: 'syncExecution.executeProfile',        config: { policies: [] } },
  { method: 'POST', path: '/sync-execution/execute-batch',             handler: 'syncExecution.executeProfiles',       config: { policies: [] } },
  { method: 'POST', path: '/sync-execution/execute-content-type/:uid', handler: 'syncExecution.executeContentType',    config: { policies: [] } },
  { method: 'GET',  path: '/sync-execution/status',                    handler: 'syncExecution.getStatus',             config: { policies: [] } },

  // Enforcement (admin-side)
  { method: 'GET',  path: '/enforcement/settings',    handler: 'syncEnforcement.getSettings',        config: { policies: [] } },
  { method: 'PUT',  path: '/enforcement/settings',    handler: 'syncEnforcement.updateSettings',     config: { policies: [] } },
  { method: 'GET',  path: '/enforcement/remote-info', handler: 'syncEnforcement.getRemoteInfo',      config: { policies: [] } },
  { method: 'GET',  path: '/enforcement/check/:type', handler: 'syncEnforcement.runDiagnosticCheck', config: { policies: [] } },
  { method: 'POST', path: '/enforcement/check',       handler: 'syncEnforcement.runChecks',          config: { policies: [] } },
  { method: 'GET',  path: '/enforcement/summary',     handler: 'syncEnforcement.getSummary',         config: { policies: [] } },

  // Alerts
  { method: 'GET',  path: '/alerts/settings',      handler: 'alerts.getSettings',    config: { policies: [] } },
  { method: 'PUT',  path: '/alerts/settings',      handler: 'alerts.updateSettings', config: { policies: [] } },
  { method: 'POST', path: '/alerts/test/:channel', handler: 'alerts.testChannel',    config: { policies: [] } },
  { method: 'GET',  path: '/alerts/stats',         handler: 'alerts.getStats',       config: { policies: [] } },

  // Media sync
  { method: 'GET',    path: '/media-sync/profiles',              handler: 'syncMedia.getProfiles',         config: { policies: [] } },
  { method: 'GET',    path: '/media-sync/profiles/:id',          handler: 'syncMedia.getProfile',          config: { policies: [] } },
  { method: 'POST',   path: '/media-sync/profiles',              handler: 'syncMedia.createProfile',       config: { policies: [] } },
  { method: 'PUT',    path: '/media-sync/profiles/:id',          handler: 'syncMedia.updateProfile',       config: { policies: [] } },
  { method: 'DELETE', path: '/media-sync/profiles/:id',          handler: 'syncMedia.deleteProfile',       config: { policies: [] } },
  { method: 'POST',   path: '/media-sync/profiles/:id/activate', handler: 'syncMedia.activateProfile',    config: { policies: [] } },
  { method: 'POST',   path: '/media-sync/profiles/:id/run',     handler: 'syncMedia.runProfile',          config: { policies: [] } },
  { method: 'POST',   path: '/media-sync/run-active',           handler: 'syncMedia.runActiveProfiles',   config: { policies: [] } },
  { method: 'GET',    path: '/media-sync/morph-links',          handler: 'syncMedia.getMorphLinks',       config: { policies: [] } },
  { method: 'POST',   path: '/media-sync/morph-links/apply',    handler: 'syncMedia.applyMorphLinks',     config: { policies: [] } },
  { method: 'GET',    path: '/media-sync/global-settings',       handler: 'syncMedia.getGlobalSettings',  config: { policies: [] } },
  { method: 'PUT',    path: '/media-sync/global-settings',       handler: 'syncMedia.updateGlobalSettings', config: { policies: [] } },
  { method: 'GET',    path: '/media-sync/defaults',              handler: 'syncMedia.getDefaults',         config: { policies: [] } },
  { method: 'GET',    path: '/media-sync/settings',              handler: 'syncMedia.getSettings',         config: { policies: [] } },
  { method: 'PUT',    path: '/media-sync/settings',              handler: 'syncMedia.updateSettings',      config: { policies: [] } },
  { method: 'GET',    path: '/media-sync/status',                handler: 'syncMedia.getStatus',           config: { policies: [] } },
  { method: 'POST',   path: '/media-sync/test',                  handler: 'syncMedia.test',                config: { policies: [] } },
  { method: 'POST',   path: '/media-sync/run',                   handler: 'syncMedia.run',                 config: { policies: [] } },

  // Dependencies
  { method: 'GET',  path: '/dependencies/all',             handler: 'dependencies.analyzeAll',   config: { policies: [] } },
  { method: 'GET',  path: '/dependencies/:uid',            handler: 'dependencies.analyze',      config: { policies: [] } },
  { method: 'GET',  path: '/dependencies/:uid/graph',      handler: 'dependencies.getGraph',     config: { policies: [] } },
  { method: 'GET',  path: '/dependencies/:uid/sync-order', handler: 'dependencies.getSyncOrder', config: { policies: [] } },
  { method: 'GET',  path: '/dependencies/:uid/summary',    handler: 'dependencies.getSummary',   config: { policies: [] } },
  { method: 'POST', path: '/dependencies/clear-cache',     handler: 'dependencies.clearCache',   config: { policies: [] } },

  // Bulk Transfer (one-click full pull / full push)
  { method: 'POST', path: '/bulk-transfer/preview',         handler: 'bulkTransfer.preview', config: { policies: [] } },
  { method: 'POST', path: '/bulk-transfer/start',           handler: 'bulkTransfer.start',   config: { policies: [] } },
  { method: 'GET',  path: '/bulk-transfer/jobs',            handler: 'bulkTransfer.list',    config: { policies: [] } },
  { method: 'GET',  path: '/bulk-transfer/jobs/:jobId',     handler: 'bulkTransfer.status',  config: { policies: [] } },
  { method: 'POST', path: '/bulk-transfer/jobs/:jobId/next',    handler: 'bulkTransfer.next',   config: { policies: [] } },
  { method: 'POST', path: '/bulk-transfer/jobs/:jobId/run-all', handler: 'bulkTransfer.runAll', config: { policies: [] } },
  { method: 'POST', path: '/bulk-transfer/jobs/:jobId/pause',   handler: 'bulkTransfer.pause',  config: { policies: [] } },
  { method: 'POST', path: '/bulk-transfer/jobs/:jobId/resume',  handler: 'bulkTransfer.resume', config: { policies: [] } },
  { method: 'POST', path: '/bulk-transfer/jobs/:jobId/cancel',  handler: 'bulkTransfer.cancel', config: { policies: [] } },
];

module.exports = {
  'content-api': {
    type: 'content-api',
    routes: contentApiRoutes,
  },
  admin: {
    type: 'admin',
    routes: adminRoutes,
  },
};
