'use strict';

/**
 * Dependency Resolver Service
 * 
 * Analyzes content type relationships and resolves dependencies for sync operations.
 * Ensures related entities are synced before or alongside core entities.
 * 
 * Handles:
 * - Relations (oneToOne, oneToMany, manyToOne, manyToMany)
 * - Components
 * - Dynamic zones
 * - Media (via upload plugin)
 */
module.exports = ({ strapi }) => {
  // Cache for resolved dependency graphs
  const dependencyCache = new Map();

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
     * Analyze a content type and extract all dependencies
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
        components: [],
        dynamicZones: [],
        media: [],
      };

      for (const [fieldName, attr] of Object.entries(attributes)) {
        switch (attr.type) {
          case 'relation':
            if (attr.target) {
              dependencies.relations.push({
                field: fieldName,
                target: attr.target,
                relation: attr.relation,
                mappedBy: attr.mappedBy,
                inversedBy: attr.inversedBy,
              });
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
     * Build a full dependency graph for a content type
     * Returns ordered list of content types that need to be synced
     */
    buildDependencyGraph(uid, depth = 1, visited = new Set()) {
      if (depth < 1 || visited.has(uid)) {
        return [];
      }

      visited.add(uid);
      const analysis = this.analyzeContentType(uid);
      const graph = [];

      // Process relations (other content types)
      for (const relation of analysis.relations) {
        const targetUid = relation.target;

        // Skip self-references and already visited
        if (targetUid === uid || visited.has(targetUid)) {
          continue;
        }

        // Skip plugin content types (admin, upload, etc.) unless explicitly synced
        if (targetUid.startsWith('plugin::') && !targetUid.startsWith('plugin::users-permissions')) {
          continue;
        }

        // Add to graph with lower priority (dependencies first)
        graph.push({
          uid: targetUid,
          referencedBy: uid,
          field: relation.field,
          relationType: relation.relation,
          priority: 1, // Lower number = sync first
        });

        // Recurse if depth allows
        if (depth > 1) {
          const subGraph = this.buildDependencyGraph(targetUid, depth - 1, visited);
          for (const entry of subGraph) {
            entry.priority += 1; // Increase priority (sync even earlier)
            graph.push(entry);
          }
        }
      }

      // Process components (shared structures)
      for (const comp of analysis.components) {
        const compUid = comp.component;
        if (!visited.has(compUid)) {
          visited.add(compUid);
          graph.push({
            uid: compUid,
            referencedBy: uid,
            field: comp.field,
            type: 'component',
            repeatable: comp.repeatable,
            priority: 0, // Components sync first
          });
        }
      }

      // Process dynamic zones
      for (const dz of analysis.dynamicZones) {
        for (const compUid of dz.components) {
          if (!visited.has(compUid)) {
            visited.add(compUid);
            graph.push({
              uid: compUid,
              referencedBy: uid,
              field: dz.field,
              type: 'dynamiczone_component',
              priority: 0,
            });
          }
        }
      }

      return graph;
    },

    /**
     * Get ordered list of content types to sync for a given content type
     * Returns UIDs in the order they should be synced (dependencies first)
     */
    getSyncOrder(uid, depth = 1) {
      const graph = this.buildDependencyGraph(uid, depth);

      // Sort by priority (lower first) and deduplicate
      const sorted = graph
        .sort((a, b) => a.priority - b.priority)
        .reduce((acc, entry) => {
          if (!acc.some(e => e.uid === entry.uid)) {
            acc.push(entry);
          }
          return acc;
        }, []);

      // Return just the UIDs in order, followed by the main content type
      const order = sorted.map(e => e.uid);
      order.push(uid);

      return order;
    },

    /**
     * Get constrained dependency targets for a content type under one-pass rules:
     *   - depth fixed to 1
     *   - only direct owner-side relation targets (no mappedBy / inversedBy)
     *   - only targets in sync scope (scopeUids set)
     * Returns array of { uid, field, relation } objects.
     */
    getConstrainedDependencyTargets(uid, scopeUids = new Set()) {
      const analysis = this.analyzeContentType(uid);
      const results = [];

      for (const rel of analysis.relations) {
        // Owner/declaring side only: skip inverse and mapped-by sides
        if (rel.mappedBy || rel.inversedBy) continue;
        // Skip self-references
        if (rel.target === uid) continue;
        // Skip targets not in sync scope
        if (scopeUids.size > 0 && !scopeUids.has(rel.target)) continue;
        // Skip plugin-internal types unless users-permissions
        if (rel.target.startsWith('plugin::') && !rel.target.startsWith('plugin::users-permissions')) continue;

        results.push({
          uid: rel.target,
          field: rel.field,
          relation: rel.relation,
        });
      }

      // Deduplicate by target uid (keep first occurrence)
      const seen = new Set();
      return results.filter((r) => {
        if (seen.has(r.uid)) return false;
        seen.add(r.uid);
        return true;
      });
    },

    /**
     * Extract related entity IDs from a record for dependency syncing
     */
    extractRelatedIds(record, uid) {
      const analysis = this.analyzeContentType(uid);
      const relatedIds = {};

      for (const relation of analysis.relations) {
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
        analysis.relations.length > 0 ||
        analysis.components.length > 0 ||
        analysis.dynamicZones.length > 0
      );
    },

    /**
     * Get dependency summary for UI display
     */
    getDependencySummary(uid, depth = 1) {
      const analysis = this.analyzeContentType(uid);
      const graph = this.buildDependencyGraph(uid, depth);

      return {
        uid,
        directRelations: analysis.relations.length,
        components: analysis.components.length,
        dynamicZones: analysis.dynamicZones.length,
        mediaFields: analysis.media.length,
        totalDependencies: graph.length,
        dependencies: graph.map(d => ({
          uid: d.uid,
          field: d.field,
          type: d.type || 'relation',
          relationType: d.relationType,
        })),
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
