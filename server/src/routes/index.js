'use strict';

const verifySignature = require('../middlewares/verify-signature');

module.exports = [
  // Step 1 — Ping
  {
    method: 'GET',
    path: '/ping',
    handler: 'ping.index',
    config: { policies: [], auth: false },
  },
  // Step 2 — Remote server config
  {
    method: 'GET',
    path: '/config',
    handler: 'config.get',
    config: { policies: [] },
  },
  {
    method: 'POST',
    path: '/config',
    handler: 'config.set',
    config: { policies: [] },
  },
  // Step 3 — Content-type discovery
  {
    method: 'GET',
    path: '/content-types',
    handler: 'contentTypeDiscovery.find',
    config: { policies: [] },
  },
  // Step 4 — Sync configuration
  {
    method: 'GET',
    path: '/sync-config',
    handler: 'syncConfig.get',
    config: { policies: [] },
  },
  {
    method: 'POST',
    path: '/sync-config',
    handler: 'syncConfig.set',
    config: { policies: [] },
  },
  // Step 6 — Manual sync
  {
    method: 'POST',
    path: '/sync-now',
    handler: 'sync.syncNow',
    config: { policies: [] },
  },
  // Step 9 — Receive from remote (HMAC-protected, no admin auth)
  {
    method: 'POST',
    path: '/receive',
    handler: 'sync.receive',
    config: {
      policies: [],
      auth: false,
      middlewares: [verifySignature],
    },
  },
  // Step 11 — Logs
  {
    method: 'GET',
    path: '/logs',
    handler: 'syncLog.find',
    config: { policies: [] },
  },
];
