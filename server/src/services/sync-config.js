'use strict';

const { DEPENDENCY_DEPTH } = require('../utils/strategy');

const STORE_KEY = 'sync-configuration';
const PLUGIN_ID = 'strapi-content-sync-pro';

module.exports = ({ strapi }) => {
  function getStore() {
    return strapi.store({ type: 'plugin', name: PLUGIN_ID });
  }

  function plugin() {
    return strapi.plugin(PLUGIN_ID);
  }

  /**
   * Content types that are eligible for sync at all. Anything else can never be
   * enabled, so a dependency pointing at it is reported as out-of-scope rather
   * than silently added.
   */
  function syncableUids() {
    return new Set(
      plugin().service('contentTypeDiscovery').getSyncableContentTypes().map((ct) => ct.uid)
    );
  }

  function displayNameFor(uid) {
    return strapi.contentTypes?.[uid]?.info?.displayName || uid;
  }

  return {
    async getSyncConfig() {
      const store = getStore();
      const data = await store.get({ key: STORE_KEY });
      return data || { contentTypes: [], conflictStrategy: 'latest' };
    },

    async setSyncConfig(config) {
      const store = getStore();

      if (!config.contentTypes || !Array.isArray(config.contentTypes)) {
        throw new Error('contentTypes must be an array');
      }

      for (const ct of config.contentTypes) {
        if (!ct.uid) throw new Error('Each content type must have a uid');
        if (ct.direction && !['push', 'pull', 'both'].includes(ct.direction)) {
          throw new Error(`Invalid direction "${ct.direction}" for ${ct.uid}`);
        }
      }

      const value = {
        contentTypes: config.contentTypes.map((ct) => ({
          uid: ct.uid,
          direction: ct.direction || 'both',
          fields: ct.fields || [],
          enabled: ct.enabled !== undefined ? ct.enabled : true,
        })),
        conflictStrategy: config.conflictStrategy || 'latest',
      };

      await store.set({ key: STORE_KEY, value });
      return value;
    },

    /**
     * Preview what enabling one or more content types would do, before anything
     * is written. Returns the three buckets the UI shows:
     *
     *   toEnable       — will be switched on by this action
     *   alreadyEnabled — in scope already, nothing to do
     *   skipped        — a direct dependency that cannot be pulled in, with the
     *                    reason (inverse side, self-reference, not syncable, …)
     *
     * With `withDependencies`, expansion is exactly one level deep and covers
     * owner-side relation targets only — the strategy contract's rules, applied
     * here so the preview can never promise more than the sync will do.
     */
    async previewEnable({ uids = [], withDependencies = false } = {}) {
      const requested = (Array.isArray(uids) ? uids : [uids]).filter(Boolean);
      if (requested.length === 0) throw new Error('At least one content type uid is required');

      const config = await this.getSyncConfig();
      const enabledNow = new Set(
        (config.contentTypes || []).filter((ct) => ct.enabled).map((ct) => ct.uid)
      );
      const syncable = syncableUids();
      const dependencyResolver = plugin().service('dependencyResolver');

      const toEnable = [];
      const alreadyEnabled = [];
      const skipped = [];
      const seen = new Set();

      const consider = (uid, via) => {
        if (seen.has(uid)) return;
        seen.add(uid);

        if (!strapi.contentTypes?.[uid]) {
          skipped.push({ uid, via, reason: 'not_found', reasonLabel: 'Content type does not exist on this instance.' });
          return;
        }
        if (!syncable.has(uid)) {
          skipped.push({ uid, displayName: displayNameFor(uid), via, reason: 'not_syncable', reasonLabel: 'Not a syncable content type (only api:: collection types can be synced).' });
          return;
        }
        if (enabledNow.has(uid)) {
          alreadyEnabled.push({ uid, displayName: displayNameFor(uid), via });
          return;
        }
        toEnable.push({ uid, displayName: displayNameFor(uid), via });
      };

      for (const uid of requested) consider(uid, null);

      if (withDependencies) {
        for (const uid of requested) {
          if (!strapi.contentTypes?.[uid]) continue;
          let plan;
          try {
            // No scope filter here: the preview's whole job is to show what
            // enabling would ADD, so targets outside the current scope are
            // candidates, not exclusions.
            plan = dependencyResolver.getDirectDependencyTargets(uid);
          } catch (err) {
            skipped.push({ uid, reason: 'analysis_failed', reasonLabel: err.message });
            continue;
          }

          for (const target of plan.targets) consider(target.uid, uid);
          for (const s of plan.skipped) {
            if (seen.has(s.uid)) continue;
            seen.add(s.uid);
            skipped.push({
              uid: s.uid,
              displayName: displayNameFor(s.uid),
              via: uid,
              field: s.field,
              reason: s.reason,
              reasonLabel: s.reasonLabel,
            });
          }
        }
      }

      return {
        requested,
        withDependencies: !!withDependencies,
        dependencyDepth: DEPENDENCY_DEPTH,
        toEnable,
        alreadyEnabled,
        skipped,
      };
    },

    /**
     * Enable content types for sync, optionally pulling in their direct
     * dependencies, and return the same three buckets the preview showed.
     *
     * Existing per-type settings (direction, field selection) are preserved —
     * enabling one type must never reset the configuration of the others.
     *
     * profileMode:
     *   'quick' (default) — auto-generate the default profile set for each
     *                       newly enabled type
     *   'none'            — enable only; the caller will create profiles itself
     *                       (the "create + edit now" flow)
     */
    async enable({ uids = [], withDependencies = false, profileMode = 'quick' } = {}) {
      const preview = await this.previewEnable({ uids, withDependencies });
      const config = await this.getSyncConfig();
      const byUid = new Map((config.contentTypes || []).map((ct) => [ct.uid, ct]));

      for (const { uid } of preview.toEnable) {
        const existing = byUid.get(uid);
        if (existing) {
          // Re-enabling a previously configured type keeps its direction and
          // field selection.
          existing.enabled = true;
        } else {
          byUid.set(uid, { uid, direction: 'both', fields: [], enabled: true });
        }
      }

      const value = {
        contentTypes: [...byUid.values()],
        conflictStrategy: config.conflictStrategy || 'latest',
      };
      await getStore().set({ key: STORE_KEY, value });

      const profiles = [];
      if (profileMode === 'quick') {
        const profilesService = plugin().service('syncProfiles');
        for (const { uid } of preview.toEnable) {
          try {
            const created = await profilesService.autoGenerateProfiles(uid);
            profiles.push({ uid, created: created.length });
          } catch (err) {
            profiles.push({ uid, error: err.message });
          }
        }
      }

      return { ...preview, applied: true, profileMode, profiles, config: value };
    },

    /**
     * Disable content types for sync. Their configuration and profiles are kept
     * so re-enabling restores the previous setup.
     */
    async disable({ uids = [] } = {}) {
      const requested = (Array.isArray(uids) ? uids : [uids]).filter(Boolean);
      if (requested.length === 0) throw new Error('At least one content type uid is required');

      const config = await this.getSyncConfig();
      const targets = new Set(requested);
      const disabled = [];

      const contentTypes = (config.contentTypes || []).map((ct) => {
        if (!targets.has(ct.uid)) return ct;
        disabled.push(ct.uid);
        return { ...ct, enabled: false };
      });

      const value = { contentTypes, conflictStrategy: config.conflictStrategy || 'latest' };
      await getStore().set({ key: STORE_KEY, value });

      // A type that is no longer in scope can still be a dependency target of
      // one that is. Surface that so the operator knows the relation will stop
      // being linked rather than discovering it in the logs.
      const dependencyResolver = plugin().service('dependencyResolver');
      const stillEnabled = contentTypes.filter((ct) => ct.enabled).map((ct) => ct.uid);
      const nowOutOfScope = [];
      for (const uid of stillEnabled) {
        let plan;
        try {
          plan = dependencyResolver.getDirectDependencyTargets(uid);
        } catch {
          continue;
        }
        for (const target of plan.targets) {
          if (targets.has(target.uid)) {
            nowOutOfScope.push({ uid: target.uid, referencedBy: uid, field: target.field });
          }
        }
      }

      return { disabled, nowOutOfScope, config: value };
    },
  };
};
