'use strict';

const { strapi: strapiPackageConfig = {} } = require('../../../package.json');
const { generateSignature } = require('./hmac');
const { markAsRemoteUpdate } = require('./sync-guard');

const PLUGIN_ID = strapiPackageConfig.name || 'strapi-content-sync-pro';

/**
 * Apply a record received from a remote instance to the local database.
 *
 * Strapi v5 identifies entities by `documentId` (stable across instances),
 * while some legacy plugin installs add a custom `syncId` attribute. Prefer
 * `documentId` and fall back to `syncId` for back-compat.
 */
async function applyLocal(strapi, uid, record, fields) {
  const data = filterFields(record, fields);
  const documentId = record.documentId || null;
  const syncId = record.syncId || null;
  const key = documentId || syncId;

  // Mark so the afterCreate/afterUpdate hook skips re-pushing
  if (key) markAsRemoteUpdate(`${uid}:${key}`);

  let existingDocumentId = null;

  if (documentId) {
    try {
      const found = await strapi.documents(uid).findOne({ documentId });
      if (found) existingDocumentId = found.documentId || documentId;
    } catch {
      // fall through and try syncId lookup
    }
  }

  if (!existingDocumentId && syncId) {
    try {
      const existing = await strapi.documents(uid).findMany({
        filters: { syncId },
        limit: 1,
      });
      if (existing && existing.length > 0) existingDocumentId = existing[0].documentId;
    } catch {
      // ignore — treat as create
    }
  }

  if (existingDocumentId) {
    return strapi.documents(uid).update({
      documentId: existingDocumentId,
      data,
    });
  }

  // Create: preserve documentId so the two instances share identity
  if (documentId) data.documentId = documentId;
  if (syncId) data.syncId = syncId;
  return strapi.documents(uid).create({ data });
}

/**
 * Push a local record to the remote instance via the plugin's /receive endpoint.
 */
async function applyRemote(remoteConfig, uid, record, fields) {
  const { baseUrl, apiToken, sharedSecret } = remoteConfig;
  const url = new URL(`/api/${PLUGIN_ID}/receive`, baseUrl);

  const body = {
    uid,
    data: filterFields(record, fields),
    documentId: record.documentId || null,
    syncId: record.syncId || null,
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
 *
 * `documentId` and `syncId` are preserved (when present) so the remote side
 * can upsert against the same cross-instance identity.
 */
function filterFields(record, fields) {
  if (!fields || fields.length === 0) {
    const {
      id, createdAt, updatedAt, publishedAt,
      createdBy, updatedBy, locale, localizations,
      ...data
    } = record;
    // Keep documentId/syncId on the payload; strip createdAt/updatedAt/etc.
    return data;
  }

  const data = {};
  for (const field of fields) {
    if (record[field] !== undefined) {
      data[field] = record[field];
    }
  }
  if (record.documentId !== undefined && data.documentId === undefined) {
    data.documentId = record.documentId;
  }
  if (record.syncId !== undefined && data.syncId === undefined) {
    data.syncId = record.syncId;
  }
  return data;
}

async function deleteLocal(strapi, uid, record) {
  const documentId = record?.documentId || null;
  const syncId = record?.syncId || null;
  const key = documentId || syncId;
  if (!key) return { skipped: true, reason: 'missing_documentId_and_syncId' };

  let existingDocumentId = null;

  if (documentId) {
    try {
      const found = await strapi.documents(uid).findOne({ documentId });
      if (found) existingDocumentId = found.documentId || documentId;
    } catch { /* ignore */ }
  }

  if (!existingDocumentId && syncId) {
    try {
      const existing = await strapi.documents(uid).findMany({
        filters: { syncId },
        limit: 1,
      });
      if (existing && existing.length > 0) existingDocumentId = existing[0].documentId;
    } catch { /* ignore */ }
  }

  if (!existingDocumentId) {
    return { skipped: true, reason: 'not_found' };
  }

  markAsRemoteUpdate(`${uid}:${key}`);
  await strapi.documents(uid).delete({ documentId: existingDocumentId });
  return { deleted: true };
}

async function deleteRemote(remoteConfig, uid, record) {
  const { baseUrl, apiToken, sharedSecret } = remoteConfig;
  const url = new URL(`/api/${PLUGIN_ID}/receive`, baseUrl);

  const body = {
    uid,
    documentId: record?.documentId || null,
    syncId: record?.syncId || null,
    delete: true,
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
    throw new Error(`Remote delete failed for ${uid}: ${response.status} – ${text}`);
  }

  return response.json();
}

module.exports = { applyLocal, applyRemote, deleteLocal, deleteRemote, filterFields };
