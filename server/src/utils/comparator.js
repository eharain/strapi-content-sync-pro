'use strict';

const { PHASE_RELATIONS } = require('./strategy');

// Identity / bookkeeping keys that are never a relation payload.
const META_KEYS = new Set([
  'id', 'documentId', 'syncId', 'createdAt', 'updatedAt', 'publishedAt',
  'createdBy', 'updatedBy', 'locale', 'localizations',
]);

/**
 * Reduce a populated relation value to a stable, comparable identity list.
 * Relations arrive populated (`populate: '*'`), so a field is either a nested
 * object, an array of nested objects, or null. Only `documentId` is stable
 * across instances — numeric ids are not.
 */
function relationIdentity(value) {
  if (value == null) return [];
  const one = (v) => (v && typeof v === 'object' ? v.documentId || null : null);
  if (Array.isArray(value)) {
    return value.map(one).filter(Boolean).sort();
  }
  const single = one(value);
  return single ? [single] : [];
}

/**
 * True when both records carry the same owner-side relation links, so the
 * relations pass has nothing to write. Compared over the union of both records'
 * non-meta keys, which is exactly the owner-relation field set the relations
 * pass fetches.
 */
function relationsEqual(localRecord, remoteRecord) {
  const keys = new Set([
    ...Object.keys(localRecord || {}),
    ...Object.keys(remoteRecord || {}),
  ]);

  for (const key of keys) {
    if (META_KEYS.has(key)) continue;
    const a = relationIdentity(localRecord?.[key]);
    const b = relationIdentity(remoteRecord?.[key]);
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 1) {
      if (a[i] !== b[i]) return false;
    }
  }

  return true;
}

/**
 * Compare local and remote record sets and return the required sync actions.
 *
 * @param {Array}  localRecords
 * @param {Array}  remoteRecords
 * @param {Object} options
 * @param {string} options.direction        – "push" | "pull" | "both"
 * @param {string} options.conflictStrategy – "latest" | "local_wins" | "remote_wins"
 * @param {string} options.phase            – strategy phase; "relations" switches
 *                                            to link-materialization semantics
 * @returns {{ toPush, toPull, toCreateRemote, toCreateLocal, toDeleteRemote, toDeleteLocal, unmatched }}
 *
 * Note: a record present on one side only is ALWAYS a create candidate here —
 * deletion is exclusively reconcileDeletions' job (snapshot-based, so it can
 * tell a genuine delete apart from "not created yet"). compareRecords used to
 * accept a `syncDeletions` option that reinterpreted a one-sided record as a
 * delete instead of a create on `push`/`pull` (never `both`) — which meant a
 * one-way profile with that flag on never created anything, ever. Removed in
 * a810890. The toDelete* keys stay in the returned shape so existing callers
 * that iterate them keep working; they are always empty.
 */
function compareRecords(localRecords, remoteRecords, options = {}) {
  const {
    direction = 'both',
    conflictStrategy = 'latest',
    phase = null,
  } = options;

  const isRelationsPhase = phase === PHASE_RELATIONS;

  const result = {
    toPush: [],
    toPull: [],
    toCreateRemote: [],
    toCreateLocal: [],
    toDeleteRemote: [],
    toDeleteLocal: [],
    // Relations pass only: records whose counterpart is absent on the other
    // side, so there is nothing to link them to yet.
    unmatched: 0,
  };

  const localBySyncId = new Map();
  const remoteBySyncId = new Map();

  const keyOf = (r) => r && (r.documentId || r.syncId);

  for (const r of localRecords) {
    const k = keyOf(r);
    if (k) localBySyncId.set(k, r);
  }
  for (const r of remoteRecords) {
    const k = keyOf(r);
    if (k) remoteBySyncId.set(k, r);
  }

  // Records that exist on both sides
  for (const [syncId, localRecord] of localBySyncId) {
    const remoteRecord = remoteBySyncId.get(syncId);

    if (remoteRecord) {
      // Relations pass: identical link sets are a no-op. Otherwise the links
      // must be materialized even when the timestamps match — an unchanged
      // `updatedAt` says nothing about whether the link was ever applied, and
      // treating that as "equal" is how relations silently never land.
      if (isRelationsPhase && relationsEqual(localRecord, remoteRecord)) {
        continue;
      }

      let winner = resolveConflict(localRecord, remoteRecord, conflictStrategy);
      if (winner === 'equal' && isRelationsPhase) {
        winner = tieBreakForRelations(direction, conflictStrategy);
      }

      if (winner === 'local' && (direction === 'push' || direction === 'both')) {
        result.toPush.push({ local: localRecord, remote: remoteRecord });
      } else if (winner === 'remote' && (direction === 'pull' || direction === 'both')) {
        result.toPull.push({ local: localRecord, remote: remoteRecord });
      }
    } else if (isRelationsPhase) {
      // The counterpart record does not exist on the other side yet, so there
      // is nothing to link. Creating it here would write a stub carrying only
      // relation fields — the entities pass owns record creation.
      result.unmatched += 1;
    } else if (direction === 'push' || direction === 'both') {
      result.toCreateRemote.push(localRecord);
    }
  }

  // Records that only exist on the remote
  for (const [syncId, remoteRecord] of remoteBySyncId) {
    if (localBySyncId.has(syncId)) continue;
    if (isRelationsPhase) {
      result.unmatched += 1;
      continue;
    }
    if (direction === 'pull' || direction === 'both') {
      result.toCreateLocal.push(remoteRecord);
    }
  }

  return result;
}

/**
 * Pick the writing side for a relations-pass tie (identical `updatedAt` but
 * differing link sets). An explicit conflict strategy still wins; otherwise the
 * profile direction decides, defaulting to the local side for bidirectional
 * profiles so the choice is deterministic rather than order-dependent.
 */
function tieBreakForRelations(direction, conflictStrategy) {
  if (conflictStrategy === 'local_wins') return 'local';
  if (conflictStrategy === 'remote_wins') return 'remote';
  return direction === 'pull' ? 'remote' : 'local';
}

/**
 * Determine the winner of a conflict.
 * @returns {'local' | 'remote' | 'equal'}
 */
function resolveConflict(localRecord, remoteRecord, strategy) {
  const localTime = new Date(localRecord.updatedAt).getTime();
  const remoteTime = new Date(remoteRecord.updatedAt).getTime();

  if (localTime === remoteTime) return 'equal';

  switch (strategy) {
    case 'local_wins':
      return 'local';
    case 'remote_wins':
      return 'remote';
    case 'latest':
    default:
      return localTime > remoteTime ? 'local' : 'remote';
  }
}

module.exports = { compareRecords, resolveConflict, relationsEqual };
