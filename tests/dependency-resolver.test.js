'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const createResolver = require('../server/src/services/dependency-resolver');

/**
 * Minimal fake Strapi carrying only what the resolver reads: contentTypes and
 * their attributes. Modelled on Rutba's real CMS shape — a page with a
 * bidirectional owner-side relation (inversedBy), a menu-item with a
 * self-reference and an inverse side (mappedBy), and a relation to a
 * users-permissions target.
 */
function makeStrapi() {
  return {
    contentTypes: {
      'api::page.page': {
        info: { displayName: 'Page' },
        attributes: {
          title: { type: 'string' },
          // Owner side of a bidirectional relation: declares inversedBy.
          page_group: { type: 'relation', relation: 'manyToOne', target: 'api::page-group.page-group', inversedBy: 'pages' },
          cover: { type: 'media', multiple: false },
          gallery: { type: 'media', multiple: true },
          author: { type: 'relation', relation: 'manyToOne', target: 'plugin::users-permissions.user' },
        },
      },
      'api::page-group.page-group': {
        info: { displayName: 'Page Group' },
        attributes: {
          name: { type: 'string' },
          // Inverse side: declares mappedBy, must never be traversed or written.
          pages: { type: 'relation', relation: 'oneToMany', target: 'api::page.page', mappedBy: 'page_group' },
          // Depth-2 target, reachable only through page-group.
          theme: { type: 'relation', relation: 'oneToOne', target: 'api::theme.theme' },
        },
      },
      'api::theme.theme': {
        info: { displayName: 'Theme' },
        attributes: { name: { type: 'string' } },
      },
      'api::menu-item.menu-item': {
        info: { displayName: 'Menu Item' },
        attributes: {
          label: { type: 'string' },
          // Self-reference — never a dependency of itself.
          parent: { type: 'relation', relation: 'manyToOne', target: 'api::menu-item.menu-item' },
          menu: { type: 'relation', relation: 'manyToOne', target: 'api::menu.menu', inversedBy: 'items' },
        },
      },
      'api::menu.menu': {
        info: { displayName: 'Menu' },
        attributes: {
          title: { type: 'string' },
          items: { type: 'relation', relation: 'oneToMany', target: 'api::menu-item.menu-item', mappedBy: 'menu' },
        },
      },
      'admin::user': { attributes: {} },
      'plugin::users-permissions.user': { attributes: {} },
    },
  };
}

const resolver = () => createResolver({ strapi: makeStrapi() });

const uidsOf = (list) => list.map((t) => t.uid).sort();
const reasonFor = (skipped, uid) => (skipped.find((s) => s.uid === uid) || {}).reason;

// ── Regression guard for the bug fixed in a810890 ──────────────────────────

test('an inversedBy relation IS a dependency — it is the owner side', () => {
  const plan = resolver().getDirectDependencyTargets('api::page.page');
  assert.ok(
    plan.targets.some((t) => t.uid === 'api::page-group.page-group'),
    'page → page-group (declared with inversedBy) must be expanded'
  );
});

test('a mappedBy relation is skipped as the inverse side', () => {
  const plan = resolver().getDirectDependencyTargets('api::page-group.page-group');
  assert.ok(!plan.targets.some((t) => t.uid === 'api::page.page'), 'the inverse side must not be expanded');
  assert.equal(reasonFor(plan.skipped, 'api::page.page'), 'inverse_side');
});

// ── Constraint rules ───────────────────────────────────────────────────────

test('a self-reference is never its own dependency', () => {
  const plan = resolver().getDirectDependencyTargets('api::menu-item.menu-item');
  assert.ok(!plan.targets.some((t) => t.uid === 'api::menu-item.menu-item'));
  assert.equal(reasonFor(plan.skipped, 'api::menu-item.menu-item'), 'self_reference');
});

test('depth is 1: a transitive target is never pulled in', () => {
  const plan = resolver().getDirectDependencyTargets('api::page.page');
  assert.equal(plan.depth, 1);
  assert.ok(
    !plan.targets.some((t) => t.uid === 'api::theme.theme'),
    'theme is reachable only via page-group, so it is depth 2 and out of the plan'
  );
});

test('out-of-scope targets are reported, not silently dropped', () => {
  const scope = new Set(['api::page.page']); // page-group deliberately excluded
  const plan = resolver().getConstrainedDependencyPlan('api::page.page', scope);
  assert.equal(plan.targets.length, 0);
  assert.equal(reasonFor(plan.skipped, 'api::page-group.page-group'), 'out_of_scope');
});

test('an empty scope means "no filter", so a preview can show what enabling would add', () => {
  const plan = resolver().getConstrainedDependencyPlan('api::page.page', new Set());
  assert.deepEqual(uidsOf(plan.targets), ['api::page-group.page-group']);
});

test('plugin-internal targets are not syncable dependencies', () => {
  const plan = resolver().getDirectDependencyTargets('api::page.page');
  // users-permissions is plugin-scoped: excluded from dependency expansion.
  assert.ok(!plan.targets.some((t) => t.uid.startsWith('plugin::')));
});

// ── Ordering ───────────────────────────────────────────────────────────────

test('dependency targets are ordered before the types that reference them', () => {
  const order = resolver().orderByDependencies(['api::page.page', 'api::page-group.page-group']);
  assert.ok(
    order.indexOf('api::page-group.page-group') < order.indexOf('api::page.page'),
    'page-group must be synced before page'
  );
});

test('a bidirectional pair does not look like a cycle', () => {
  // menu ↔ menu-item: only the menu-item side is owner (inversedBy), so exactly
  // one ordering edge exists and the sort is total.
  const order = resolver().orderByDependencies(['api::menu-item.menu-item', 'api::menu.menu']);
  assert.equal(order.length, 2);
  assert.ok(order.indexOf('api::menu.menu') < order.indexOf('api::menu-item.menu-item'));
});

test('ordering terminates and loses nothing when a real cycle exists', () => {
  const strapi = makeStrapi();
  // Force a genuine owner-side cycle: a ⇄ b, both declaring the relation.
  strapi.contentTypes['api::a.a'] = { attributes: { b: { type: 'relation', target: 'api::b.b' } } };
  strapi.contentTypes['api::b.b'] = { attributes: { a: { type: 'relation', target: 'api::a.a' } } };
  const order = createResolver({ strapi }).orderByDependencies(['api::a.a', 'api::b.b']);
  assert.deepEqual(order.sort(), ['api::a.a', 'api::b.b'], 'every input survives the fallback');
});

// ── Media fields ───────────────────────────────────────────────────────────

test('media fields are reported for the owning content type', () => {
  const fields = resolver().getMediaFields('api::page.page');
  assert.deepEqual(
    fields.map((f) => [f.field, f.multiple]).sort(),
    [['cover', false], ['gallery', true]]
  );
});

test('getMediaFields is safe for a content type that does not exist', () => {
  assert.deepEqual(resolver().getMediaFields('api::nope.nope'), []);
});

test('the summary explains what the constraints excluded', () => {
  const summary = resolver().getDependencySummary('api::page-group.page-group', 1, new Set());
  assert.equal(summary.depth, 1);
  assert.equal(summary.depthFixed, true);
  assert.equal(summary.inverseSideRelations, 1, 'the mappedBy relation is counted as inverse');
  assert.ok(summary.skipped.some((s) => s.reason === 'inverse_side'));
});
