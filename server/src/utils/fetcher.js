'use strict';

const { paginate, DEFAULT_PAGE_SIZE, normalizePageSize } = require('./pagination');

/**
 * Fetch ONE page of local records from the Strapi document service.
 * Returns { records, hasMore, total }.
 */
async function fetchLocalPage(strapi, uid, { fields, lastSyncAt, page = 1, pageSize = DEFAULT_PAGE_SIZE } = {}) {
  const size = normalizePageSize(pageSize);
  const params = {
    start: (page - 1) * size,
    limit: size,
    sort: 'updatedAt:asc',
  };

  if (lastSyncAt) {
    params.filters = { updatedAt: { $gt: lastSyncAt } };
  }

  if (fields && fields.length > 0) {
    params.fields = [...new Set([...fields, 'syncId', 'updatedAt'])];
  }

  const records = (await strapi.documents(uid).findMany(params)) || [];
  return { records, hasMore: records.length === size };
}

/**
 * Fetch ONE page of remote records via the standard Strapi REST API.
 * Returns { records, hasMore, total, pageCount }.
 */
async function fetchRemotePage(remoteConfig, uid, { fields, lastSyncAt, page = 1, pageSize = DEFAULT_PAGE_SIZE } = {}) {
  const size = normalizePageSize(pageSize);
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

  url.searchParams.set('pagination[page]', String(page));
  url.searchParams.set('pagination[pageSize]', String(size));
  url.searchParams.set('sort', 'updatedAt:asc');

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
  const records = json.data || [];
  const meta = json.meta?.pagination;
  const pageCount = meta?.pageCount;
  const total = meta?.total;
  const hasMore = pageCount ? page < pageCount : records.length === size;

  return { records, hasMore, total, pageCount };
}

/**
 * Async iterator over all local pages.
 */
function iterateLocalPages(strapi, uid, options = {}) {
  return paginate(
    (page, pageSize) => fetchLocalPage(strapi, uid, { ...options, page, pageSize }),
    { pageSize: options.pageSize }
  );
}

/**
 * Async iterator over all remote pages.
 */
function iterateRemotePages(remoteConfig, uid, options = {}) {
  return paginate(
    (page, pageSize) => fetchRemotePage(remoteConfig, uid, { ...options, page, pageSize }),
    { pageSize: options.pageSize }
  );
}

/**
 * Back-compat: fetch ALL local records (aggregates pages). Prefer the
 * iterator variant for large datasets.
 */
async function fetchLocalRecords(strapi, uid, options = {}) {
  const out = [];
  for await (const { records } of iterateLocalPages(strapi, uid, options)) {
    out.push(...records);
  }
  return out;
}

/**
 * Back-compat: fetch ALL remote records (aggregates pages). Prefer the
 * iterator variant for large datasets.
 */
async function fetchRemoteRecords(remoteConfig, uid, options = {}) {
  const out = [];
  for await (const { records } of iterateRemotePages(remoteConfig, uid, options)) {
    out.push(...records);
  }
  return out;
}

/**
 * Convert a content-type UID to its plural REST endpoint name.
 * e.g. "api::product.product" → "products"
 */
function uidToPluralEndpoint(uid) {
  const contentType = global.strapi?.contentTypes?.[uid];
  const configuredPlural = contentType?.info?.pluralName;
  if (configuredPlural) {
    return configuredPlural;
  }

  const parts = uid.split('.');
  const modelName = parts[parts.length - 1];
  if (modelName.endsWith('s')) return modelName;
  if (modelName.endsWith('y')) return modelName.slice(0, -1) + 'ies';
  if (modelName.endsWith('ch') || modelName.endsWith('sh') || modelName.endsWith('x') || modelName.endsWith('z')) {
    return modelName + 'es';
  }
  return modelName + 's';
}

module.exports = {
  fetchLocalRecords,
  fetchRemoteRecords,
  fetchLocalPage,
  fetchRemotePage,
  iterateLocalPages,
  iterateRemotePages,
  uidToPluralEndpoint,
};

