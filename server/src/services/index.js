'use strict';

const ping = require('./ping');
const config = require('./config');
const contentTypeDiscovery = require('./content-type-discovery');
const syncConfig = require('./sync-config');
const sync = require('./sync');
const syncLog = require('./sync-log');
const syncProfiles = require('./sync-profiles');
const syncExecution = require('./sync-execution');
const dependencyResolver = require('./dependency-resolver');
const syncEnforcement = require('./sync-enforcement');
const syncMedia = require('./sync-media');
const alerts = require('./alerts');
const syncStats = require('./sync-stats');
const bulkTransfer = require('./bulk-transfer');

module.exports = {
  ping,
  config,
  contentTypeDiscovery,
  syncConfig,
  sync,
  syncLog,
  syncProfiles,
  syncExecution,
  dependencyResolver,
  syncEnforcement,
  syncMedia,
  alerts,
  syncStats,
  bulkTransfer,
};

