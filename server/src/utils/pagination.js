'use strict';

/**
 * Generic pagination helpers used by both the local Document Service path
 * and the remote REST API path. Keeping these centralized means the sync
 * engine can process arbitrarily large content types in bounded memory.
 */

const DEFAULT_PAGE_SIZE = 100;
const MIN_PAGE_SIZE = 1;
const MAX_PAGE_SIZE = 5000;

function normalizePageSize(size) {
  const n = Number(size);
  if (!Number.isFinite(n)) return DEFAULT_PAGE_SIZE;
  return Math.max(MIN_PAGE_SIZE, Math.min(MAX_PAGE_SIZE, Math.floor(n)));
}

/**
 * Walk a paginated source page-by-page.
 *
 *   fetchPage(page, pageSize) -> { records, hasMore, total? }
 *
 * The helper yields each page's records so callers can process/apply them
 * without ever holding the full result set in memory.
 */
async function* paginate(fetchPage, { pageSize = DEFAULT_PAGE_SIZE, maxPages } = {}) {
  const size = normalizePageSize(pageSize);
  let page = 1;
  while (true) {
    const result = await fetchPage(page, size);
    const records = Array.isArray(result) ? result : (result?.records || []);
    const hasMore = Array.isArray(result)
      ? records.length === size
      : !!result?.hasMore;

    yield { page, pageSize: size, records, total: result?.total };

    if (!hasMore || records.length === 0) break;
    if (maxPages && page >= maxPages) break;
    page += 1;
  }
}

module.exports = {
  DEFAULT_PAGE_SIZE,
  MIN_PAGE_SIZE,
  MAX_PAGE_SIZE,
  normalizePageSize,
  paginate,
};
