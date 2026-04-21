'use strict';

const ping = require('./ping');
const config = require('./config');
const contentTypeDiscovery = require('./content-type-discovery');
const syncConfig = require('./sync-config');
const sync = require('./sync');
const syncLog = require('./sync-log');
const syncProfiles = require('./sync-profiles');
const syncExecution = require('./sync-execution');
const syncEnforcement = require('./sync-enforcement');
const syncMedia = require('./sync-media');
const alerts = require('./alerts');
const dependencies = require('./dependencies');
const syncStats = require('./sync-stats');

module.exports = {
  ping,
  config,
  contentTypeDiscovery,
  syncConfig,
  sync,
  syncLog,
  syncProfiles,
  syncExecution,
  syncEnforcement,
  syncMedia,
  alerts,
  dependencies,
  syncStats,
};
