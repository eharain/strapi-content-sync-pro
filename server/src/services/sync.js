'use strict';

const { fetchLocalRecords, fetchRemoteRecords, fetchLocalPage, fetchRemotePage, fetchAllLocalIds, fetchAllRemoteIds } = require('../utils/fetcher');
const { compareRecords } = require('../utils/comparator');
const { applyLocal, applyRemote, deleteLocal, deleteRemote } = require('../utils/applier');

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

  function selectFieldsForPhase(uid, configuredFields, phase = 'all') {
    const configured = Array.isArray(configuredFields) ? configuredFields : [];
    if (!uid) return configured;
    if (phase === 'all') return configured; // one_pass: [] means "all fields"

    const ownerRelationFields = getOwnerRelationFieldSet(uid, configured);

    if (phase === 'relations') {
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
     * Step 6 + 7 + 10 — Execute a manual / incremental sync for every
     * enabled content type.
     *
     * Now supports field-level policies from Sync Profiles.
     */
    async syncNow() {
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

      // Reorder enabled types so dependency targets are processed before
      // dependents. This improves relation consistency during full sync.
      const enabledSet = new Set(enabledTypes.map((ct) => ct.uid));
      const inDegree = new Map();
      const adjacency = new Map();
      enabledTypes.forEach((ct) => {
        inDegree.set(ct.uid, 0);
        adjacency.set(ct.uid, []);
      });
      for (const ct of enabledTypes) {
        try {
          const rels = dependencyResolver.analyzeContentType(ct.uid)?.relations || [];
          for (const rel of rels) {
            const depUid = rel.target;
            if (!enabledSet.has(depUid) || depUid === ct.uid) continue;
            adjacency.get(depUid).push(ct.uid);
            inDegree.set(ct.uid, (inDegree.get(ct.uid) || 0) + 1);
          }
        } catch (_) {
          // Ignore schema parse failures and keep original order fallback.
        }
      }
      const queue = enabledTypes.map((ct) => ct.uid).filter((uid) => (inDegree.get(uid) || 0) === 0);
      const orderedUids = [];
      while (queue.length > 0) {
        const uid = queue.shift();
        orderedUids.push(uid);
        for (const next of adjacency.get(uid) || []) {
          const deg = (inDegree.get(next) || 0) - 1;
          inDegree.set(next, deg);
          if (deg === 0) queue.push(next);
        }
      }
      // Cycle fallback: append any remaining in original order.
      for (const ct of enabledTypes) {
        if (!orderedUids.includes(ct.uid)) orderedUids.push(ct.uid);
      }
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

        const timestamps = await getLastSyncTimestamps();
        const conflictStrategy = syncConfig.conflictStrategy || 'latest';
        const results = [];

        for (const ctConfig of enabledTypesOrdered) {
          const { uid, direction, fields } = ctConfig;
          const lastSyncAt = timestamps[uid] || null;
          const syncStartTime = new Date().toISOString();

          // Get field-level policies from active profile (if any)
          const fieldPolicies = await syncProfilesService.getFieldPoliciesForContentType(uid);

          try {
            const profileForOptions = await syncProfilesService.getActiveProfileForContentType(uid);
            const syncDeletions = !!(profileForOptions?.syncDeletions);
            const executionStrategy = profileForOptions?.executionStrategy || 'hybrid_two_pass';
            const phases = executionStrategy === 'one_pass' ? ['all'] : ['entities', 'relations'];

            let pushed = 0;
            let pulled = 0;
            let errors = 0;

            for (const phase of phases) {
              const phaseFields = selectFieldsForPhase(uid, fields, phase);

              // Both sides are fetched in pages of `pageSize` records under the
              // hood (see utils/fetcher.js). We aggregate per content-type because
              // the comparator needs the full set to diff by syncId, but each
              // network/DB call still only returns a bounded chunk.
              const localRecords = await fetchLocalRecords(strapi, uid, { fields: phaseFields, lastSyncAt, pageSize });
              const remoteRecords = await fetchRemoteRecords(remoteConfig, uid, { fields: phaseFields, lastSyncAt, pageSize });

              const diff = compareRecords(localRecords, remoteRecords, {
                direction,
                conflictStrategy,
                syncDeletions: false, // deletions handled by reconcileDeletions
              });

              // Apply field policies to records before pushing/pulling
              for (const { local } of diff.toPush) {
                try {
                  const filteredRecord = syncProfilesService.filterFieldsByPolicy(local, fieldPolicies, 'push');
                  await applyRemote(remoteConfig, uid, filteredRecord, phaseFields);
                  pushed++;
                } catch (err) {
                  errors++;
                  await logService.log({ action: 'push', contentType: uid, syncId: local.syncId, direction: 'push', status: 'error', message: err.message });
                }
              }

              for (const { remote } of diff.toPull) {
                try {
                  const filteredRecord = syncProfilesService.filterFieldsByPolicy(remote, fieldPolicies, 'pull');
                  await applyLocal(strapi, uid, filteredRecord, phaseFields);
                  pulled++;
                } catch (err) {
                  errors++;
                  await logService.log({ action: 'pull', contentType: uid, syncId: remote.syncId, direction: 'pull', status: 'error', message: err.message });
                }
              }

              for (const record of diff.toCreateRemote) {
                try {
                  const filteredRecord = syncProfilesService.filterFieldsByPolicy(record, fieldPolicies, 'push');
                  await applyRemote(remoteConfig, uid, filteredRecord, phaseFields);
                  pushed++;
                } catch (err) {
                  errors++;
                  await logService.log({ action: 'create_remote', contentType: uid, syncId: record.syncId, direction: 'push', status: 'error', message: err.message });
                }
              }

              for (const record of diff.toCreateLocal) {
                try {
                  const filteredRecord = syncProfilesService.filterFieldsByPolicy(record, fieldPolicies, 'pull');
                  await applyLocal(strapi, uid, filteredRecord, phaseFields);
                  pulled++;
                } catch (err) {
                  errors++;
                  await logService.log({ action: 'create_local', contentType: uid, syncId: record.syncId, direction: 'pull', status: 'error', message: err.message });
                }
              }

              // Deletion handling only in non-relations phase
              if (phase !== 'relations') {
                for (const record of diff.toDeleteRemote) {
                  try {
                    await deleteRemote(remoteConfig, uid, record);
                    await logService.log({ action: 'delete_remote', contentType: uid, syncId: record.syncId, direction: 'push', status: 'success', message: `Deleted remote record ${record.syncId}` });
                  } catch (err) {
                    errors++;
                    await logService.log({ action: 'delete_remote', contentType: uid, syncId: record.syncId, direction: 'push', status: 'error', message: err.message });
                  }
                }

                for (const record of diff.toDeleteLocal) {
                  try {
                    await deleteLocal(strapi, uid, record);
                    await logService.log({ action: 'delete_local', contentType: uid, syncId: record.syncId, direction: 'pull', status: 'success', message: `Deleted local record ${record.syncId}` });
                  } catch (err) {
                    errors++;
                    await logService.log({ action: 'delete_local', contentType: uid, syncId: record.syncId, direction: 'pull', status: 'error', message: err.message });
                  }
                }
              }
            }

            let deletions = null;
            if (syncDeletions) {
              deletions = await reconcileDeletions(uid, { direction, remoteConfig });
              errors += deletions.errors;
            }

            await setLastSyncTimestamp(uid, syncStartTime);

            const summary = { uid, pushed, pulled, errors, hasFieldPolicies: !!fieldPolicies, executionStrategy, deletions };
            results.push(summary);

            await logService.log({
              action: 'sync_complete',
              contentType: uid,
              direction,
              status: errors > 0 ? 'partial' : 'success',
              message: `Pushed: ${pushed}, Pulled: ${pulled}, Errors: ${errors}${fieldPolicies ? ' (with field policies)' : ''}${executionStrategy === 'hybrid_two_pass' ? ' (hybrid two-pass)' : ''}`,
              details: summary,
            });
          } catch (err) {
            results.push({ uid, error: err.message });
            await maybeAlertAuthFailure(uid, err);
            await logService.log({
              action: 'sync_error',
              contentType: uid,
              direction,
              status: 'error',
              message: err.message,
            });
          }
        }

        const response = { syncedAt: new Date().toISOString(), results };
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
     * options:
     *   - profile: sync profile { contentType, direction, conflictStrategy, isSimple, fieldPolicies }
     *   - syncDependencies: boolean (currently informational; dependency resolution handled upstream)
     *   - dependencyDepth: number
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
      const executionStrategy = profile?.executionStrategy || 'hybrid_two_pass';
      const phases = executionStrategy === 'one_pass' ? ['all'] : ['entities', 'relations'];

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

      try {
        for (const phase of phases) {
          const phaseFields = selectFieldsForPhase(uid, fields, phase);
          const localRecords = await fetchLocalRecords(strapi, uid, { fields: phaseFields, lastSyncAt, pageSize });
          const remoteRecords = await fetchRemoteRecords(remoteConfig, uid, { fields: phaseFields, lastSyncAt, pageSize });

          const diff = compareRecords(localRecords, remoteRecords, {
            direction,
            conflictStrategy,
            syncDeletions: phase === 'relations' ? false : syncDeletions,
          });

          for (const { local } of diff.toPush) {
            try {
              const filteredRecord = syncProfilesService.filterFieldsByPolicy(local, fieldPolicies, 'push');
              await applyRemote(remoteConfig, uid, filteredRecord, phaseFields);
              pushed++;
            } catch (err) {
              errors++;
              await logService.log({ action: 'push', contentType: uid, syncId: local.syncId, direction: 'push', status: 'error', message: err.message });
            }
          }

          for (const { remote } of diff.toPull) {
            try {
              const filteredRecord = syncProfilesService.filterFieldsByPolicy(remote, fieldPolicies, 'pull');
              await applyLocal(strapi, uid, filteredRecord, phaseFields);
              pulled++;
            } catch (err) {
              errors++;
              await logService.log({ action: 'pull', contentType: uid, syncId: remote.syncId, direction: 'pull', status: 'error', message: err.message });
            }
          }

          for (const record of diff.toCreateRemote) {
            try {
              const filteredRecord = syncProfilesService.filterFieldsByPolicy(record, fieldPolicies, 'push');
              await applyRemote(remoteConfig, uid, filteredRecord, phaseFields);
              pushed++;
            } catch (err) {
              errors++;
              await logService.log({ action: 'create_remote', contentType: uid, syncId: record.syncId, direction: 'push', status: 'error', message: err.message });
            }
          }

          for (const record of diff.toCreateLocal) {
            try {
              const filteredRecord = syncProfilesService.filterFieldsByPolicy(record, fieldPolicies, 'pull');
              await applyLocal(strapi, uid, filteredRecord, phaseFields);
              pulled++;
            } catch (err) {
              errors++;
              await logService.log({ action: 'create_local', contentType: uid, syncId: record.syncId, direction: 'pull', status: 'error', message: err.message });
            }
          }

          if (phase !== 'relations') {
            for (const record of diff.toDeleteRemote) {
              try {
                await deleteRemote(remoteConfig, uid, record);
                await logService.log({ action: 'delete_remote', contentType: uid, syncId: record.syncId, direction: 'push', status: 'success', message: `Deleted remote record ${record.syncId}` });
              } catch (err) {
                errors++;
                await logService.log({ action: 'delete_remote', contentType: uid, syncId: record.syncId, direction: 'push', status: 'error', message: err.message });
              }
            }

            for (const record of diff.toDeleteLocal) {
              try {
                await deleteLocal(strapi, uid, record);
                await logService.log({ action: 'delete_local', contentType: uid, syncId: record.syncId, direction: 'pull', status: 'success', message: `Deleted local record ${record.syncId}` });
              } catch (err) {
                errors++;
                await logService.log({ action: 'delete_local', contentType: uid, syncId: record.syncId, direction: 'pull', status: 'error', message: err.message });
              }
            }
          }
        }

        let deletions = null;
        if (syncDeletions) {
          deletions = await reconcileDeletions(uid, { direction, remoteConfig });
          errors += deletions.errors;
        }

        await setLastSyncTimestamp(uid, syncStartTime);

        const summary = {
          uid,
          pushed,
          pulled,
          errors,
          hasFieldPolicies: !!fieldPolicies,
          executionStrategy,
          deletions,
          profile: profile ? { id: profile.id, name: profile.name } : null,
        };

        await logService.log({
          action: 'sync_complete',
          contentType: uid,
          direction,
          status: errors > 0 ? 'partial' : 'success',
          message: `Pushed: ${pushed}, Pulled: ${pulled}, Errors: ${errors}${fieldPolicies ? ' (with field policies)' : ''}${executionStrategy === 'hybrid_two_pass' ? ' (hybrid two-pass)' : ''}`,
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
     *   - page: 1-based page number (default 1)
     *   - pageSize: records per page (default from global settings or 100)
     *   - lastSyncAt: optional ISO timestamp; when omitted this runs a full
     *     page scan (preferred for bulk transfer). When provided it acts
     *     incremental.
     *
     * Returns:
     *   { uid, page, pageSize, pushed, pulled, errors, hasMore,
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
      const syncDeletions = !!(profile?.syncDeletions);
      const fields = ctConfig.fields || [];
      const phase = options.phase || 'all';
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

      // NOTE: comparator works on the page slice only. Cross-side deletion
      // detection is intentionally disabled here because a record missing
      // from this page may live on another page; full-set deletion sync
      // should use the incremental path instead.
      const diff = compareRecords(localRecords, remoteRecords, {
        direction,
        conflictStrategy,
        syncDeletions: false,
      });

      for (const { local } of diff.toPush) {
        try {
          const filtered = syncProfilesService.filterFieldsByPolicy(local, fieldPolicies, 'push');
          await applyRemote(remoteConfig, uid, filtered, phaseFields);
          pushed++;
        } catch (err) {
          errors++;
          await logService.log({ action: 'push', contentType: uid, syncId: local.syncId, direction: 'push', status: 'error', message: err.message });
        }
      }

      for (const { remote } of diff.toPull) {
        try {
          const filtered = syncProfilesService.filterFieldsByPolicy(remote, fieldPolicies, 'pull');
          await applyLocal(strapi, uid, filtered, phaseFields);
          pulled++;
        } catch (err) {
          errors++;
          await logService.log({ action: 'pull', contentType: uid, syncId: remote.syncId, direction: 'pull', status: 'error', message: err.message });
        }
      }

      for (const record of diff.toCreateRemote) {
        try {
          const filtered = syncProfilesService.filterFieldsByPolicy(record, fieldPolicies, 'push');
          await applyRemote(remoteConfig, uid, filtered, phaseFields);
          pushed++;
        } catch (err) {
          errors++;
          await logService.log({ action: 'create_remote', contentType: uid, syncId: record.syncId, direction: 'push', status: 'error', message: err.message });
        }
      }

      for (const record of diff.toCreateLocal) {
        try {
          const filtered = syncProfilesService.filterFieldsByPolicy(record, fieldPolicies, 'pull');
          await applyLocal(strapi, uid, filtered, phaseFields);
          pulled++;
        } catch (err) {
          errors++;
          await logService.log({ action: 'create_local', contentType: uid, syncId: record.syncId, direction: 'pull', status: 'error', message: err.message });
        }
      }

      // hasMore is the OR of both sides so we keep paging until both are drained
      const hasMore = !!(localPageRes.hasMore || remotePageRes.hasMore);

      return {
        uid,
        page,
        pageSize,
        pushed,
        pulled,
        errors,
        hasMore,
        localCount: localRecords.length,
        remoteCount: remoteRecords.length,
        remoteTotal: remotePageRes.total,
        remotePageCount: remotePageRes.pageCount,
      };
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
