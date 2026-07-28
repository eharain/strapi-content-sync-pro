'use strict';

/**
 * Compare local and remote record sets and return the required sync actions.
 *
 * @param {Array}  localRecords
 * @param {Array}  remoteRecords
 * @param {Object} options
 * @param {string} options.direction        – "push" | "pull" | "both"
 * @param {string} options.conflictStrategy – "latest" | "local_wins" | "remote_wins"
 * @returns {{ toPush, toPull, toCreateRemote, toCreateLocal, toDeleteRemote, toDeleteLocal }}
 *
 * Note: a record present on one side only is ALWAYS a create candidate here —
 * deletion is exclusively reconcileDeletions' job (snapshot-based, so it can
 * tell a genuine delete apart from "not created yet"). compareRecords used to
 * accept a `syncDeletions` option that reinterpreted a one-sided record as a
 * delete instead of a create on `push`/`pull` (never `both`) — which meant a
 * one-way profile with that flag on never created anything, ever. Removed.
 */
function compareRecords(localRecords, remoteRecords, options = {}) {
  const { direction = 'both', conflictStrategy = 'latest' } = options;

  const result = {
    toPush: [],
    toPull: [],
    toCreateRemote: [],
    toCreateLocal: [],
    toDeleteRemote: [],
    toDeleteLocal: [],
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
      const winner = resolveConflict(localRecord, remoteRecord, conflictStrategy);

      if (winner === 'local' && (direction === 'push' || direction === 'both')) {
        result.toPush.push({ local: localRecord, remote: remoteRecord });
      } else if (winner === 'remote' && (direction === 'pull' || direction === 'both')) {
        result.toPull.push({ local: localRecord, remote: remoteRecord });
      }
    } else if (direction === 'push' || direction === 'both') {
      result.toCreateRemote.push(localRecord);
    }
  }

  // Records that only exist on the remote
  for (const [syncId] of remoteBySyncId) {
    if (!localBySyncId.has(syncId)) {
      if (direction === 'pull' || direction === 'both') {
        result.toCreateLocal.push(remoteBySyncId.get(syncId));
      }
    }
  }

  return result;
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

module.exports = { compareRecords, resolveConflict };
