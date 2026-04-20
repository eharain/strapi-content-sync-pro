'use strict';

const STORE_KEY = 'sync-enforcement-settings';

/**
 * Sync Enforcement Service
 * 
 * Enforces sync compatibility checks before execution:
 * - Schema match: Verify content type schemas are compatible
 * - Version check: Ensure Strapi versions are compatible
 * - DateTime sync: Validate timestamps between instances
 * 
 * Settings are stored in plugin configuration.
 */
module.exports = ({ strapi }) => {
  function getStore() {
    return strapi.store({ type: 'plugin', name: 'strapi-content-sync-pro' });
  }

  function plugin() {
    return strapi.plugin('strapi-content-sync-pro');
  }

  const DEFAULT_ENFORCEMENT_SETTINGS = {
    enforceSchemaMatch: true,
    schemaMatchMode: 'strict', // 'strict' | 'compatible' | 'none'
    enforceVersionCheck: true,
    allowedVersionDrift: 'minor', // 'exact' | 'minor' | 'major' | 'none'
    enforceDateTimeSync: true,
    maxTimeDriftMs: 60000, // 1 minute max allowed drift
    validateBeforeSync: true,
    blockOnFailure: true,
  };

  return {
    /**
     * Get enforcement settings
     */
    async getSettings() {
      const store = getStore();
      const data = await store.get({ key: STORE_KEY });
      return { ...DEFAULT_ENFORCEMENT_SETTINGS, ...data };
    },

    /**
     * Update enforcement settings
     */
    async updateSettings(updates) {
      const store = getStore();
      const current = await this.getSettings();
      const newSettings = { ...current, ...updates };

      // Validate settings
      if (newSettings.schemaMatchMode && !['strict', 'compatible', 'none'].includes(newSettings.schemaMatchMode)) {
        throw new Error(`Invalid schema match mode: ${newSettings.schemaMatchMode}`);
      }
      if (newSettings.allowedVersionDrift && !['exact', 'minor', 'major', 'none'].includes(newSettings.allowedVersionDrift)) {
        throw new Error(`Invalid version drift mode: ${newSettings.allowedVersionDrift}`);
      }
      if (newSettings.maxTimeDriftMs !== undefined && (newSettings.maxTimeDriftMs < 0 || newSettings.maxTimeDriftMs > 86400000)) {
        throw new Error('Max time drift must be between 0 and 86400000 ms (24 hours)');
      }

      await store.set({ key: STORE_KEY, value: newSettings });
      return newSettings;
    },

    /**
     * Get local Strapi version info
     */
    getLocalVersionInfo() {
      return {
        strapiVersion: strapi.config.info?.strapi || 'unknown',
        nodeVersion: process.version,
        serverTime: new Date().toISOString(),
      };
    },

    /**
     * Get local content type schema for comparison
     */
    getLocalSchema(uid) {
      const contentType = strapi.contentTypes[uid];
      if (!contentType) {
        return null;
      }

      const attributes = contentType.attributes || {};
      const schema = {};

      for (const [field, attr] of Object.entries(attributes)) {
        schema[field] = {
          type: attr.type,
          required: attr.required || false,
          unique: attr.unique || false,
        };

        if (attr.type === 'relation') {
          schema[field].relation = attr.relation;
          schema[field].target = attr.target;
        }
        if (attr.type === 'enumeration') {
          schema[field].enum = attr.enum;
        }
        if (attr.type === 'component') {
          schema[field].component = attr.component;
          schema[field].repeatable = attr.repeatable;
        }
      }

      return schema;
    },

    /**
     * Compare two schemas for compatibility
     */
    compareSchemas(localSchema, remoteSchema, mode = 'strict') {
      const result = {
        compatible: true,
        missingLocal: [],
        missingRemote: [],
        typeMismatches: [],
        warnings: [],
        differences: [],
      };

      if (!localSchema || !remoteSchema) {
        result.compatible = false;
        result.warnings.push('One or both schemas are missing');
        result.differences.push('Missing schema');
        return result;
      }

      const localFields = new Set(Object.keys(localSchema));
      const remoteFields = new Set(Object.keys(remoteSchema));

      // Check for missing fields
      for (const field of localFields) {
        if (!remoteFields.has(field)) {
          result.missingRemote.push(field);
          result.differences.push(`Field "${field}" missing on remote`);
          if (mode === 'strict') {
            result.compatible = false;
          }
        }
      }

      for (const field of remoteFields) {
        if (!localFields.has(field)) {
          result.missingLocal.push(field);
          result.differences.push(`Field "${field}" missing locally`);
          if (mode === 'strict') {
            result.compatible = false;
          }
        }
      }

      // Check type mismatches for common fields
      for (const field of localFields) {
        if (remoteFields.has(field)) {
          const local = localSchema[field];
          const remote = remoteSchema[field];

          if (local.type !== remote.type) {
            result.typeMismatches.push({
              field,
              localType: local.type,
              remoteType: remote.type,
            });
            result.differences.push(`Field "${field}" type mismatch: ${local.type} vs ${remote.type}`);
            result.compatible = false;
          }

          // Additional checks for relations
          if (local.type === 'relation' && remote.type === 'relation') {
            if (local.relation !== remote.relation) {
              result.warnings.push(`Relation type mismatch for field "${field}": ${local.relation} vs ${remote.relation}`);
              result.differences.push(`Field "${field}" relation mismatch`);
              if (mode === 'strict') {
                result.compatible = false;
              }
            }
          }
        }
      }

      return result;
    },

    /**
     * Compare version strings
     */
    compareVersions(localVersion, remoteVersion, allowedDrift = 'minor') {
      if (allowedDrift === 'none') {
        return { compatible: true, message: 'Version check disabled' };
      }

      const parseVersion = (v) => {
        const match = v.match(/^(\d+)\.(\d+)\.(\d+)/);
        if (!match) return null;
        return {
          major: parseInt(match[1], 10),
          minor: parseInt(match[2], 10),
          patch: parseInt(match[3], 10),
        };
      };

      const local = parseVersion(localVersion);
      const remote = parseVersion(remoteVersion);

      if (!local || !remote) {
        return {
          compatible: false,
          message: `Unable to parse versions: local=${localVersion}, remote=${remoteVersion}`,
        };
      }

      const result = { compatible: true, message: '', driftLevel: 'none' };

      switch (allowedDrift) {
        case 'exact':
          result.compatible = (
            local.major === remote.major &&
            local.minor === remote.minor &&
            local.patch === remote.patch
          );
          result.driftLevel = result.compatible ? 'none' : 'patch';
          result.message = result.compatible ? 'Versions match exactly' : 'Versions must match exactly';
          break;

        case 'minor':
          result.compatible = local.major === remote.major;
          result.driftLevel = local.major !== remote.major ? 'major' : (local.minor !== remote.minor ? 'minor' : 'patch');
          result.message = result.compatible
            ? 'Major versions match'
            : `Major version mismatch: ${local.major} vs ${remote.major}`;
          break;

        case 'major':
          result.compatible = true; // Allow any version
          result.driftLevel = local.major !== remote.major ? 'major' : (local.minor !== remote.minor ? 'minor' : 'patch');
          result.message = 'Major version drift allowed';
          break;
      }

      return result;
    },

    /**
     * Check time synchronization between instances
     */
    checkTimeSync(localTime, remoteTime, maxDriftMs = 60000) {
      const localDate = new Date(localTime);
      const remoteDate = new Date(remoteTime);
      const drift = Math.abs(localDate.getTime() - remoteDate.getTime());

      return {
        compatible: drift <= maxDriftMs,
        drift,
        maxAllowed: maxDriftMs,
        message: drift <= maxDriftMs
          ? `Time drift ${drift}ms is within allowed ${maxDriftMs}ms`
          : `Time drift ${drift}ms exceeds allowed ${maxDriftMs}ms`,
      };
    },

    /**
     * Run all enforcement checks before sync
     */
    async runPreSyncChecks(contentTypeUid, remoteInfo) {
      const settings = await this.getSettings();
      const results = {
        passed: true,
        checks: [],
        errors: [],
        warnings: [],
      };

      // Version check
      if (settings.enforceVersionCheck) {
        const localVersion = this.getLocalVersionInfo();
        const versionCheck = this.compareVersions(
          localVersion.strapi,
          remoteInfo.strapi || 'unknown',
          settings.allowedVersionDrift
        );

        results.checks.push({
          name: 'version',
          passed: versionCheck.compatible,
          message: versionCheck.message,
        });

        if (!versionCheck.compatible && settings.blockOnFailure) {
          results.passed = false;
          results.errors.push(`Version check failed: ${versionCheck.message}`);
        }
      }

      // Schema check
      if (settings.enforceSchemaMatch && settings.schemaMatchMode !== 'none') {
        const localSchema = this.getLocalSchema(contentTypeUid);
        const remoteSchema = remoteInfo.schema;
        const schemaCheck = this.compareSchemas(localSchema, remoteSchema, settings.schemaMatchMode);

        results.checks.push({
          name: 'schema',
          passed: schemaCheck.compatible,
          details: schemaCheck,
        });

        if (!schemaCheck.compatible && settings.blockOnFailure) {
          results.passed = false;
          results.errors.push(`Schema check failed for ${contentTypeUid}`);
          if (schemaCheck.typeMismatches.length > 0) {
            results.errors.push(`Type mismatches: ${schemaCheck.typeMismatches.map(m => m.field).join(', ')}`);
          }
        }

        results.warnings.push(...schemaCheck.warnings);
      }

      // Time sync check
      if (settings.enforceDateTimeSync) {
        const localTime = new Date().toISOString();
        const timeCheck = this.checkTimeSync(localTime, remoteInfo.timestamp, settings.maxTimeDriftMs);

        results.checks.push({
          name: 'timeSync',
          passed: timeCheck.compatible,
          message: timeCheck.message,
          drift: timeCheck.drift,
        });

        if (!timeCheck.compatible && settings.blockOnFailure) {
          results.passed = false;
          results.errors.push(`Time sync check failed: ${timeCheck.message}`);
        }
      }

      return results;
    },

    /**
     * Get enforcement summary for UI
     */
    async getEnforcementSummary() {
      const settings = await this.getSettings();
      const localVersion = this.getLocalVersionInfo();

      return {
        settings,
        localInfo: localVersion,
        checksEnabled: {
          schema: settings.enforceSchemaMatch && settings.schemaMatchMode !== 'none',
          version: settings.enforceVersionCheck && settings.allowedVersionDrift !== 'none',
          timeSync: settings.enforceDateTimeSync,
        },
      };
    },
  };
};
