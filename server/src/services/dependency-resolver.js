'use strict';

const {
  DEPENDENCY_DEPTH,
  isOwnerSideRelation,
  normalizeDependencyDepth,
} = require('../utils/strategy');

/**
 * Dependency Resolver Service
 *
 * Analyzes content type relationships and resolves dependencies for sync
 * operations, under the constraints fixed by the strategy contract
 * (see utils/strategy.js):
 *
 *   - depth is ALWAYS 1 — direct targets only, never recursive
 *   - owner/declaring side only — `mappedBy` / `inversedBy` are never traversed
 *   - in-scope only — a target that is not itself enabled for sync is skipped
 *   - self-references are skipped
 *
 * Every skip is reported with a reason so the UI can explain what was left out
 * instead of silently shrinking the plan.
 *
 * Handles:
 * - Relations (oneToOne, oneToMany, manyToOne, manyToMany)
 * - Components
 * - Dynamic zones
 * - Media (as a referenced target — links are applied from the owner entity)
 */
module.exports = ({ strapi }) => {
  // Cache for resolved dependency graphs
  const dependencyCache = new Map();

  const SKIP_SELF = 'self_reference';
  const SKIP_INVERSE = 'inverse_side';
  const SKIP_PLUGIN_INTERNAL = 'plugin_internal';
  const SKIP_OUT_OF_SCOPE = 'out_of_scope';

  const SKIP_REASON_LABELS = {
    [SKIP_SELF]: 'Self-reference — a content type is never its own dependency.',
    [SKIP_INVERSE]: 'Inverse side (mappedBy) — links are written from the owner side only.',
    [SKIP_PLUGIN_INTERNAL]: 'Plugin- or admin-scoped content type — not syncable as a relation dependency.',
    [SKIP_OUT_OF_SCOPE]: 'Target is not enabled for sync.',
  };

  /**
   * Plugin- and admin-scoped content types are never relation dependencies.
   *
   * This deliberately covers users-permissions too, matching the relation-write
   * rule in sync.js's getOwnerRelationFieldSet: a documentId pointing at a user
   * (or any admin record) almost never resolves on the target instance, and one
   * unresolvable id fails the ENTIRE record's relations write, not just that
   * field. Users have their own dedicated transport (/users/export + /users/import
   * and the userSync service) — they are not carried across as a relation target.
   *
   * Planner and writer must agree here: if the planner pulled a users-permissions
   * type into scope, the writer would still refuse to write the field, and the
   * enable preview would offer a type that can never sync.
   */
  function isPluginInternal(uid) {
    return uid.startsWith('plugin::') || uid.startsWith('admin::');
  }

  return {
    /**
     * Get content type schema with relation details
     */
    getContentTypeSchema(uid) {
      const contentType = strapi.contentTypes[uid];
      if (!contentType) {
        throw new Error(`Content type "${uid}" not found`);
      }
      return contentType;
    },

    /**
     * Analyze a content type and extract all dependencies.
     *
     * `relations` is every declared relation (including inverse sides) so
     * callers that need the raw schema still see everything; `ownerRelations`
     * is the subset the strategy is allowed to act on.
     */
    analyzeContentType(uid) {
      const cached = dependencyCache.get(uid);
      if (cached) {
        return cached;
      }

      const contentType = this.getContentTypeSchema(uid);
      const attributes = contentType.attributes || {};
      const dependencies = {
        uid,
        relations: [],
        ownerRelations: [],
        inverseRelations: [],
        components: [],
        dynamicZones: [],
        media: [],
      };

      for (const [fieldName, attr] of Object.entries(attributes)) {
        switch (attr.type) {
          case 'relation':
            if (attr.target) {
              const entry = {
                field: fieldName,
                target: attr.target,
                relation: attr.relation,
                mappedBy: attr.mappedBy,
                inversedBy: attr.inversedBy,
                ownerSide: isOwnerSideRelation(attr),
              };
              dependencies.relations.push(entry);
              if (entry.ownerSide) dependencies.ownerRelations.push(entry);
              else dependencies.inverseRelations.push(entry);
            }
            break;

          case 'component':
            dependencies.components.push({
              field: fieldName,
              component: attr.component,
              repeatable: attr.repeatable || false,
            });
            break;

          case 'dynamiczone':
            dependencies.dynamicZones.push({
              field: fieldName,
              components: attr.components || [],
            });
            break;

          case 'media':
            dependencies.media.push({
              field: fieldName,
              multiple: attr.multiple || false,
              allowedTypes: attr.allowedTypes || ['images', 'files', 'videos', 'audios'],
            });
            break;
        }
      }

      dependencyCache.set(uid, dependencies);
      return dependencies;
    },

    /**
     * Media fields declared by a content type. These are the fields the media
     * link pass writes from — media is a referenced target, so the owning
     * entity is always the side that applies the link.
     */
    getMediaFields(uid) {
      try {
        return this.analyzeContentType(uid).media;
      } catch {
        return [];
      }
    },

    /**
     * Direct, owner-side dependency targets for a content type, with an
     * explicit list of what was skipped and why. Depth is fixed at 1.
     *
     * Returns { uid, depth, targets: [{ uid, field, relation }],
     *           skipped: [{ uid, field, reason, reasonLabel }] }
     */
    getDirectDependencyTargets(uid) {
      const analysis = this.analyzeContentType(uid);
      const targets = [];
      const skipped = [];
      const seen = new Set();

      const skip = (target, field, reason) => {
        skipped.push({ uid: target, field, reason, reasonLabel: SKIP_REASON_LABELS[reason] });
      };

      for (const rel of analysis.relations) {
        // Owner/declaring side only — never traverse the inverse side.
        if (!rel.ownerSide) {
          skip(rel.target, rel.field, SKIP_INVERSE);
          continue;
        }
        if (rel.target === uid) {
          skip(rel.target, rel.field, SKIP_SELF);
          continue;
        }
        if (isPluginInternal(rel.target)) {
          skip(rel.target, rel.field, SKIP_PLUGIN_INTERNAL);
          continue;
        }
        if (seen.has(rel.target)) continue; // already collected via another field
        seen.add(rel.target);
        targets.push({ uid: rel.target, field: rel.field, relation: rel.relation });
      }

      return { uid, depth: DEPENDENCY_DEPTH, targets, skipped };
    },

    /**
     * Direct dependency plan filtered to the sync scope. Anything outside the
     * scope is reported as skipped rather than dropped silently.
     *
     * `scopeUids` empty/omitted means "no scope filter" (used by previews that
     * want to show what enabling would pull in).
     */
    getConstrainedDependencyPlan(uid, scopeUids = new Set()) {
      const plan = this.getDirectDependencyTargets(uid);
      if (!scopeUids || scopeUids.size === 0) return plan;

      const targets = [];
      const skipped = [...plan.skipped];

      for (const t of plan.targets) {
        if (scopeUids.has(t.uid)) {
          targets.push(t);
        } else {
          skipped.push({
            uid: t.uid,
            field: t.field,
            reason: SKIP_OUT_OF_SCOPE,
            reasonLabel: SKIP_REASON_LABELS[SKIP_OUT_OF_SCOPE],
          });
        }
      }

      return { uid, depth: DEPENDENCY_DEPTH, targets, skipped };
    },

    /**
     * Get constrained dependency targets for a content type under the strategy
     * rules (depth 1, owner side only, in-scope only).
     * Returns array of { uid, field, relation } objects.
     */
    getConstrainedDependencyTargets(uid, scopeUids = new Set()) {
      return this.getConstrainedDependencyPlan(uid, scopeUids).targets;
    },

    /**
     * Build the dependency graph for a content type.
     *
     * Depth is fixed at 1 by the strategy contract, so this returns only direct
     * owner-side relation targets plus the components / dynamic-zone components
     * the type embeds. The `depth` argument is accepted for call-site
     * compatibility and deliberately ignored — see utils/strategy.js.
     */
    buildDependencyGraph(uid, depth = DEPENDENCY_DEPTH, scopeUids = new Set()) {
      normalizeDependencyDepth(depth); // always 1 — no recursive traversal
      const analysis = this.analyzeContentType(uid);
      const plan = this.getConstrainedDependencyPlan(uid, scopeUids);
      const graph = [];

      // Components sync with their parent record, so they come first.
      const seenComponents = new Set();
      for (const comp of analysis.components) {
        if (seenComponents.has(comp.component)) continue;
        seenComponents.add(comp.component);
        graph.push({
          uid: comp.component,
          referencedBy: uid,
          field: comp.field,
          type: 'component',
          repeatable: comp.repeatable,
          priority: 0,
        });
      }

      for (const dz of analysis.dynamicZones) {
        for (const compUid of dz.components) {
          if (seenComponents.has(compUid)) continue;
          seenComponents.add(compUid);
          graph.push({
            uid: compUid,
            referencedBy: uid,
            field: dz.field,
            type: 'dynamiczone_component',
            priority: 0,
          });
        }
      }

      // Direct owner-side relation targets (depth 1).
      for (const target of plan.targets) {
        graph.push({
          uid: target.uid,
          referencedBy: uid,
          field: target.field,
          type: 'relation',
          relationType: target.relation,
          priority: 1,
        });
      }

      return graph;
    },

    /**
     * Ordered list of content types to sync for a given content type:
     * direct dependencies first, then the type itself.
     */
    getSyncOrder(uid, depth = DEPENDENCY_DEPTH, scopeUids = new Set()) {
      const graph = this.buildDependencyGraph(uid, depth, scopeUids);

      const order = [];
      for (const entry of graph.sort((a, b) => a.priority - b.priority)) {
        if (entry.type === 'component' || entry.type === 'dynamiczone_component') continue;
        if (!order.includes(entry.uid)) order.push(entry.uid);
      }
      order.push(uid);

      return order;
    },

    /**
     * Order a set of content types so dependency targets are processed before
     * the types that reference them (Kahn topological sort over the owner-side
     * relation edges only). Cycles fall back to the input order.
     *
     * This is the single ordering implementation used by sync-now and bulk
     * transfer, so both stay dependency-aware and stable in the same way.
     */
    orderByDependencies(uids = []) {
      const uidSet = new Set(uids);
      const inDegree = new Map();
      const adjacency = new Map();

      uids.forEach((uid) => {
        inDegree.set(uid, 0);
        adjacency.set(uid, []);
      });

      for (const uid of uids) {
        let targets = [];
        try {
          // Owner-side + in-scope only: an inverse-side relation must not
          // create an ordering edge, or a two-way pair looks like a cycle.
          targets = this.getConstrainedDependencyPlan(uid, uidSet).targets;
        } catch (_) {
          // Unreadable schema — keep the fallback order.
        }
        for (const target of targets) {
          if (target.uid === uid) continue;
          adjacency.get(target.uid).push(uid);
          inDegree.set(uid, (inDegree.get(uid) || 0) + 1);
        }
      }

      const queue = uids.filter((uid) => (inDegree.get(uid) || 0) === 0);
      const ordered = [];
      while (queue.length > 0) {
        const uid = queue.shift();
        ordered.push(uid);
        for (const next of adjacency.get(uid) || []) {
          const deg = (inDegree.get(next) || 0) - 1;
          inDegree.set(next, deg);
          if (deg === 0) queue.push(next);
        }
      }

      // Cycle fallback: append anything the sort could not place, in input order.
      const placed = new Set(ordered);
      for (const uid of uids) {
        if (!placed.has(uid)) ordered.push(uid);
      }
      return ordered;
    },

    /**
     * Extract related entity IDs from a record for dependency syncing.
     * Owner-side relations only — the inverse side is never followed.
     */
    extractRelatedIds(record, uid) {
      const analysis = this.analyzeContentType(uid);
      const relatedIds = {};

      for (const relation of analysis.ownerRelations) {
        const fieldValue = record[relation.field];
        if (!fieldValue) continue;

        const ids = [];
        if (Array.isArray(fieldValue)) {
          // Many relation
          for (const item of fieldValue) {
            if (item && (item.id || item.documentId)) {
              ids.push({
                id: item.id,
                documentId: item.documentId,
              });
            }
          }
        } else if (typeof fieldValue === 'object') {
          // Single relation
          if (fieldValue.id || fieldValue.documentId) {
            ids.push({
              id: fieldValue.id,
              documentId: fieldValue.documentId,
            });
          }
        } else if (typeof fieldValue === 'number' || typeof fieldValue === 'string') {
          // Just an ID reference
          ids.push({ id: fieldValue });
        }

        if (ids.length > 0) {
          relatedIds[relation.target] = relatedIds[relation.target] || [];
          relatedIds[relation.target].push(...ids);
        }
      }

      return relatedIds;
    },

    /**
     * Check if a content type has syncable dependencies
     */
    hasDependencies(uid) {
      const analysis = this.analyzeContentType(uid);
      return (
        analysis.ownerRelations.length > 0 ||
        analysis.components.length > 0 ||
        analysis.dynamicZones.length > 0
      );
    },

    /**
     * Dependency summary for UI display, including what the constraints
     * excluded so the operator can see why a type is not being pulled in.
     */
    getDependencySummary(uid, depth = DEPENDENCY_DEPTH, scopeUids = new Set()) {
      const analysis = this.analyzeContentType(uid);
      const plan = this.getConstrainedDependencyPlan(uid, scopeUids);
      const graph = this.buildDependencyGraph(uid, depth, scopeUids);

      return {
        uid,
        depth: DEPENDENCY_DEPTH,
        depthFixed: true,
        directRelations: analysis.relations.length,
        ownerSideRelations: analysis.ownerRelations.length,
        inverseSideRelations: analysis.inverseRelations.length,
        components: analysis.components.length,
        dynamicZones: analysis.dynamicZones.length,
        mediaFields: analysis.media.length,
        totalDependencies: graph.length,
        dependencies: graph.map((d) => ({
          uid: d.uid,
          field: d.field,
          type: d.type || 'relation',
          relationType: d.relationType,
        })),
        skipped: plan.skipped,
      };
    },

    /**
     * Clear the dependency cache (call after schema changes)
     */
    clearCache() {
      dependencyCache.clear();
    },
  };
};
