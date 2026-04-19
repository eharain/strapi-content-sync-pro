'use strict';

const STORE_KEY = 'sync-execution-settings';

/**
 * Sync Execution Service
 * 
 * Manages WHEN and HOW sync profiles are executed:
 * - On-demand (manual trigger)
 * - Scheduled (cron-based intervals)
 * - Live (real-time via lifecycle hooks)
 * 
 * Execution Settings Structure:
 * {
 *   profiles: {
 *     [profileId]: {
 *       executionMode: 'on_demand' | 'scheduled' | 'live',
 *       scheduleInterval: number (minutes),
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
 */
module.exports = ({ strapi }) => {
  function getStore() {
    return strapi.store({ type: 'plugin', name: 'strapi-to-strapi-data-sync' });
  }

  function plugin() {
    return strapi.plugin('strapi-to-strapi-data-sync');
  }

  const DEFAULT_GLOBAL_SETTINGS = {
    maxConcurrentSyncs: 3,
    retryOnFailure: true,
    retryAttempts: 3,
    retryDelayMs: 5000,
  };

  const VALID_EXECUTION_MODES = ['on_demand', 'scheduled', 'live'];

  // In-memory scheduler state
  let schedulerIntervals = {};
  let liveHooksRegistered = false;

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
        scheduleInterval: 60,
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

      // Validate schedule interval
      if (executionSettings.scheduleInterval !== undefined) {
        if (executionSettings.scheduleInterval < 1 || executionSettings.scheduleInterval > 1440) {
          throw new Error('Schedule interval must be between 1 and 1440 minutes');
        }
      }

      // Validate dependency depth
      if (executionSettings.dependencyDepth !== undefined) {
        if (executionSettings.dependencyDepth < 1 || executionSettings.dependencyDepth > 5) {
          throw new Error('Dependency depth must be between 1 and 5');
        }
      }

      const current = settings.profiles[profileId] || {};
      settings.profiles[profileId] = {
        ...current,
        ...executionSettings,
        updatedAt: new Date().toISOString(),
      };

      // Calculate next execution time for scheduled mode
      if (settings.profiles[profileId].executionMode === 'scheduled' && settings.profiles[profileId].enabled) {
        const intervalMs = settings.profiles[profileId].scheduleInterval * 60 * 1000;
        settings.profiles[profileId].nextExecutionAt = new Date(Date.now() + intervalMs).toISOString();
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

      settings.globalSettings = {
        ...settings.globalSettings,
        ...globalSettings,
      };

      await store.set({ key: STORE_KEY, value: settings });
      return settings.globalSettings;
    },

    /**
     * Execute a profile on-demand
     */
    async executeProfile(profileId, options = {}) {
      const syncService = plugin().service('sync');
      const profilesService = plugin().service('syncProfiles');
      const alertsService = plugin().service('alerts');
      const logService = plugin().service('syncLog');

      const profile = await profilesService.getProfile(profileId);
      if (!profile) {
        throw new Error(`Profile with id "${profileId}" not found`);
      }

      const executionSettings = await this.getProfileExecutionSettings(profileId);
      const syncDependencies = options.syncDependencies ?? executionSettings.syncDependencies;
      const dependencyDepth = options.dependencyDepth ?? executionSettings.dependencyDepth ?? 1;

      const startTime = new Date();

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

        // Execute sync
        const result = await syncService.syncContentType(profile.contentType, {
          profile,
          syncDependencies,
          dependencyDepth,
        });

        // Update last execution time
        await this.updateLastExecution(profileId);

        // Send success alert
        await alertsService.sendAlert('sync_success', {
          profile: profile.name,
          contentType: profile.contentType,
          result,
          duration: Date.now() - startTime.getTime(),
        });

        return result;
      } catch (error) {
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
        settings.profiles[profileId].lastExecutedAt = new Date().toISOString();

        // Calculate next execution for scheduled mode
        if (settings.profiles[profileId].executionMode === 'scheduled' && settings.profiles[profileId].enabled) {
          const intervalMs = settings.profiles[profileId].scheduleInterval * 60 * 1000;
          settings.profiles[profileId].nextExecutionAt = new Date(Date.now() + intervalMs).toISOString();
        }

        await store.set({ key: STORE_KEY, value: settings });
      }
    },

    /**
     * Update scheduler for a profile (start/stop scheduled execution)
     */
    async updateScheduler(profileId, executionSettings) {
      // Clear existing interval if any
      if (schedulerIntervals[profileId]) {
        clearInterval(schedulerIntervals[profileId]);
        delete schedulerIntervals[profileId];
      }

      // Start new interval if scheduled and enabled
      if (executionSettings.executionMode === 'scheduled' && executionSettings.enabled) {
        const intervalMs = executionSettings.scheduleInterval * 60 * 1000;
        schedulerIntervals[profileId] = setInterval(async () => {
          try {
            await this.executeProfile(profileId);
          } catch (error) {
            strapi.log.error(`Scheduled sync failed for profile ${profileId}: ${error.message}`);
          }
        }, intervalMs);

        strapi.log.info(`Scheduled sync enabled for profile ${profileId}: every ${executionSettings.scheduleInterval} minutes`);
      }

      // Handle live mode
      if (executionSettings.executionMode === 'live' && executionSettings.enabled) {
        await this.registerLiveHooks();
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
        if (execSettings.executionMode === 'scheduled' && execSettings.enabled) {
          await this.updateScheduler(profileId, execSettings);
        }
      }
    },

    /**
     * Stop all schedulers (for shutdown)
     */
    stopAllSchedulers() {
      for (const intervalId of Object.values(schedulerIntervals)) {
        clearInterval(intervalId);
      }
      schedulerIntervals = {};
    },

    /**
     * Get execution status for all profiles
     */
    async getExecutionStatus() {
      const settings = await this.getExecutionSettings();
      const profilesService = plugin().service('syncProfiles');
      const profiles = await profilesService.getProfiles();

      const status = [];
      for (const profile of profiles) {
        const execSettings = settings.profiles[profile.id] || {};
        status.push({
          profileId: profile.id,
          profileName: profile.name,
          contentType: profile.contentType,
          executionMode: execSettings.executionMode || 'on_demand',
          enabled: execSettings.enabled || false,
          lastExecutedAt: execSettings.lastExecutedAt || null,
          nextExecutionAt: execSettings.nextExecutionAt || null,
          isSchedulerRunning: !!schedulerIntervals[profile.id],
        });
      }

      return status;
    },
  };
};
