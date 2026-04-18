'use strict';

/**
 * Fetch local records from the Strapi document service.
 */
async function fetchLocalRecords(strapi, uid, { fields, lastSyncAt } = {}) {
  const params = {};

  if (lastSyncAt) {
    params.filters = { updatedAt: { $gt: lastSyncAt } };
  }

  if (fields && fields.length > 0) {
    params.fields = [...new Set([...fields, 'syncId', 'updatedAt'])];
  }

  const records = await strapi.documents(uid).findMany(params);
  return records || [];
}

/**
 * Fetch remote records via the standard Strapi REST API.
 */
async function fetchRemoteRecords(remoteConfig, uid, { fields, lastSyncAt } = {}) {
  const { baseUrl, apiToken } = remoteConfig;
  const pluralName = uidToPluralEndpoint(uid);
  const url = new URL(`/api/${pluralName}`, baseUrl);

  if (fields && fields.length > 0) {
    const allFields = [...new Set([...fields, 'syncId', 'updatedAt'])];
    allFields.forEach((f, i) => {
      url.searchParams.set(`fields[${i}]`, f);
    });
  }

  if (lastSyncAt) {
    url.searchParams.set('filters[updatedAt][$gt]', lastSyncAt);
  }

  url.searchParams.set('pagination[pageSize]', '10000');

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${apiToken}`,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Remote fetch failed for ${uid}: ${response.status} – ${text}`);
  }

  const json = await response.json();
  return json.data || [];
}

/**
 * Convert a content-type UID to its plural REST endpoint name.
 * e.g. "api::product.product" → "products"
 */
function uidToPluralEndpoint(uid) {
  const parts = uid.split('.');
  const modelName = parts[parts.length - 1];
  if (modelName.endsWith('s')) return modelName;
  if (modelName.endsWith('y')) return modelName.slice(0, -1) + 'ies';
  return modelName + 's';
}

module.exports = { fetchLocalRecords, fetchRemoteRecords, uidToPluralEndpoint };
