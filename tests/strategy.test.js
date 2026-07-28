'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  DEFAULT_EXECUTION_STRATEGY,
  DEPENDENCY_DEPTH,
  PHASE_ALL,
  PHASE_ENTITIES,
  PHASE_RELATIONS,
  MEDIA_PHASE_CORE,
  MEDIA_PHASE_LINKS,
  contentPhasesFor,
  mediaPhasesFor,
  normalizeDependencyDepth,
  isOwnerSideRelation,
  resolveExecutionStrategy,
  describeContract,
} = require('../server/src/utils/strategy');

test('hybrid two-pass is the default execution strategy', () => {
  assert.equal(DEFAULT_EXECUTION_STRATEGY, 'hybrid_two_pass');
  assert.deepEqual(contentPhasesFor(undefined), [PHASE_ENTITIES, PHASE_RELATIONS]);
  assert.deepEqual(contentPhasesFor('hybrid_two_pass'), [PHASE_ENTITIES, PHASE_RELATIONS]);
});

test('one-pass collapses to a single phase', () => {
  assert.deepEqual(contentPhasesFor('one_pass'), [PHASE_ALL]);
});

test('an unknown/legacy strategy value falls back to the default, never throws', () => {
  assert.equal(resolveExecutionStrategy('nonsense'), 'hybrid_two_pass');
  assert.equal(resolveExecutionStrategy(null), 'hybrid_two_pass');
  assert.deepEqual(contentPhasesFor('nonsense'), [PHASE_ENTITIES, PHASE_RELATIONS]);
});

test('media phases mirror the content passes', () => {
  assert.deepEqual(mediaPhasesFor(PHASE_ENTITIES), [MEDIA_PHASE_CORE]);
  assert.deepEqual(mediaPhasesFor(PHASE_RELATIONS), [MEDIA_PHASE_LINKS]);
  // A one-pass run still has to do both, back to back.
  assert.deepEqual(mediaPhasesFor(PHASE_ALL), [MEDIA_PHASE_CORE, MEDIA_PHASE_LINKS]);
});

test('dependency depth is fixed at 1 whatever the caller asks for', () => {
  assert.equal(DEPENDENCY_DEPTH, 1);
  assert.equal(normalizeDependencyDepth(), 1);
  assert.equal(normalizeDependencyDepth(5), 1);
  assert.equal(normalizeDependencyDepth('3'), 1);
});

// ── Regression guard for the bug fixed in a810890 ──────────────────────────
// Per @strapi/database's relation metadata (isOwner = !isBidirectional ||
// hasInversedBy), `inversedBy` marks the OWNER side. A predicate that excludes
// it means no bidirectional relation is ever synced, in either direction.
test('owner side = every relation except the mappedBy (inverse) side', () => {
  assert.equal(isOwnerSideRelation({ type: 'relation', target: 'api::a.a' }), true, 'one-way relation is owner side');
  assert.equal(
    isOwnerSideRelation({ type: 'relation', target: 'api::a.a', inversedBy: 'pages' }),
    true,
    'inversedBy IS the owner side of a bidirectional relation'
  );
  assert.equal(
    isOwnerSideRelation({ type: 'relation', target: 'api::a.a', mappedBy: 'author' }),
    false,
    'mappedBy is the inverse side and must never be written from here'
  );
});

test('non-relation and target-less attributes are never owner-side', () => {
  assert.equal(isOwnerSideRelation({ type: 'string' }), false);
  assert.equal(isOwnerSideRelation({ type: 'media', multiple: true }), false);
  assert.equal(isOwnerSideRelation({ type: 'relation' }), false, 'a relation with no target is not actionable');
  assert.equal(isOwnerSideRelation(null), false);
  assert.equal(isOwnerSideRelation(undefined), false);
});

test('the published contract states the constraints the code enforces', () => {
  const contract = describeContract();
  assert.equal(contract.defaultExecutionStrategy, 'hybrid_two_pass');
  assert.equal(contract.dependencies.depth, 1);
  assert.equal(contract.dependencies.depthFixed, true);
  assert.equal(contract.dependencies.ownerSideOnly, true);
  assert.equal(contract.dependencies.traversesInverseSide, false);
  // Media is a referenced target, never the relation driver.
  assert.equal(contract.media.ownerSideLinksOnly, true);
  assert.equal(contract.media.morphTraversal, false);
});
