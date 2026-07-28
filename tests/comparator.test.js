'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { compareRecords, relationsEqual } = require('../server/src/utils/comparator');
const { PHASE_ENTITIES, PHASE_RELATIONS } = require('../server/src/utils/strategy');

const T1 = '2026-01-01T00:00:00.000Z';
const T2 = '2026-01-02T00:00:00.000Z';

const rec = (documentId, updatedAt = T1, extra = {}) => ({ documentId, updatedAt, ...extra });

// ── Entities pass ──────────────────────────────────────────────────────────

test('entities pass: newer side wins under "latest"', () => {
  const diff = compareRecords([rec('a', T2)], [rec('a', T1)], {
    direction: 'both', conflictStrategy: 'latest', phase: PHASE_ENTITIES,
  });
  assert.equal(diff.toPush.length, 1);
  assert.equal(diff.toPull.length, 0);
});

test('entities pass: identical timestamps are a no-op', () => {
  const diff = compareRecords([rec('a', T1)], [rec('a', T1)], {
    direction: 'both', conflictStrategy: 'latest', phase: PHASE_ENTITIES,
  });
  assert.equal(diff.toPush.length + diff.toPull.length, 0);
});

test('entities pass: direction gates the write', () => {
  const pullOnly = compareRecords([rec('a', T2)], [rec('a', T1)], {
    direction: 'pull', conflictStrategy: 'latest', phase: PHASE_ENTITIES,
  });
  assert.equal(pullOnly.toPush.length, 0, 'a pull-only profile must never push');
});

// ── Regression guard for the bug fixed in a810890 ──────────────────────────
// compareRecords used to reinterpret a one-sided record as a DELETE whenever
// syncDeletions was on and the direction was one-way, so such a profile never
// created anything. Deletion is reconcileDeletions' job; a one-sided record is
// always a create candidate here.

test('a record on one side only is a CREATE, never a delete — in every direction', () => {
  for (const direction of ['push', 'pull', 'both']) {
    const diff = compareRecords([rec('local-only')], [rec('remote-only')], {
      direction,
      conflictStrategy: 'latest',
      // Passed by legacy callers; must have no effect on the outcome.
      syncDeletions: true,
    });
    assert.equal(diff.toDeleteRemote.length, 0, `${direction}: nothing may be marked for remote deletion`);
    assert.equal(diff.toDeleteLocal.length, 0, `${direction}: nothing may be marked for local deletion`);

    if (direction === 'push' || direction === 'both') {
      assert.equal(diff.toCreateRemote.length, 1, `${direction}: the local-only record must be created remotely`);
    }
    if (direction === 'pull' || direction === 'both') {
      assert.equal(diff.toCreateLocal.length, 1, `${direction}: the remote-only record must be created locally`);
    }
  }
});

// ── Relations pass ─────────────────────────────────────────────────────────

test('relations pass: identical link sets produce no write', () => {
  const local = rec('a', T1, { author: { documentId: 'x' }, tags: [{ documentId: 't1' }, { documentId: 't2' }] });
  const remote = rec('a', T2, { author: { documentId: 'x' }, tags: [{ documentId: 't2' }, { documentId: 't1' }] });
  const diff = compareRecords([local], [remote], {
    direction: 'both', conflictStrategy: 'latest', phase: PHASE_RELATIONS,
  });
  assert.equal(diff.toPush.length + diff.toPull.length, 0, 'same links (order-insensitive) = nothing to do');
});

test('relations pass: differing links are written even when updatedAt matches', () => {
  // The entities pass leaves both sides with the same updatedAt very often.
  // Treating that as "equal" is how relations silently never land.
  const local = rec('a', T1, { author: { documentId: 'x' } });
  const remote = rec('a', T1, { author: null });
  const diff = compareRecords([local], [remote], {
    direction: 'both', conflictStrategy: 'latest', phase: PHASE_RELATIONS,
  });
  assert.equal(diff.toPush.length, 1, 'the link must be materialized despite the timestamp tie');
});

test('relations pass: a timestamp tie respects an explicit conflict strategy', () => {
  const local = rec('a', T1, { author: { documentId: 'x' } });
  const remote = rec('a', T1, { author: { documentId: 'y' } });

  const remoteWins = compareRecords([local], [remote], {
    direction: 'both', conflictStrategy: 'remote_wins', phase: PHASE_RELATIONS,
  });
  assert.equal(remoteWins.toPull.length, 1);
  assert.equal(remoteWins.toPush.length, 0);

  const pullProfile = compareRecords([local], [remote], {
    direction: 'pull', conflictStrategy: 'latest', phase: PHASE_RELATIONS,
  });
  assert.equal(pullProfile.toPull.length, 1, 'a pull profile resolves the tie remote-side');
});

test('relations pass: a record with no counterpart is counted, not created as a stub', () => {
  const diff = compareRecords(
    [rec('local-only', T1, { author: { documentId: 'x' } })],
    [rec('remote-only', T1, { author: { documentId: 'y' } })],
    { direction: 'both', conflictStrategy: 'latest', phase: PHASE_RELATIONS }
  );
  assert.equal(diff.toCreateRemote.length, 0, 'the relations pass must not create records');
  assert.equal(diff.toCreateLocal.length, 0, 'the relations pass must not create records');
  assert.equal(diff.unmatched, 2, 'both unmatched records are reported');
});

// ── relationsEqual ─────────────────────────────────────────────────────────

test('relationsEqual ignores metadata and compares only link identity', () => {
  assert.equal(
    relationsEqual(
      { documentId: 'a', updatedAt: T1, createdAt: T1, author: { documentId: 'x', name: 'local name' } },
      { documentId: 'a', updatedAt: T2, createdAt: T2, author: { documentId: 'x', name: 'remote name' } }
    ),
    true,
    'differing scalar payload on the populated target is not a link difference'
  );

  assert.equal(
    relationsEqual({ tags: [{ documentId: 't1' }] }, { tags: [{ documentId: 't1' }, { documentId: 't2' }] }),
    false
  );
  assert.equal(relationsEqual({ author: null }, { author: { documentId: 'x' } }), false);
  assert.equal(relationsEqual({ author: null }, {}), true, 'absent and empty are the same link state');
});

test('relationsEqual ignores numeric ids, which are not stable across instances', () => {
  assert.equal(
    relationsEqual({ author: { id: 7 } }, { author: { id: 42 } }),
    true,
    'without a documentId there is no comparable identity — ids must not drive a write'
  );
});
