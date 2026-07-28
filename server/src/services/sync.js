'use strict';

const { fetchLocalRecords, fetchRemoteRecords, fetchLocalPage, fetchRemotePage, fetchAllLocalIds, fetchAllRemoteIds } = require('../utils/fetcher');
const { compareRecords } = require('../utils/comparator');
const { applyLocal, applyRemote, deleteLocal, deleteRemote } = require('../utils/applier');
const {
  PHASE_ALL,
  PHASE_RELATIONS,
  MEDIA_PHASE_CORE,
  MEDIA_PHASE_LINKS,
  contentPhasesFor,
  resolveExecutionStrategy,
} = require('../utils/strategy');

const LAST_SYNC_STORE_KEY = 'last-sync-timestamps';
const SYNCED_IDS_STORE_PREFIX = 'synced-ids:';

module.exports = ({ strapi }) => {
  function getStore() {
    return strapi.store({ type: 'plugin', name: 'strapi-content-sync-pro' });
  }

  function plugin() {
    return strapi.plugin('strapi-content-sync-pro');
  }

  async function getLastSyncTimestamps() {
    const store = getStore();
    return (await store.get({ key: LAST_SYNC_STORE_KEY })) || {};
  }

  async function setLastSyncTimestamp(uid, timestamp) {
    const store = getStore();
    const timestamps = await getLastSyncTimestamps();
    timestamps[uid] = timestamp;
    await store.set({ key: LAST_SYNC_STORE_KEY, value: timestamps });
  }

  /**
   * Snapshot-based deletion reconciliation.
   *
   * A record can only be *deleted* on one side if it was previously synced and
   * is now gone. We persist the set of documentIds that existed at the end of
   * the last sync ("snapshot"); a documentId that is in the snapshot but now
   * absent on exactly one side was deleted there, so we propagate the delete to
   * the other side (respecting direction). Records that are NOT in the snapshot
   * are never deleted — that removes the create-vs-delete ambiguity that makes
   * naive bidirectional deletion unsafe. Existence is checked with draft status
   * so unpublishing is never mistaken for deletion.
   */
  async function reconcileDeletions(uid, { direction, remoteConfig }) {
    const logService = plugin().service('syncLog');
    const store = getStore();
    const snapKey = `${SYNCED_IDS_STORE_PREFIX}${uid}`;
    const prevIds = new Set((await store.get({ key: snapKey })) || []);

    const [localIds, remoteIds] = await Promise.all([
      fetchAllLocalIds(strapi, uid),
      fetchAllRemoteIds(remoteConfig, uid),
    ]);

    let deletedRemote = 0;
    let deletedLocal = 0;
    let errors = 0;
    const deleted = new Set();

    // First run (no snapshot): just record the baseline, delete nothing.
    if (prevIds.size > 0) {
      for (const id of prevIds) {
        const onLocal = localIds.has(id);
        const onRemote = remoteIds.has(id);
        if (onLocal === onRemote) continue; // present or absent on both → not a one-sided delete

        if (!onLocal && onRemote && (direction === 'push' || direction === 'both')) {
          try {
            await deleteRemote(remoteConfig, uid, { documentId: id });
            deleted.add(id); deletedRemote++;
            await logService.log({ action: 'delete_remote', contentType: uid, syncId: id, direction: 'push', status: 'success', message: `Reconciled delete → remote ${id}` });
          } catch (err) {
            errors++;
            await logService.log({ action: 'delete_remote', contentType: uid, syncId: id, direction: 'push', status: 'error', message: err.message });
          }
        } else if (onLocal && !onRemote && (direction === 'pull' || direction === 'both')) {
          try {
            await deleteLocal(strapi, uid, { documentId: id });
            deleted.add(id); deletedLocal++;
            await logService.log({ action: 'delete_local', contentType: uid, syncId: id, direction: 'pull', status: 'success', message: `Reconciled delete → local ${id}` });
          } catch (err) {
            errors++;
            await logService.log({ action: 'delete_local', contentType: uid, syncId: id, direction: 'pull', status: 'error', message: err.message });
          }
        }
      }
    }

    // New snapshot = everything that currently exists on either side, minus what
    // we just deleted.
    const union = [...new Set([...localIds, ...remoteIds])].filter((id) => !deleted.has(id));
    await store.set({ key: snapKey, value: union });

    return { deletedRemote, deletedLocal, errors };
  }

  /**
   * Emit an alert when a sync error looks like a remote auth failure (expired /
   * revoked API token or missing permission), so the operator is notified
   * instead of sync silently failing. Throttled by the alerts service.
   */
  async function maybeAlertAuthFailure(uid, err) {
    const msg = err?.message || '';
    if (!/(\b401\b|\b403\b|unauthorized|invalid credentials|forbidden)/i.test(msg)) return;
    try {
      await plugin().service('alerts').sendAlert('sync_failure', {
        contentType: uid,
        error: `Remote authentication failed (token may be expired or lack access): ${msg}`.slice(0, 300),
      });
    } catch (_) {
      // alerts are best-effort
    }
  }

  const SCALAR_TYPES = new Set([
    'string', 'text', 'richtext', 'blocks', 'integer', 'biginteger',
    'float', 'decimal', 'boolean', 'date', 'datetime', 'time',
    'email', 'password', 'enumeration', 'uid', 'json',
  ]);

  // Managed / reserved fields Strapi injects at runtime that are NOT valid in a
  // REST `fields[]` selection (locale/localizations are separate query params;
  // audit + timestamp fields are handled elsewhere).
  const RESERVED_FIELDS = new Set([
    'id', 'documentId', 'locale', 'localizations',
    'createdAt', 'updatedAt', 'publishedAt', 'createdBy', 'updatedBy',
  ]);

  function isScalarSyncField(uid, field) {
    if (RESERVED_FIELDS.has(field)) return false;
    const a = strapi.contentTypes?.[uid]?.attributes?.[field];
    return !!a && SCALAR_TYPES.has(a.type);
  }

  function allScalarFields(uid) {
    const attrs = strapi.contentTypes?.[uid]?.attributes || {};
    return Object.keys(attrs).filter((k) => isScalarSyncField(uid, k));
  }

  function getOwnerRelationFieldSet(uid, allowedFields) {
    const contentType = strapi.contentTypes?.[uid];
    const attrs = contentType?.attributes || {};
    const allowed = new Set(allowedFields || []);
    const set = new Set();

    for (const [field, attr] of Object.entries(attrs)) {
      if (attr?.type !== 'relation' || !attr.target) continue;
      // Owner/declaring side only. Per Strapi's own relation metadata
      // (@strapi/database/dist/metadata/relations.js: isOwner = !isBidirectional
      // || hasInversedBy), the side declaring `inversedBy` IS the owner side for
      // a bidirectional relation — only `mappedBy` marks the inverse side that
      // must never be written from here (that would double-write the link).
      if (attr.mappedBy) continue;
      // Never write a relation whose target isn't a content type this sync run
      // could plausibly know about — a documentId reference to a users-permissions
      // user (or any admin/plugin-scoped record) is almost never present with a
      // matching id on the target instance, and Strapi hard-fails the ENTIRE
      // record's relations write (not just this field) on one unresolvable
      // documentId. Excluding these is a strict narrowing, never adds a field
      // that was previously included.
      if (attr.target.startsWith('plugin::') || attr.target.startsWith('admin::')) continue;
      if (allowed.size === 0 || allowed.has(field)) set.add(field);
    }

    return set;
  }

  function selectFieldsForPhase(uid, configuredFields, phase = PHASE_ALL) {
    const configured = Array.isArray(configuredFields) ? configuredFields : [];
    if (!uid) return configured;
    if (phase === PHASE_ALL) return configured; // one_pass: [] means "all fields"

    const ownerRelationFields = getOwnerRelationFieldSet(uid, configured);

    if (phase === PHASE_RELATIONS) {
      // Owner-side relations plus the keys needed to match records by identity.
      return ['documentId', 'syncId', 'updatedAt', ...ownerRelationFields];
    }

    // Entities phase: SCALAR fields only. Relations, media, and components
    // reference external records/files that may not exist on the target yet;
    // sending them here causes "related document not found" failures. Owner
    // relations are applied in the relations phase; files via media sync.
    // An empty configured list means "all fields", which we resolve to the full
    // scalar attribute set so relations are actually excluded (an empty array
    // would otherwise be treated as "keep everything" downstream).
    const base = configured.length
      ? configured.filter((f) => isScalarSyncField(uid, f))
      : allScalarFields(uid);
    return base;
  }

  /**
   * A content type has nothing to do in the relations pass when it declares no
   * owner-side relations — skipping it avoids a pointless double fetch of every
   * record on both sides.
   */
  function hasOwnerRelations(uid, configuredFields) {
    return getOwnerRelationFieldSet(uid, configuredFields).size > 0;
  }

  /**
   * Apply one phase of one content type and return its counters.
   *
   * This is the single write path shared by sync-now and profile execution, so
   * both entry points apply the strategy identically.
   */
  async function runPhaseForContentType(ctx) {
    const {
      uid, phase, direction, conflictStrategy,
      fields, fieldPolicies, remoteConfig, pageSize, lastSyncAt,
    } = ctx;

    const logService = plugin().service('syncLog');
    const syncProfilesService = plugin().service('syncProfiles');

    const counters = { pushed: 0, pulled: 0, errors: 0, unmatched: 0 };
    const phaseFields = selectFieldsForPhase(uid, fields, phase);

    // Both sides are fetched in pages of `pageSize` records under the hood (see
    // utils/fetcher.js). We aggregate per content-type because the comparator
    // needs the full set to diff by documentId, but each network/DB call still
    // only returns a bounded chunk.
    const localRecords = await fetchLocalRecords(strapi, uid, { fields: phaseFields, lastSyncAt, pageSize });
    const remoteRecords = await fetchRemoteRecords(remoteConfig, uid, { fields: phaseFields, lastSyncAt, pageSize });

    // Deletions never come from a phase diff — a one-sided record is a create
    // candidate, not a delete. reconcileDeletions owns deletion, from the full
    // documentId snapshot, after both passes.
    const diff = compareRecords(localRecords, remoteRecords, {
      direction,
      conflictStrategy,
      phase,
    });

    counters.unmatched = diff.unmatched || 0;

    const pushRecord = async (record, action) => {
      try {
        const filtered = syncProfilesService.filterFieldsByPolicy(record, fieldPolicies, 'push');
        await applyRemote(remoteConfig, uid, filtered, phaseFields);
        counters.pushed++;
      } catch (err) {
        counters.errors++;
        await logService.log({ action, contentType: uid, syncId: record.syncId || record.documentId, direction: 'push', status: 'error', message: `[${phase}] ${err.message}` });
      }
    };

    const pullRecord = async (record, action) => {
      try {
        const filtered = syncProfilesService.filterFieldsByPolicy(record, fieldPolicies, 'pull');
        await applyLocal(strapi, uid, filtered, phaseFields);
        counters.pulled++;
      } catch (err) {
        counters.errors++;
        await logService.log({ action, contentType: uid, syncId: record.syncId || record.documentId, direction: 'pull', status: 'error', message: `[${phase}] ${err.message}` });
      }
    };

    for (const { local } of diff.toPush) await pushRecord(local, 'push');
    for (const { remote } of diff.toPull) await pullRecord(remote, 'pull');
    for (const record of diff.toCreateRemote) await pushRecord(record, 'create_remote');
    for (const record of diff.toCreateLocal) await pullRecord(record, 'create_local');

    return counters;
  }

  /**
   * Run one media phase (core files, or owner-side entity→file links) against
   * the active media profile. Media participates in the same two-pass shape as
   * content: files are a referenced target in pass 1, links are written from
   * the owning entities in pass 2.
   *
   * Returns null when media is not configured — media is opt-in for content
   * runs and has its own tab/schedule for standalone execution.
   */
  async function runMediaPhase(mediaPhase, { scopeUids = [], direction } = {}) {
    const syncMedia = plugin().service('syncMedia');
    if (!syncMedia?.runProfilePhase) return null;

    const profile = await syncMedia.getActiveProfile();
    if (!profile || profile.strategy === 'disabled') return null;

    return syncMedia.runProfilePhase(profile.id, mediaPhase, { scopeUids, direction });
  }

  return {
    /**
     * Public wrapper for snapshot-based deletion reconciliation. Resolves the
     * remote config and runs a full-set delete pass for one content type.
     * Used by the bulk-transfer engine after a content type has finished
     * (its page loop cannot detect deletions on its own).
     */
    async reconcileDeletions(uid, { direction = 'both' } = {}) {
      const configService = plugin().service('config');
      const remoteConfig = await configService.getConfig({ safe: false });
      if (!remoteConfig || !remoteConfig.baseUrl) {
        throw new Error('Remote server not configured');
      }
      return reconcileDeletions(uid, { direction, remoteConfig });
    },

    /**
     * Manual / incremental sync for every enabled content type.
     *
     * Execution follows the strategy contract's GLOBAL two-pass ordering: pass 1
     * materializes entities for ALL selected content types (plus core media),
     * then pass 2 links relations for all of them (plus media links from the
     * owning entities). Running the passes globally — rather than both passes
     * per content type — is what makes cross-type relations resolvable: by the
     * time any link is written, every record it can point at already exists on
     * both sides.
     *
     * options:
     *   - includeMedia: also run the media phases inline (defaults to the
     *     `syncNowIncludesMedia` global execution setting)
     */
    async syncNow(options = {}) {
      const logService = plugin().service('syncLog');
      const configService = plugin().service('config');
      const syncConfigService = plugin().service('syncConfig');
      const syncProfilesService = plugin().service('syncProfiles');
      const dependencyResolver = plugin().service('dependencyResolver');
      const executionService = plugin().service('syncExecution');

      const remoteConfig = await configService.getConfig({ safe: false });
      if (!remoteConfig || !remoteConfig.baseUrl) {
        throw new Error('Remote server not configured');
      }

      const syncConfig = await syncConfigService.getSyncConfig();
      const enabledTypes = (syncConfig.contentTypes || []).filter((ct) => ct.enabled);

      // Dependency-aware ordering: targets before the types that reference them.
      // Owner-side, in-scope edges only, so a two-way relation pair can't look
      // like a cycle.
      const orderedUids = dependencyResolver.orderByDependencies(enabledTypes.map((ct) => ct.uid));
      const enabledTypesOrdered = orderedUids
        .map((uid) => enabledTypes.find((ct) => ct.uid === uid))
        .filter(Boolean);

      // Pagination — remote + local fetches are chunked to keep memory bounded
      // for large datasets. Page size is a global setting tunable in the Sync tab.
      const globalExec = (await executionService.getGlobalSettings?.()) || {};

      const syncStatsService = plugin().service('syncStats');
      const reportHandle = await syncStatsService.createRunReport({
        runType: 'sync_now',
        trigger: 'manual_sync_now',
        contentTypes: enabledTypesOrdered.map((ct) => ct.uid),
      });

      try {
        if (enabledTypes.length === 0) {
          throw new Error('No content types configured for sync');
        }

        const pageSize = Number(globalExec.syncPageSize) || 100;
        const includeMedia = options.includeMedia !== undefined
          ? !!options.includeMedia
          : !!globalExec.syncNowIncludesMedia;

        const timestamps = await getLastSyncTimestamps();
        const globalConflictStrategy = syncConfig.conflictStrategy || 'latest';
        const syncStartTime = new Date().toISOString();

        // ── Resolve every content type's plan up front ────────────────────
        // Each type keeps its own profile settings, but the PASS ordering is
        // global, so the plans are resolved once and then walked pass by pass.
        const plans = [];
        for (const ctConfig of enabledTypesOrdered) {
          const { uid, direction, fields } = ctConfig;
          try {
            const profile = await syncProfilesService.getActiveProfileForContentType(uid);
            const executionStrategy = resolveExecutionStrategy(profile?.executionStrategy);
            plans.push({
              uid,
              direction: direction || 'both',
              fields: fields || [],
              conflictStrategy: profile?.conflictStrategy || globalConflictStrategy,
              syncDeletions: !!profile?.syncDeletions,
              executionStrategy,
              phases: contentPhasesFor(executionStrategy),
              fieldPolicies: await syncProfilesService.getFieldPoliciesForContentType(uid),
              lastSyncAt: timestamps[uid] || null,
              pushed: 0,
              pulled: 0,
              errors: 0,
              unmatched: 0,
              failed: null,
            });
          } catch (err) {
            plans.push({ uid, failed: err.message, phases: [] });
          }
        }

        // ── Pass 1: entities (+ one-pass types) for EVERY content type ────
        for (const plan of plans) {
          if (plan.failed) continue;
          const phase = plan.phases[0]; // 'entities' (hybrid) or 'all' (one-pass)
          if (!phase) continue;
          try {
            const counters = await runPhaseForContentType({ ...plan, phase, remoteConfig, pageSize });
            plan.pushed += counters.pushed;
            plan.pulled += counters.pulled;
            plan.errors += counters.errors;
          } catch (err) {
            plan.failed = err.message;
            await maybeAlertAuthFailure(plan.uid, err);
            await logService.log({ action: 'sync_error', contentType: plan.uid, direction: plan.direction, status: 'error', message: `[${phase}] ${err.message}` });
          }
        }

        // Core media rides along with pass 1: files must exist before any
        // entity→file link is written in pass 2.
        let mediaCore = null;
        if (includeMedia) {
          try {
            mediaCore = await runMediaPhase(MEDIA_PHASE_CORE, { scopeUids: plans.map((p) => p.uid) });
          } catch (err) {
            await logService.log({ action: 'media_sync', contentType: 'plugin::upload.file', status: 'error', message: `[${MEDIA_PHASE_CORE}] ${err.message}` });
          }
        }

        // ── Pass 2: relations, owner side only, for EVERY content type ────
        for (const plan of plans) {
          if (plan.failed) continue;
          const phase = plan.phases[1];
          if (phase !== PHASE_RELATIONS) continue;
          if (!hasOwnerRelations(plan.uid, plan.fields)) continue;
          try {
            const counters = await runPhaseForContentType({ ...plan, phase, remoteConfig, pageSize });
            plan.pushed += counters.pushed;
            plan.pulled += counters.pulled;
            plan.errors += counters.errors;
            plan.unmatched += counters.unmatched;
          } catch (err) {
            plan.failed = err.message;
            await maybeAlertAuthFailure(plan.uid, err);
            await logService.log({ action: 'sync_error', contentType: plan.uid, direction: plan.direction, status: 'error', message: `[${phase}] ${err.message}` });
          }
        }

        // Media links close pass 2, written from the owning entities.
        let mediaLinks = null;
        if (includeMedia) {
          try {
            mediaLinks = await runMediaPhase(MEDIA_PHASE_LINKS, {
              scopeUids: plans.filter((p) => !p.failed).map((p) => p.uid),
            });
          } catch (err) {
            await logService.log({ action: 'media_sync', contentType: 'plugin::upload.file', status: 'error', message: `[${MEDIA_PHASE_LINKS}] ${err.message}` });
          }
        }

        // ── Deletion reconciliation + per-type reporting ──────────────────
        const results = [];
        for (const plan of plans) {
          if (plan.failed) {
            results.push({ uid: plan.uid, error: plan.failed });
            continue;
          }

          let deletions = null;
          if (plan.syncDeletions) {
            try {
              deletions = await reconcileDeletions(plan.uid, { direction: plan.direction, remoteConfig });
              plan.errors += deletions.errors;
            } catch (err) {
              plan.errors += 1;
              await logService.log({ action: 'sync_error', contentType: plan.uid, direction: plan.direction, status: 'error', message: `[deletions] ${err.message}` });
            }
          }

          await setLastSyncTimestamp(plan.uid, syncStartTime);

          const summary = {
            uid: plan.uid,
            pushed: plan.pushed,
            pulled: plan.pulled,
            errors: plan.errors,
            unmatchedRelations: plan.unmatched,
            hasFieldPolicies: !!plan.fieldPolicies,
            executionStrategy: plan.executionStrategy,
            deletions,
          };
          results.push(summary);

          await logService.log({
            action: 'sync_complete',
            contentType: plan.uid,
            direction: plan.direction,
            status: plan.errors > 0 ? 'partial' : 'success',
            message: `Pushed: ${plan.pushed}, Pulled: ${plan.pulled}, Errors: ${plan.errors}${plan.fieldPolicies ? ' (with field policies)' : ''} (${plan.executionStrategy})`,
            details: summary,
          });
        }

        const response = {
          syncedAt: new Date().toISOString(),
          strategy: 'global_two_pass',
          results,
          media: includeMedia ? { core: mediaCore, links: mediaLinks } : null,
        };
        await syncStatsService.completeRunReport(reportHandle.reportId, {
          status: 'success',
          summary: response,
        });
        await plugin().service('syncLog').applyRetention({ maxLogs: globalExec.maxLogEntries });
        await syncStatsService.applyRetention({ maxReports: globalExec.maxReportEntries });
        return response;
      } catch (err) {
        await syncStatsService.completeRunReport(reportHandle.reportId, {
          status: 'error',
          summary: null,
          error: err.message,
        });
        await plugin().service('syncLog').applyRetention({ maxLogs: globalExec.maxLogEntries });
        await syncStatsService.applyRetention({ maxReports: globalExec.maxReportEntries });
        throw err;
      }
    },

    /**
     * Sync a single content type using a given profile.
     * Called by the execution service (on-demand / scheduled / live runs).
     *
     * Runs the profile's own phases in order (entities → relations for the
     * default hybrid strategy). Cross-type ordering is the caller's job: the
     * execution service syncs in-scope dependencies first.
     *
     * options:
     *   - profile: sync profile { contentType, direction, conflictStrategy, isSimple, fieldPolicies }
     *   - phases: explicit phase list (used by callers driving the global passes)
     */
    async syncContentType(uid, options = {}) {
      if (!uid) {
        throw new Error('Content type uid is required');
      }

      const logService = plugin().service('syncLog');
      const configService = plugin().service('config');
      const syncConfigService = plugin().service('syncConfig');
      const syncProfilesService = plugin().service('syncProfiles');
      const executionService = plugin().service('syncExecution');

      const remoteConfig = await configService.getConfig({ safe: false });
      if (!remoteConfig || !remoteConfig.baseUrl) {
        throw new Error('Remote server not configured');
      }

      const { profile } = options;
      const syncConfig = await syncConfigService.getSyncConfig();
      const ctConfig = (syncConfig.contentTypes || []).find((ct) => ct.uid === uid) || { uid, fields: [] };

      const direction = profile?.direction || ctConfig.direction || 'both';
      const conflictStrategy = profile?.conflictStrategy || syncConfig.conflictStrategy || 'latest';
      const syncDeletions = !!(profile?.syncDeletions);
      const fields = ctConfig.fields || [];
      const executionStrategy = resolveExecutionStrategy(profile?.executionStrategy);
      const phases = Array.isArray(options.phases) && options.phases.length
        ? options.phases
        : contentPhasesFor(executionStrategy);

      // Field-level policies: prefer the policies on the provided profile,
      // otherwise fall back to the active profile for the content type.
      let fieldPolicies = null;
      if (profile) {
        if (!profile.isSimple && Array.isArray(profile.fieldPolicies) && profile.fieldPolicies.length > 0) {
          fieldPolicies = {};
          for (const fp of profile.fieldPolicies) {
            fieldPolicies[fp.field] = fp.direction;
          }
        }
      } else {
        fieldPolicies = await syncProfilesService.getFieldPoliciesForContentType(uid);
      }

      const globalExec = (await executionService.getGlobalSettings?.()) || {};
      const pageSize = Number(globalExec.syncPageSize) || 100;

      const timestamps = await getLastSyncTimestamps();
      const lastSyncAt = timestamps[uid] || null;
      const syncStartTime = new Date().toISOString();

      let pushed = 0;
      let pulled = 0;
      let errors = 0;
      let unmatched = 0;

      try {
        for (const phase of phases) {
          if (phase === PHASE_RELATIONS && !hasOwnerRelations(uid, fields)) continue;

          const counters = await runPhaseForContentType({
            uid,
            phase,
            direction,
            conflictStrategy,
            syncDeletions,
            fields,
            fieldPolicies,
            remoteConfig,
            pageSize,
            lastSyncAt,
          });

          pushed += counters.pushed;
          pulled += counters.pulled;
          errors += counters.errors;
          unmatched += counters.unmatched;
        }

        // A caller driving the global passes calls this once per pass. Deletion
        // reconciliation and the watermark belong to the FINAL pass only:
        // reconciling after pass 1 would delete records pass 2 still has to
        // link, and moving the watermark early would hide pass 2's input.
        const isFinalPass = phases.includes(PHASE_RELATIONS) || phases.includes(PHASE_ALL);

        let deletions = null;
        if (syncDeletions && isFinalPass) {
          deletions = await reconcileDeletions(uid, { direction, remoteConfig });
          errors += deletions.errors;
        }

        if (isFinalPass) {
          await setLastSyncTimestamp(uid, syncStartTime);
        }

        const summary = {
          uid,
          pushed,
          pulled,
          errors,
          unmatchedRelations: unmatched,
          hasFieldPolicies: !!fieldPolicies,
          executionStrategy,
          phases,
          deletions,
          profile: profile ? { id: profile.id, name: profile.name } : null,
        };

        await logService.log({
          action: 'sync_complete',
          contentType: uid,
          direction,
          status: errors > 0 ? 'partial' : 'success',
          message: `Pushed: ${pushed}, Pulled: ${pulled}, Errors: ${errors}${fieldPolicies ? ' (with field policies)' : ''} (${executionStrategy})`,
          details: summary,
        });

        return { syncedAt: new Date().toISOString(), ...summary };
      } catch (err) {
        await maybeAlertAuthFailure(uid, err);
        await logService.log({
          action: 'sync_error',
          contentType: uid,
          direction,
          status: 'error',
          message: err.message,
        });
        throw err;
      }
    },

    /**
     * Sync a SINGLE PAGE of a content type. Used by the bulk-transfer (Full
     * Sync) engine to process large content types page-by-page so that
     * progress can be reported and the job can be paused / resumed between
     * pages.
     *
     * options:
     *   - profile: synthetic/real profile (direction, conflictStrategy, syncDeletions)
     *   - phase: strategy phase for this chunk ('entities' | 'relations' | 'all')
     *   - page: 1-based page number (default 1)
     *   - pageSize: records per page (default from global settings or 100)
     *   - lastSyncAt: optional ISO timestamp; when omitted this runs a full
     *     page scan (preferred for bulk transfer). When provided it acts
     *     incremental.
     *
     * Returns:
     *   { uid, phase, page, pageSize, pushed, pulled, errors, unmatched, hasMore,
     *     localCount, remoteCount, remoteTotal, remotePageCount }
     */
    async syncContentTypePage(uid, options = {}) {
      if (!uid) throw new Error('Content type uid is required');

      const logService = plugin().service('syncLog');
      const configService = plugin().service('config');
      const syncConfigService = plugin().service('syncConfig');
      const syncProfilesService = plugin().service('syncProfiles');
      const executionService = plugin().service('syncExecution');

      const remoteConfig = await configService.getConfig({ safe: false });
      if (!remoteConfig || !remoteConfig.baseUrl) {
        throw new Error('Remote server not configured');
      }

      const { profile } = options;
      const syncConfig = await syncConfigService.getSyncConfig();
      const ctConfig = (syncConfig.contentTypes || []).find((ct) => ct.uid === uid) || { uid, fields: [] };

      const direction = profile?.direction || ctConfig.direction || 'both';
      const conflictStrategy = profile?.conflictStrategy || syncConfig.conflictStrategy || 'latest';
      const fields = ctConfig.fields || [];
      const phase = options.phase || PHASE_ALL;
      const phaseFields = selectFieldsForPhase(uid, fields, phase);

      let fieldPolicies = null;
      if (profile && !profile.isSimple && Array.isArray(profile.fieldPolicies) && profile.fieldPolicies.length > 0) {
        fieldPolicies = {};
        for (const fp of profile.fieldPolicies) fieldPolicies[fp.field] = fp.direction;
      } else if (!profile) {
        fieldPolicies = await syncProfilesService.getFieldPoliciesForContentType(uid);
      }

      const globalExec = (await executionService.getGlobalSettings?.()) || {};
      const pageSize = Number(options.pageSize) || Number(globalExec.syncPageSize) || 100;
      const page = Math.max(1, Number(options.page) || 1);
      const lastSyncAt = options.lastSyncAt || null;

      let pushed = 0;
      let pulled = 0;
      let errors = 0;

      const localPageRes = await fetchLocalPage(strapi, uid, { fields: phaseFields, lastSyncAt, page, pageSize });
      const remotePageRes = await fetchRemotePage(remoteConfig, uid, { fields: phaseFields, lastSyncAt, page, pageSize });

      const localRecords = localPageRes.records || [];
      const remoteRecords = remotePageRes.records || [];

      // NOTE: the comparator works on this page slice only — a record missing
      // from the page may simply live on another one, which is exactly why it
      // never infers deletions. Deletions are reconciled from the full
      // documentId snapshot once the content type has finished.
      const diff = compareRecords(localRecords, remoteRecords, {
        direction,
        conflictStrategy,
        phase,
      });

      const pushRecord = async (record, action) => {
        try {
          const filtered = syncProfilesService.filterFieldsByPolicy(record, fieldPolicies, 'push');
          await applyRemote(remoteConfig, uid, filtered, phaseFields);
          pushed++;
        } catch (err) {
          errors++;
          await logService.log({ action, contentType: uid, syncId: record.syncId || record.documentId, direction: 'push', status: 'error', message: `[${phase}] ${err.message}` });
        }
      };

      const pullRecord = async (record, action) => {
        try {
          const filtered = syncProfilesService.filterFieldsByPolicy(record, fieldPolicies, 'pull');
          await applyLocal(strapi, uid, filtered, phaseFields);
          pulled++;
        } catch (err) {
          errors++;
          await logService.log({ action, contentType: uid, syncId: record.syncId || record.documentId, direction: 'pull', status: 'error', message: `[${phase}] ${err.message}` });
        }
      };

      for (const { local } of diff.toPush) await pushRecord(local, 'push');
      for (const { remote } of diff.toPull) await pullRecord(remote, 'pull');
      for (const record of diff.toCreateRemote) await pushRecord(record, 'create_remote');
      for (const record of diff.toCreateLocal) await pullRecord(record, 'create_local');

      // hasMore is the OR of both sides so we keep paging until both are drained
      const hasMore = !!(localPageRes.hasMore || remotePageRes.hasMore);

      return {
        uid,
        phase,
        page,
        pageSize,
        pushed,
        pulled,
        errors,
        unmatched: diff.unmatched || 0,
        hasMore,
        localCount: localRecords.length,
        remoteCount: remoteRecords.length,
        remoteTotal: remotePageRes.total,
        remotePageCount: remotePageRes.pageCount,
      };
    },

    /**
     * Whether a content type declares owner-side relations, i.e. whether the
     * relations pass has anything to do for it. Used by the bulk-transfer
     * planner so it doesn't emit empty relation chunks.
     */
    hasOwnerRelations(uid, fields) {
      return hasOwnerRelations(uid, fields);
    },

    /**
     * Step 8 — Push a single record to the remote (called by lifecycle hooks).
     * Now supports field-level policies.
     */
    async pushRecord(uid, record) {
      const configService = plugin().service('config');
      const logService = plugin().service('syncLog');
      const syncProfilesService = plugin().service('syncProfiles');

      const remoteConfig = await configService.getConfig({ safe: false });
      if (!remoteConfig || !remoteConfig.baseUrl) return;

      const syncConfigService = plugin().service('syncConfig');
      const syncConfig = await syncConfigService.getSyncConfig();
      const ctConfig = (syncConfig.contentTypes || []).find(
        (ct) => ct.uid === uid && ct.enabled
      );

      if (!ctConfig) return;
      if (ctConfig.direction === 'pull') return;

      // Get field-level policies from active profile (if any)
      const fieldPolicies = await syncProfilesService.getFieldPoliciesForContentType(uid);
      const filteredRecord = syncProfilesService.filterFieldsByPolicy(record, fieldPolicies, 'push');

      try {
        await applyRemote(remoteConfig, uid, filteredRecord, ctConfig.fields);
        await logService.log({
          action: 'event_push',
          contentType: uid,
          syncId: record.syncId,
          direction: 'push',
          status: 'success',
          message: `Record ${record.syncId} pushed to remote${fieldPolicies ? ' (with field policies)' : ''}`,
        });
      } catch (err) {
        await logService.log({
          action: 'event_push',
          contentType: uid,
          syncId: record.syncId,
          direction: 'push',
          status: 'error',
          message: err.message,
        });
      }
    },

    /**
     * Step 9 — Receive a record pushed from a remote instance.
     * Now supports field-level policies.
     */
    async receiveRecord(uid, data, syncId, isDelete = false, documentId = null, published = undefined) {
      const logService = plugin().service('syncLog');
      const syncProfilesService = plugin().service('syncProfiles');

      const key = documentId || syncId;

      try {
        if (isDelete) {
          await deleteLocal(strapi, uid, { documentId, syncId });
          await logService.log({
            action: 'receive_delete',
            contentType: uid,
            syncId: key,
            direction: 'pull',
            status: 'success',
            message: `Delete received for ${key} from remote`,
          });
          return { success: true, deleted: true };
        }

        // Get field-level policies from active profile (if any)
        const fieldPolicies = await syncProfilesService.getFieldPoliciesForContentType(uid);
        const filteredData = syncProfilesService.filterFieldsByPolicy(data, fieldPolicies, 'pull');

        await applyLocal(strapi, uid, { ...filteredData, documentId, syncId }, [], { published });

        await logService.log({
          action: 'receive',
          contentType: uid,
          syncId: key,
          direction: 'pull',
          status: 'success',
          message: `Record ${key} received from remote${fieldPolicies ? ' (with field policies)' : ''}`,
        });

        return { success: true };
      } catch (err) {
        await logService.log({
          action: isDelete ? 'receive_delete' : 'receive',
          contentType: uid,
          syncId: key,
          direction: 'pull',
          status: 'error',
          message: err.message,
        });
        throw err;
      }
    },
  };
};
