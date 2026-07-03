'use strict';

const { strapi: strapiPackageConfig = {} } = require('../../../package.json');
const { generateSignature } = require('./hmac');
const { markAsRemoteUpdate } = require('./sync-guard');

const PLUGIN_ID = strapiPackageConfig.name || 'strapi-content-sync-pro';

/**
 * Whether a content type has Draft & Publish enabled.
 */
function hasDraftAndPublish(strapi, uid) {
  return !!(strapi.contentTypes?.[uid]?.options?.draftAndPublish);
}

/**
 * Convert populated relation values into documentId references the document
 * service can ingest.
 *
 * The relations phase fetches records with `populate: '*'`, so a relation field
 * arrives as a full nested object (to-one) or an array of nested objects
 * (to-many). Passing those back to create/update fails ("related document not
 * found" / validation errors). Here we reduce each relation to its documentId(s)
 * and express it as a `set` connection keyed on documentId, which is stable
 * across instances. Targets are expected to already exist locally (dependency
 * ordering / entities phase run first).
 */
function normalizeRelations(strapi, uid, data) {
  const attrs = strapi.contentTypes?.[uid]?.attributes || {};
  const out = { ...data };

  const toRef = (v) => {
    if (v == null) return null;
    if (typeof v === 'object') return v.documentId || null;
    return null; // ignore bare numeric ids — they differ across instances
  };

  for (const [field, val] of Object.entries(data)) {
    const attr = attrs[field];
    if (!attr || attr.type !== 'relation') continue;

    if (val == null) {
      out[field] = { set: [] };
    } else if (Array.isArray(val)) {
      out[field] = { set: val.map(toRef).filter(Boolean).map((documentId) => ({ documentId })) };
    } else if (typeof val === 'object') {
      const ref = toRef(val);
      out[field] = ref ? { set: [{ documentId: ref }] } : { set: [] };
    }
  }

  return out;
}

/**
 * Apply a record received from a remote instance to the local database.
 *
 * Strapi v5 identifies entities by `documentId` (stable across instances),
 * while some legacy plugin installs add a custom `syncId` attribute. Prefer
 * `documentId` and fall back to `syncId` for back-compat.
 *
 * Publish state: for Draft & Publish content types the target is published or
 * unpublished to mirror the source. The desired state comes from `opts.published`
 * when provided (the /receive path, where `publishedAt` is stripped from the
 * payload) and otherwise from the source record's own `publishedAt` (the direct
 * pull path, where the fetched record still carries it). Without this, every
 * synced D&P record would land as a draft and never appear on the public API.
 */
async function applyLocal(strapi, uid, record, fields, opts = {}) {
  const data = normalizeRelations(strapi, uid, filterFields(record, fields));
  const documentId = record.documentId || null;
  const syncId = record.syncId || null;
  const key = documentId || syncId;

  const dp = hasDraftAndPublish(strapi, uid);
  const shouldPublish = opts.published !== undefined
    ? !!opts.published
    : (record.publishedAt != null);

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

  // Mirror publish state inline via the `status` param. Delegating publish to
  // the document service's own create/update flow (rather than a separate
  // publish() call) keeps locale handling correct and avoids a fragile second
  // lookup. `status` is ignored for non-D&P types.
  const status = dp ? (shouldPublish ? 'published' : 'draft') : undefined;

  let saved;
  if (existingDocumentId) {
    saved = await strapi.documents(uid).update({
      documentId: existingDocumentId,
      data,
      ...(status ? { status } : {}),
    });
  } else {
    // Create: preserve documentId so the two instances share identity
    if (documentId) data.documentId = documentId;
    if (syncId) data.syncId = syncId;
    saved = await strapi.documents(uid).create({
      data,
      ...(status ? { status } : {}),
    });
  }

  // If the source is a draft but the target still has a published version,
  // unpublish it so the two sides mirror. (Rare with the published-only fetch,
  // but keeps two-way state consistent; failure is non-fatal.)
  if (dp && !shouldPublish) {
    const targetDocId = saved?.documentId || existingDocumentId || documentId;
    if (targetDocId) {
      if (key) markAsRemoteUpdate(`${uid}:${key}`);
      try {
        await strapi.documents(uid).unpublish({ documentId: targetDocId });
      } catch {
        // no published version to remove — ignore
      }
    }
  }

  return saved;
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
    // Publish intent for the receiver (publishedAt is stripped from `data`).
    published: record.publishedAt != null,
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
