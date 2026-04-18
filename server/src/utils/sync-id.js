'use strict';

const crypto = require('crypto');

function generateSyncId() {
  return crypto.randomUUID();
}

function ensureSyncId(data) {
  if (!data.syncId) {
    data.syncId = generateSyncId();
  }
  return data;
}

module.exports = { generateSyncId, ensureSyncId };
