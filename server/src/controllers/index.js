'use strict';

const ping = require('./ping');
const config = require('./config');
const contentTypeDiscovery = require('./content-type-discovery');
const syncConfig = require('./sync-config');
const sync = require('./sync');
const syncLog = require('./sync-log');

module.exports = {
  ping,
  config,
  contentTypeDiscovery,
  syncConfig,
  sync,
  syncLog,
};
