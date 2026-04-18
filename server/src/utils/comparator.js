'use strict';

/**
 * Compare local and remote record sets and return the required sync actions.
 *
 * @param {Array}  localRecords
 * @param {Array}  remoteRecords
 * @param {Object} options
 * @param {string} options.direction        – "push" | "pull" | "both"
 * @param {string} options.conflictStrategy – "latest" | "local_wins" | "remote_wins"
 * @returns {{ toPush, toPull, toCreateRemote, toCreateLocal }}
 */
function compareRecords(localRecords, remoteRecords, options = {}) {
  const { direction = 'both', conflictStrategy = 'latest' } = options;

  const result = {
    toPush: [],
    toPull: [],
    toCreateRemote: [],
    toCreateLocal: [],
  };

  const localBySyncId = new Map();
  const remoteBySyncId = new Map();

  for (const r of localRecords) {
    if (r.syncId) localBySyncId.set(r.syncId, r);
  }
  for (const r of remoteRecords) {
    if (r.syncId) remoteBySyncId.set(r.syncId, r);
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
