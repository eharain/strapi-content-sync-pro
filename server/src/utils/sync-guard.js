'use strict';

/**
 * In-memory guard to prevent infinite sync loops.
 *
 * Before applying a record received from a remote instance we call
 * markAsRemoteUpdate(key).  The afterCreate / afterUpdate lifecycle
 * hook then calls isRemoteUpdate(key) — if it returns true the hook
 * skips pushing the record back to the remote.
 */
const _active = new Set();

module.exports = {
  markAsRemoteUpdate(key) {
    _active.add(key);
  },

  isRemoteUpdate(key) {
    if (_active.has(key)) {
      _active.delete(key);
      return true;
    }
    return false;
  },

  clear() {
    _active.clear();
  },
};
