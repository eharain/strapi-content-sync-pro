'use strict';

/**
 * Sync Strategy Contract
 * -----------------------------------------------------------------------------
 * Single source of truth for HOW a sync run is executed. Everything that runs a
 * sync — sync-now, profile execution, bulk transfer, media sync — reads its
 * phase plan and dependency constraints from here so the rules can't drift
 * between entry points.
 *
 * The contract (see docs/sync-strategy-approach-review.md):
 *
 *   1. Hybrid two-pass is the DEFAULT execution strategy.
 *        Pass 1 — entities: materialize records on both sides (scalars only)
 *                 plus core media (file bytes + upload rows).
 *        Pass 2 — relations: link records that now exist on both sides, written
 *                 from the owner/declaring side only, plus media links applied
 *                 from the owning entities.
 *
 *   2. Dependency expansion is constrained, always:
 *        - depth is fixed at 1 (no recursive traversal)
 *        - only direct relation targets that are themselves in sync scope
 *        - never traverse `mappedBy` / `inversedBy` (inverse-side fan-out)
 *        - never follow self-references
 *
 *   3. Media is a referenced target, never the relation driver. File↔entity
 *      links are written from the owning content type; there is no separate
 *      morph-side traversal in the strategy.
 */

// ── Execution strategies ────────────────────────────────────────────────────
const EXECUTION_STRATEGY_HYBRID = 'hybrid_two_pass';
const EXECUTION_STRATEGY_ONE_PASS = 'one_pass';

const VALID_EXECUTION_STRATEGIES = [EXECUTION_STRATEGY_HYBRID, EXECUTION_STRATEGY_ONE_PASS];
const DEFAULT_EXECUTION_STRATEGY = EXECUTION_STRATEGY_HYBRID;

// ── Content phases ──────────────────────────────────────────────────────────
const PHASE_ALL = 'all';             // one-pass: everything in a single write
const PHASE_ENTITIES = 'entities';   // pass 1: scalar payload only
const PHASE_RELATIONS = 'relations'; // pass 2: owner-side relation links only

// ── Media phases (mirror of the content phases) ─────────────────────────────
const MEDIA_PHASE_CORE = 'media_core';   // pass 1: file bytes + upload rows
const MEDIA_PHASE_LINKS = 'media_links'; // pass 2: entity→file links, owner side

// ── Dependency constraints ──────────────────────────────────────────────────
// Fixed by the strategy, not user-tunable. Exposed as a constant (rather than
// inlined `1`s) so the UI and the validators quote the same number.
const DEPENDENCY_DEPTH = 1;

/**
 * Coerce any stored/legacy value onto a valid execution strategy.
 */
function resolveExecutionStrategy(value) {
  return VALID_EXECUTION_STRATEGIES.includes(value) ? value : DEFAULT_EXECUTION_STRATEGY;
}

/**
 * The ordered content phases for an execution strategy.
 * hybrid_two_pass → ['entities', 'relations']; one_pass → ['all'].
 */
function contentPhasesFor(strategy) {
  return resolveExecutionStrategy(strategy) === EXECUTION_STRATEGY_ONE_PASS
    ? [PHASE_ALL]
    : [PHASE_ENTITIES, PHASE_RELATIONS];
}

/**
 * The media phase that belongs to a given content phase, so a run can
 * interleave media in the same two-pass shape:
 *   entities → core media, relations → media links.
 * One-pass runs both media phases back to back in the single pass.
 */
function mediaPhasesFor(contentPhase) {
  switch (contentPhase) {
    case PHASE_ENTITIES:
      return [MEDIA_PHASE_CORE];
    case PHASE_RELATIONS:
      return [MEDIA_PHASE_LINKS];
    case PHASE_ALL:
      return [MEDIA_PHASE_CORE, MEDIA_PHASE_LINKS];
    default:
      return [];
  }
}

/**
 * Dependency depth is always 1. Accepts (and ignores) a requested depth so
 * callers can pass a stored/legacy setting through without branching.
 */
function normalizeDependencyDepth() {
  return DEPENDENCY_DEPTH;
}

/**
 * True when the given relation attribute is written from THIS content type —
 * i.e. the owner/declaring side.
 *
 * ONLY `mappedBy` marks the inverse side. Per @strapi/database's own relation
 * metadata (`isOwner = !isBidirectional || hasInversedBy`,
 * @strapi/database/dist/metadata/relations.js), the side declaring `inversedBy`
 * IS the owner of a bidirectional relation. An earlier version of this
 * predicate excluded `inversedBy` as well, which meant no bidirectional
 * relation was ever synced in either direction — every two-way link silently
 * vanished from the plan. Fixed in a810890; do not "restore" the symmetry.
 */
function isOwnerSideRelation(attr) {
  return !!(attr && attr.type === 'relation' && attr.target && !attr.mappedBy);
}

/**
 * Human-readable contract, served to the admin UI so hints/labels are
 * generated from the same source as the behaviour.
 */
function describeContract() {
  return {
    defaultExecutionStrategy: DEFAULT_EXECUTION_STRATEGY,
    executionStrategies: [
      {
        value: EXECUTION_STRATEGY_HYBRID,
        label: 'Hybrid Two-Pass',
        recommended: true,
        summary: 'Pass 1 syncs entities and core media. Pass 2 syncs relations and media links from the owner side.',
        reliability: 'Most reliable: targets always exist before a link is written.',
      },
      {
        value: EXECUTION_STRATEGY_ONE_PASS,
        label: 'One-Pass',
        recommended: false,
        summary: 'Entities and relations are written together in a single pass.',
        reliability: 'Faster, but a relation whose target has not been created yet fails and is retried on the next run.',
      },
    ],
    phases: {
      content: [PHASE_ENTITIES, PHASE_RELATIONS],
      media: [MEDIA_PHASE_CORE, MEDIA_PHASE_LINKS],
    },
    dependencies: {
      depth: DEPENDENCY_DEPTH,
      depthFixed: true,
      ownerSideOnly: true,
      inScopeOnly: true,
      traversesInverseSide: false,
      rules: [
        'Dependency depth is fixed at 1 — direct relation targets only, never recursive.',
        'Only content types that are themselves enabled for sync are expanded.',
        'mappedBy / inversedBy (inverse-side) relations are never traversed.',
        'Self-references are skipped.',
      ],
    },
    media: {
      ownerSideLinksOnly: true,
      morphTraversal: false,
      rules: [
        'Media files sync first, as referenced targets.',
        'Entity→file links are written from the owning content type only.',
        'There is no separate morph-side traversal; links are never written from the file side.',
      ],
    },
  };
}

module.exports = {
  // strategies
  EXECUTION_STRATEGY_HYBRID,
  EXECUTION_STRATEGY_ONE_PASS,
  VALID_EXECUTION_STRATEGIES,
  DEFAULT_EXECUTION_STRATEGY,
  // phases
  PHASE_ALL,
  PHASE_ENTITIES,
  PHASE_RELATIONS,
  MEDIA_PHASE_CORE,
  MEDIA_PHASE_LINKS,
  // dependency constraints
  DEPENDENCY_DEPTH,
  // helpers
  resolveExecutionStrategy,
  contentPhasesFor,
  mediaPhasesFor,
  normalizeDependencyDepth,
  isOwnerSideRelation,
  describeContract,
};
