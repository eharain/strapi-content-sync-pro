'use strict';

const { paginate, DEFAULT_PAGE_SIZE, normalizePageSize } = require('./pagination');

// Core managed fields that Strapi always accepts in a `fields` selection.
const CORE_FIELDS = ['documentId', 'createdAt', 'updatedAt', 'publishedAt'];
const SCALAR_TYPES = new Set([
  'string', 'text', 'richtext', 'blocks', 'integer', 'biginteger',
  'float', 'decimal', 'boolean', 'date', 'datetime', 'time',
  'email', 'password', 'enumeration', 'uid', 'json',
]);
// Runtime-injected managed fields that are NOT valid in a REST `fields[]` query
// (locale/localizations are separate params; audit fields are populate-only).
const RESERVED_FIELDS = new Set(['locale', 'localizations', 'createdBy', 'updatedBy', 'id']);

/**
 * Translate a requested field list into a query-safe `fields` selection.
 *
 * Strapi rejects a whole request with 400 "Invalid key <x>" if `fields`
 * contains a name that is not a real attribute (e.g. `syncId`, which no user
 * schema actually defines). Relations/components/media must NOT go in `fields`
 * either — they are returned via `populate: '*'`. So we keep only real scalar
 * attributes plus the core managed fields, and include `syncId` only when the
 * content type genuinely declares it.
 */
function scalarQueryFields(uid, fields) {
  const attrs = global.strapi?.contentTypes?.[uid]?.attributes || {};
  const out = new Set();
  for (const f of fields || []) {
    if (RESERVED_FIELDS.has(f)) continue;
    if (CORE_FIELDS.includes(f)) { out.add(f); continue; }
    const a = attrs[f];
    if (a && SCALAR_TYPES.has(a.type)) out.add(f);
    // else: relation/component/media/dynamiczone or unknown key → skip
  }
  // Always carry identity, ordering, and publish state.
  out.add('documentId');
  out.add('updatedAt');
  out.add('publishedAt');
  if (attrs.syncId) out.add('syncId');
  return [...out];
}

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
    // Include relations/components so dependency links can be compared/synced.
    populate: '*',
  };

  // For Draft & Publish types the document service defaults to the DRAFT
  // version (publishedAt = null), whereas the remote REST API returns the
  // PUBLISHED version. Request published here so both sides carry an accurate
  // `publishedAt` and the sync mirrors live content rather than drafts.
  const dp = !!(strapi.contentTypes?.[uid]?.options?.draftAndPublish);
  if (dp) {
    params.status = 'published';
  }

  if (lastSyncAt) {
    params.filters = { updatedAt: { $gt: lastSyncAt } };
  }

  if (fields && fields.length > 0) {
    params.fields = scalarQueryFields(uid, fields);
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
    const allFields = scalarQueryFields(uid, fields);
    allFields.forEach((f, i) => {
      url.searchParams.set(`fields[${i}]`, f);
    });
  }

  // Include relations/components so dependency links can be compared/synced.
  // Keep field filters above for scalar fields; Strapi still returns populated
  // relation/component payloads when `populate=*` is set.
  url.searchParams.set('populate', '*');

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

/**
 * Fetch the full set of local documentIds for a content type (existence set).
 *
 * Uses the draft status so EVERY document is counted regardless of publish
 * state — unpublishing must never be mistaken for deletion. Returns a Set.
 */
async function fetchAllLocalIds(strapi, uid, { pageSize = DEFAULT_PAGE_SIZE } = {}) {
  const size = normalizePageSize(pageSize);
  const dp = !!(strapi.contentTypes?.[uid]?.options?.draftAndPublish);
  const ids = new Set();
  for (let page = 1; ; page++) {
    const params = {
      start: (page - 1) * size,
      limit: size,
      fields: ['documentId'],
      sort: 'documentId:asc',
    };
    if (dp) params.status = 'draft'; // draft version exists for every document
    const recs = (await strapi.documents(uid).findMany(params)) || [];
    for (const r of recs) if (r?.documentId) ids.add(r.documentId);
    if (recs.length < size) break;
  }
  return ids;
}

/**
 * Fetch the full set of remote documentIds via REST (existence set).
 * Uses `status=draft` so every document is counted regardless of publish state.
 */
async function fetchAllRemoteIds(remoteConfig, uid, { pageSize = DEFAULT_PAGE_SIZE } = {}) {
  const size = normalizePageSize(pageSize);
  const { baseUrl, apiToken } = remoteConfig;
  const pluralName = uidToPluralEndpoint(uid);
  const ids = new Set();
  const dp = !!(global.strapi?.contentTypes?.[uid]?.options?.draftAndPublish);

  for (let page = 1; ; page++) {
    const url = new URL(`/api/${pluralName}`, baseUrl);
    url.searchParams.set('fields[0]', 'documentId');
    url.searchParams.set('pagination[page]', String(page));
    url.searchParams.set('pagination[pageSize]', String(size));
    url.searchParams.set('sort', 'documentId:asc');
    if (dp) url.searchParams.set('status', 'draft');

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiToken}`, 'Content-Type': 'application/json' },
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Remote id fetch failed for ${uid}: ${response.status} – ${text}`);
    }
    const json = await response.json();
    const recs = json.data || [];
    for (const r of recs) if (r?.documentId) ids.add(r.documentId);
    const pageCount = json.meta?.pagination?.pageCount;
    if (pageCount ? page >= pageCount : recs.length < size) break;
  }
  return ids;
}

module.exports = {
  fetchLocalRecords,
  fetchRemoteRecords,
  fetchLocalPage,
  fetchRemotePage,
  iterateLocalPages,
  iterateRemotePages,
  fetchAllLocalIds,
  fetchAllRemoteIds,
  uidToPluralEndpoint,
};

