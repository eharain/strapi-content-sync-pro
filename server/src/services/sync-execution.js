'use strict';

const STORE_KEY = 'sync-execution-settings';

/**
 * Sync Execution Service
 *
 * Manages WHEN and HOW sync profiles are executed:
 * - On-demand (manual trigger)
 * - Scheduled (interval / timeout / cron / external)
 * - Live (real-time via lifecycle hooks)
 *
 * Execution Settings Structure:
 * {
 *   profiles: {
 *     [profileId]: {
 *       executionMode: 'on_demand' | 'scheduled' | 'live',
 *       scheduleType: 'interval' | 'timeout' | 'cron' | 'external',
 *       scheduleInterval: number (minutes, used by interval/timeout),
 *       cronExpression: string (used by cron),
 *       lastExecutedAt: ISO string,
 *       nextExecutionAt: ISO string,
 *       enabled: boolean,
 *       syncDependencies: boolean,
 *       dependencyDepth: number (1-5)
 *     }
 *   },
 *   globalSettings: {
 *     maxConcurrentSyncs: number,
 *     retryOnFailure: boolean,
 *     retryAttempts: number,
 *     retryDelayMs: number
 *   }
 * }
 *
 * Scheduler Types
 * ---------------
 * - interval : Node setInterval. Lightweight, fires every N minutes from when it
 *              was started. Drifts slightly. Misses runs if the process is
 *              blocked. Best for small / frequent syncs.
 * - timeout  : Chained setTimeout. Re-computes its next run only after the
 *              previous run completes, so overlapping runs are impossible. Best
 *              when individual syncs can take a long time.
 * - cron     : Uses Strapi's built-in cron (node-schedule). Supports full cron
 *              expressions (e.g. "0 *\/2 * * *"). Persists the next-run wall-
 *              clock time and survives short pauses reliably. Recommended for
 *              larger datasets and production systems.
 * - external : The plugin registers NO in-process schedule. Instead, an
 *              external scheduler (systemd timer, Windows Task Scheduler,
 *              Kubernetes CronJob, GitHub Actions, cloud scheduler, ...) must
 *              POST /api/strapi-content-sync-pro/sync-execution/execute/:id
 *              to drive the run. Recommended for large datasets, multi-node
 *              deployments, and HA setups where you can't rely on a single
 *              Node process staying up.
 */
module.exports = ({ strapi }) => {
  function getStore() {
    return strapi.store({ type: 'plugin', name: 'strapi-content-sync-pro' });
  }

  function plugin() {
    return strapi.plugin('strapi-content-sync-pro');
  }

  const DEFAULT_GLOBAL_SETTINGS = {
    maxConcurrentSyncs: 3,
    retryOnFailure: true,
    retryAttempts: 3,
    retryDelayMs: 5000,
    maxLogEntries: 2000,
    maxReportEntries: 200,
    // Pagination for content-type sync fetches (local + remote). Larger pages
    // are faster but use more memory per chunk. 100 is a safe default.
    syncPageSize: 100,
  };

  const VALID_EXECUTION_MODES = ['on_demand', 'scheduled', 'live'];
  const VALID_SCHEDULE_TYPES = ['interval', 'timeout', 'cron', 'external'];

  async function getSyncMode() {
    const configService = plugin().service('config');
    const config = await configService.getConfig({ safe: false });
    return config?.syncMode || 'paired';
  }

  // Basic cron validator: 5 or 6 space-separated fields
  function isValidCronExpression(expr) {
    if (typeof expr !== 'string') return false;
    const parts = expr.trim().split(/\s+/);
    if (parts.length < 5 || parts.length > 6) return false;
    // very loose validator — detailed validation is done by node-schedule
    return parts.every((p) => /^[\d\*\/,\-\?LW#A-Za-z]+$/.test(p));
  }

  // In-memory scheduler state per profile
  //   { intervalId?, timeoutId?, cronKey? }
  const schedulerHandles = {};
  let liveHooksRegistered = false;

  // -- scheduler helpers -----------------------------------------------------

  function clearHandles(profileId) {
    const h = schedulerHandles[profileId];
    if (!h) return;
    if (h.intervalId) clearInterval(h.intervalId);
    if (h.timeoutId) clearTimeout(h.timeoutId);
    if (h.cronKey && strapi.cron && typeof strapi.cron.remove === 'function') {
      try { strapi.cron.remove(h.cronKey); } catch (_) { /* ignore */ }
    }
    delete schedulerHandles[profileId];
  }

  async function runSafely(profileId, runner) {
    try {
      await runner();
    } catch (error) {
      strapi.log.error(`[data-sync] Scheduled run failed for profile ${profileId}: ${error.message}`);
    }
  }


  return {
    /**
     * Get all execution settings
     */
    async getExecutionSettings() {
      const store = getStore();
      const data = await store.get({ key: STORE_KEY });
      return data || { profiles: {}, globalSettings: DEFAULT_GLOBAL_SETTINGS };
    },

    /**
     * Get execution settings for a specific profile
     */
    async getProfileExecutionSettings(profileId) {
      const settings = await this.getExecutionSettings();
      return settings.profiles[profileId] || {
        executionMode: 'on_demand',
        scheduleType: 'interval',
        scheduleInterval: 60,
        cronExpression: '0 * * * *',
        lastExecutedAt: null,
        nextExecutionAt: null,
        enabled: false,
        syncDependencies: false,
        dependencyDepth: 1,
      };
    },

    /**
     * Update execution settings for a profile
     */
    async setProfileExecutionSettings(profileId, executionSettings) {
      const store = getStore();
      const settings = await this.getExecutionSettings();

      // Validate execution mode
      if (executionSettings.executionMode && !VALID_EXECUTION_MODES.includes(executionSettings.executionMode)) {
        throw new Error(`Invalid execution mode "${executionSettings.executionMode}"`);
      }

      // Validate schedule type
      if (executionSettings.scheduleType && !VALID_SCHEDULE_TYPES.includes(executionSettings.scheduleType)) {
        throw new Error(`Invalid schedule type "${executionSettings.scheduleType}". Must be one of: ${VALID_SCHEDULE_TYPES.join(', ')}`);
      }

      const syncMode = await getSyncMode();
      if (syncMode === 'single_side' && executionSettings.executionMode === 'live') {
        throw new Error('Live execution mode is not available in single-side mode. Use on_demand or scheduled.');
      }

      // Validate schedule interval (used by interval & timeout types)
      if (executionSettings.scheduleInterval !== undefined) {
        if (executionSettings.scheduleInterval < 1 || executionSettings.scheduleInterval > 1440) {
          throw new Error('Schedule interval must be between 1 and 1440 minutes');
        }
      }

      // Validate cron expression when provided
      if (executionSettings.cronExpression !== undefined && executionSettings.cronExpression !== null && executionSettings.cronExpression !== '') {
        if (!isValidCronExpression(executionSettings.cronExpression)) {
          throw new Error('Invalid cron expression. Expected 5 or 6 space-separated fields (e.g. "0 */2 * * *")');
        }
      }

      // Validate dependency depth
      if (executionSettings.dependencyDepth !== undefined) {
        if (executionSettings.dependencyDepth < 1 || executionSettings.dependencyDepth > 5) {
          throw new Error('Dependency depth must be between 1 and 5');
        }
      }

      const current = settings.profiles[profileId] || {};
      const merged = {
        scheduleType: 'interval',
        scheduleInterval: 60,
        ...current,
        ...executionSettings,
        updatedAt: new Date().toISOString(),
      };

      if (syncMode === 'single_side' && merged.executionMode === 'live') {
        merged.executionMode = 'on_demand';
        merged.enabled = false;
      }
      settings.profiles[profileId] = merged;

      // Calculate an advisory nextExecutionAt for scheduled mode
      if (merged.executionMode === 'scheduled' && merged.enabled) {
        if (merged.scheduleType === 'interval' || merged.scheduleType === 'timeout') {
          const intervalMs = (merged.scheduleInterval || 60) * 60 * 1000;
          merged.nextExecutionAt = new Date(Date.now() + intervalMs).toISOString();
        } else if (merged.scheduleType === 'external') {
          merged.nextExecutionAt = null;
        }
        // cron: leave nextExecutionAt as-is; node-schedule owns the timing
      } else {
        merged.nextExecutionAt = null;
      }

      await store.set({ key: STORE_KEY, value: settings });

      // Update scheduler if needed
      await this.updateScheduler(profileId, settings.profiles[profileId]);

      return settings.profiles[profileId];
    },

    /**
     * Get global execution settings
     */
    async getGlobalSettings() {
      const settings = await this.getExecutionSettings();
      return settings.globalSettings || DEFAULT_GLOBAL_SETTINGS;
    },

    /**
     * Update global execution settings
     */
    async setGlobalSettings(globalSettings) {
      const store = getStore();
      const settings = await this.getExecutionSettings();

      const next = {
        ...settings.globalSettings,
        ...globalSettings,
      };

      if (next.maxLogEntries !== undefined && Number(next.maxLogEntries) < 100) {
        throw new Error('maxLogEntries must be at least 100');
      }
      if (next.maxReportEntries !== undefined && Number(next.maxReportEntries) < 10) {
        throw new Error('maxReportEntries must be at least 10');
      }

      settings.globalSettings = next;

      await store.set({ key: STORE_KEY, value: settings });
      return settings.globalSettings;
    },

    /**
     * Execute a profile on-demand
     */
    async executeProfile(profileId, options = {}) {
      const syncService = plugin().service('sync');
      const profilesService = plugin().service('syncProfiles');
      const dependencyResolver = plugin().service('dependencyResolver');
      const alertsService = plugin().service('alerts');
      const logService = plugin().service('syncLog');
      const syncStatsService = plugin().service('syncStats');

      const profile = await profilesService.getProfile(profileId);
      if (!profile) {
        throw new Error(`Profile with id "${profileId}" not found`);
      }

      const executionSettings = await this.getProfileExecutionSettings(profileId);
      const syncDependencies = options.syncDependencies ?? executionSettings.syncDependencies;
      const dependencyDepth = options.dependencyDepth ?? executionSettings.dependencyDepth ?? 1;

      const startTime = new Date();
      const reportHandle = await syncStatsService.createRunReport({
        runType: 'profile_execution',
        trigger: executionSettings.executionMode || 'on_demand',
        contentTypes: [profile.contentType],
      });

      try {
        // Log execution start
        await logService.log({
          action: 'execution_start',
          contentType: profile.contentType,
          direction: profile.direction,
          status: 'info',
          message: `Starting sync for profile: ${profile.name}`,
          details: { profileId, syncDependencies, dependencyDepth },
        });

        const dependencyResults = [];
        if (syncDependencies) {
          const dependencyOrder = dependencyResolver
            .getSyncOrder(profile.contentType, dependencyDepth)
            .filter((uid) => uid !== profile.contentType && uid.startsWith('api::') && !!strapi.contentTypes[uid]);

          for (const dependencyUid of dependencyOrder) {
            const syncConfigService = plugin().service('syncConfig');
            const syncConfig = await syncConfigService.getSyncConfig();
            const depEnabled = (syncConfig.contentTypes || []).some((ct) => ct.uid === dependencyUid && ct.enabled);
            if (!depEnabled) {
              dependencyResults.push({
                uid: dependencyUid,
                profile: null,
                skipped: true,
                reason: 'dependency content-type not enabled for sync',
              });
              continue;
            }

            const dependencyProfile = await profilesService.getActiveProfileForContentType(dependencyUid);
            const dependencyResult = await syncService.syncContentType(dependencyUid, {
              profile: dependencyProfile,
              syncDependencies: false,
              dependencyDepth: 1,
            });

            dependencyResults.push({
              uid: dependencyUid,
              profile: dependencyProfile ? { id: dependencyProfile.id, name: dependencyProfile.name } : null,
              result: dependencyResult,
            });
          }
        }

        // Execute sync
        const result = await syncService.syncContentType(profile.contentType, {
          profile,
          syncDependencies,
          dependencyDepth,
        });

        const fullResult = {
          ...result,
          dependencyResults,
        };

        // Update last execution time
        await this.updateLastExecution(profileId);

        await syncStatsService.completeRunReport(reportHandle.reportId, {
          status: 'success',
          summary: fullResult,
        });

        const globalSettings = await this.getGlobalSettings();
        await logService.applyRetention({ maxLogs: globalSettings.maxLogEntries });
        await syncStatsService.applyRetention({ maxReports: globalSettings.maxReportEntries });

        // Send success alert
        await alertsService.sendAlert('sync_success', {
          profile: profile.name,
          contentType: profile.contentType,
          result: fullResult,
          duration: Date.now() - startTime.getTime(),
        });

        return fullResult;
      } catch (error) {
        await syncStatsService.completeRunReport(reportHandle.reportId, {
          status: 'error',
          summary: null,
          error: error.message,
        });

        // Send failure alert
        await alertsService.sendAlert('sync_failure', {
          profile: profile.name,
          contentType: profile.contentType,
          error: error.message,
          duration: Date.now() - startTime.getTime(),
        });

        throw error;
      }
    },

    /**
     * Execute multiple profiles
     */
    async executeProfiles(profileIds, options = {}) {
      const globalSettings = await this.getGlobalSettings();
      const results = [];
      const errors = [];

      // Simple sequential execution (can be enhanced with concurrency control)
      for (const profileId of profileIds) {
        try {
          const result = await this.executeProfile(profileId, options);
          results.push({ profileId, success: true, result });
        } catch (error) {
          errors.push({ profileId, success: false, error: error.message });

          if (!globalSettings.retryOnFailure) continue;

          // Retry logic
          for (let attempt = 1; attempt <= globalSettings.retryAttempts; attempt++) {
            await new Promise(resolve => setTimeout(resolve, globalSettings.retryDelayMs));
            try {
              const result = await this.executeProfile(profileId, options);
              results.push({ profileId, success: true, result, retryAttempt: attempt });
              break;
            } catch (retryError) {
              if (attempt === globalSettings.retryAttempts) {
                errors.push({ profileId, success: false, error: retryError.message, finalFailure: true });
              }
            }
          }
        }
      }

      return { results, errors };
    },

    /**
     * Execute all active profiles for a content type
     */
    async executeContentType(contentTypeUid, options = {}) {
      const profilesService = plugin().service('syncProfiles');
      const profile = await profilesService.getActiveProfileForContentType(contentTypeUid);

      if (!profile) {
        throw new Error(`No active profile for content type "${contentTypeUid}"`);
      }

      return this.executeProfile(profile.id, options);
    },

    /**
     * Update last execution timestamp
     */
    async updateLastExecution(profileId) {
      const store = getStore();
      const settings = await this.getExecutionSettings();

      if (settings.profiles[profileId]) {
        const prof = settings.profiles[profileId];
        prof.lastExecutedAt = new Date().toISOString();

        // Only refresh nextExecutionAt for interval/timeout schedules; cron/external
        // advance their own next run externally.
        if (
          prof.executionMode === 'scheduled' &&
          prof.enabled &&
          (prof.scheduleType === 'interval' || prof.scheduleType === 'timeout' || !prof.scheduleType)
        ) {
          const intervalMs = (prof.scheduleInterval || 60) * 60 * 1000;
          prof.nextExecutionAt = new Date(Date.now() + intervalMs).toISOString();
        }

        await store.set({ key: STORE_KEY, value: settings });
      }
    },

    /**
     * Update scheduler for a profile (start/stop scheduled execution).
     * Dispatches to one of four scheduler types based on executionSettings.scheduleType.
     */
    async updateScheduler(profileId, executionSettings) {
      // Always clear any existing handles for this profile
      clearHandles(profileId);

      if (!(executionSettings.executionMode === 'scheduled' && executionSettings.enabled)) {
        // Still handle live mode registration
        if (executionSettings.executionMode === 'live' && executionSettings.enabled) {
          await this.registerLiveHooks();
        }
        return;
      }

      const scheduleType = executionSettings.scheduleType || 'interval';
      const intervalMinutes = executionSettings.scheduleInterval || 60;
      const intervalMs = intervalMinutes * 60 * 1000;
      const self = this;

      switch (scheduleType) {
        case 'interval': {
          const id = setInterval(() => {
            runSafely(profileId, () => self.executeProfile(profileId));
          }, intervalMs);
          schedulerHandles[profileId] = { intervalId: id };
          strapi.log.info(`[data-sync] interval scheduler enabled for profile ${profileId}: every ${intervalMinutes} min`);
          break;
        }

        case 'timeout': {
          // Chained timeout: schedule next run only AFTER previous completes.
          // Prevents overlap for long-running syncs.
          const scheduleNext = () => {
            const tid = setTimeout(async () => {
              await runSafely(profileId, () => self.executeProfile(profileId));
              // Re-schedule only if this profile is still active and in timeout mode
              const latest = await self.getProfileExecutionSettings(profileId);
              if (
                latest.executionMode === 'scheduled' &&
                latest.enabled &&
                latest.scheduleType === 'timeout' &&
                schedulerHandles[profileId] // not cleared in between
              ) {
                scheduleNext();
              }
            }, intervalMs);
            schedulerHandles[profileId] = { timeoutId: tid };
          };
          scheduleNext();
          strapi.log.info(`[data-sync] timeout (chained) scheduler enabled for profile ${profileId}: ~${intervalMinutes} min between runs`);
          break;
        }

        case 'cron': {
          const expr = executionSettings.cronExpression;
          if (!expr || !isValidCronExpression(expr)) {
            strapi.log.error(`[data-sync] Cron scheduler NOT started for profile ${profileId}: invalid or missing cronExpression`);
            return;
          }
          if (!strapi.cron || typeof strapi.cron.add !== 'function') {
            strapi.log.error(`[data-sync] strapi.cron is not available; cannot start cron scheduler for profile ${profileId}`);
            return;
          }
          const cronKey = `data-sync:profile:${profileId}`;
          try {
            strapi.cron.add({
              [cronKey]: {
                task: async () => {
                  await runSafely(profileId, () => self.executeProfile(profileId));
                },
                options: { rule: expr },
              },
            });
            schedulerHandles[profileId] = { cronKey };
            strapi.log.info(`[data-sync] cron scheduler enabled for profile ${profileId}: "${expr}"`);
          } catch (err) {
            strapi.log.error(`[data-sync] Failed to register cron for profile ${profileId}: ${err.message}`);
          }
          break;
        }

        case 'external': {
          // No in-process scheduler. The user will invoke the execute endpoint
          // from an external scheduler (systemd, Windows Task Scheduler, k8s,
          // cloud scheduler, CI, etc.). Mark the handles so getExecutionStatus
          // can report this distinctly.
          schedulerHandles[profileId] = { external: true };
          strapi.log.info(`[data-sync] external scheduler selected for profile ${profileId}: no in-process timer will run`);
          break;
        }

        default:
          strapi.log.warn(`[data-sync] Unknown scheduleType "${scheduleType}" for profile ${profileId}`);
      }
    },

    /**
     * Register lifecycle hooks for live sync
     */
    async registerLiveHooks() {
      if (liveHooksRegistered) return;

      // Note: Lifecycle hooks should be registered during bootstrap
      // This is a placeholder - actual implementation requires Strapi lifecycle API
      strapi.log.info('Live sync hooks registration requested (requires bootstrap setup)');
      liveHooksRegistered = true;
    },

    /**
     * Initialize all scheduled syncs on startup
     */
    async initializeSchedulers() {
      const settings = await this.getExecutionSettings();

      for (const [profileId, execSettings] of Object.entries(settings.profiles)) {
        if (
          (execSettings.executionMode === 'scheduled' && execSettings.enabled) ||
          (execSettings.executionMode === 'live' && execSettings.enabled)
        ) {
          await this.updateScheduler(profileId, execSettings);
        }
      }
    },

    /**
     * Stop all schedulers (for shutdown)
     */
    stopAllSchedulers() {
      for (const profileId of Object.keys(schedulerHandles)) {
        clearHandles(profileId);
      }
    },

    /**
     * Get execution status for all profiles
     */
    async getExecutionStatus() {
      const settings = await this.getExecutionSettings();
      const profilesService = plugin().service('syncProfiles');
      const profiles = await profilesService.getProfiles();

      const syncMode = await getSyncMode();
      const status = [];
      for (const profile of profiles) {
        const execSettings = settings.profiles[profile.id] || {};
        const handle = schedulerHandles[profile.id];
        const executionMode = syncMode === 'single_side' && execSettings.executionMode === 'live'
          ? 'on_demand'
          : (execSettings.executionMode || 'on_demand');

        status.push({
          profileId: profile.id,
          profileName: profile.name,
          contentType: profile.contentType,
          executionMode,
          scheduleType: execSettings.scheduleType || null,
          scheduleInterval: execSettings.scheduleInterval || null,
          cronExpression: execSettings.cronExpression || null,
          enabled: syncMode === 'single_side' && execSettings.executionMode === 'live'
            ? false
            : (execSettings.enabled || false),
          lastExecutedAt: execSettings.lastExecutedAt || null,
          nextExecutionAt: execSettings.nextExecutionAt || null,
          isSchedulerRunning: !!handle && !handle.external,
          isExternal: !!(handle && handle.external),
          syncMode,
        });
      }

      return status;
    },
  };
};
