'use strict';

const { generateSignature } = require('./hmac');
const { markAsRemoteUpdate } = require('./sync-guard');

/**
 * Apply a record received from a remote instance to the local database.
 */
async function applyLocal(strapi, uid, record, fields) {
  const data = filterFields(record, fields);
  const syncId = record.syncId;

  // Mark so the afterCreate/afterUpdate hook skips re-pushing
  markAsRemoteUpdate(`${uid}:${syncId}`);

  const existing = await strapi.documents(uid).findMany({
    filters: { syncId },
    limit: 1,
  });

  if (existing && existing.length > 0) {
    return strapi.documents(uid).update({
      documentId: existing[0].documentId,
      data,
    });
  }

  data.syncId = syncId;
  return strapi.documents(uid).create({ data });
}

/**
 * Push a local record to the remote instance via the plugin's /receive endpoint.
 */
async function applyRemote(remoteConfig, uid, record, fields) {
  const { baseUrl, apiToken, sharedSecret } = remoteConfig;
  const url = new URL('/strapi-to-strapi-data-sync/receive', baseUrl);

  const body = {
    uid,
    data: filterFields(record, fields),
    syncId: record.syncId,
  };

  const timestamp = Date.now().toString();
  const signature = generateSignature(body, sharedSecret, timestamp);

  const response = await fetch(url.toString(), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiToken}`,
      'Content-Type': 'application/json',
      'x-sync-signature': signature,
      'x-sync-timestamp': timestamp,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Remote apply failed for ${uid}: ${response.status} – ${text}`);
  }

  return response.json();
}

/**
 * Return only the requested fields from a record, stripping Strapi internals.
 */
function filterFields(record, fields) {
  if (!fields || fields.length === 0) {
    const {
      id, documentId, createdAt, updatedAt, publishedAt,
      createdBy, updatedBy, locale, localizations,
      ...data
    } = record;
    return data;
  }

  const data = {};
  for (const field of fields) {
    if (record[field] !== undefined) {
      data[field] = record[field];
    }
  }
  return data;
}

module.exports = { applyLocal, applyRemote, filterFields };
