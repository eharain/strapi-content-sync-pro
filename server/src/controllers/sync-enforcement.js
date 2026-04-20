'use strict';

const PLUGIN_ID = 'strapi-content-sync-pro';

module.exports = ({ strapi }) => ({
  /**
   * GET /enforcement/settings
   * Get enforcement settings
   */
  async getSettings(ctx) {
    try {
      const settings = await strapi.plugin(PLUGIN_ID).service('syncEnforcement').getSettings();
      ctx.body = { data: settings };
    } catch (err) {
      ctx.throw(500, err.message);
    }
  },

  /**
   * PUT /enforcement/settings
   * Update enforcement settings
   */
  async updateSettings(ctx) {
    const body = ctx.request.body;
    try {
      const settings = await strapi.plugin(PLUGIN_ID).service('syncEnforcement').updateSettings(body);
      ctx.body = { data: settings };
    } catch (err) {
      ctx.throw(400, err.message);
    }
  },

  /**
   * GET /enforcement/local-info
   * Get local version and schema info
   */
  async getLocalInfo(ctx) {
    try {
      const service = strapi.plugin(PLUGIN_ID).service('syncEnforcement');
      const versionInfo = service.getLocalVersionInfo();
      ctx.body = { data: versionInfo };
    } catch (err) {
      ctx.throw(500, err.message);
    }
  },

  /**
   * GET /enforcement/remote-info
   * Get remote server info for connection test
   */
  async getRemoteInfo(ctx) {
    try {
      const configService = strapi.plugin(PLUGIN_ID).service('config');
      const config = await configService.getConfig({ safe: false });

      if (!config || !config.baseUrl) {
        return ctx.throw(400, 'Remote server not configured');
      }

      const url = `${config.baseUrl}/api/${PLUGIN_ID}/enforcement/local-info`;
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${config.apiToken}`,
        },
      });

      if (!response.ok) {
        let errorDetail = '';
        try {
          const errorBody = await response.json();
          errorDetail = errorBody?.error?.message || JSON.stringify(errorBody);
        } catch {
          errorDetail = await response.text();
        }
        return ctx.throw(response.status, `Remote server returned ${response.status}: ${errorDetail}`);
      }

      const data = await response.json();
      ctx.body = { data: data.data };
    } catch (err) {
      if (err.status) {
        throw err; // Re-throw Koa errors
      }
      ctx.throw(500, err.message || 'Failed to get remote info');
    }
  },

  /**
   * GET /enforcement/check/:type
   * Run individual diagnostic check (schema, version, time)
   */
  async runDiagnosticCheck(ctx) {
    const { type } = ctx.params;
    const validTypes = ['schema', 'version', 'time'];

    if (!validTypes.includes(type)) {
      return ctx.throw(400, `Invalid check type. Must be one of: ${validTypes.join(', ')}`);
    }

    try {
      const configService = strapi.plugin(PLUGIN_ID).service('config');
      const enforcementService = strapi.plugin(PLUGIN_ID).service('syncEnforcement');
      const syncConfigService = strapi.plugin(PLUGIN_ID).service('syncConfig');

      const config = await configService.getConfig({ safe: false });

      if (!config || !config.baseUrl) {
        return ctx.body = {
          data: {
            passed: false,
            error: 'Remote server not configured',
          },
        };
      }

      // Get remote info
      let remoteInfo;
      try {
        const response = await fetch(`${config.baseUrl}/api/${PLUGIN_ID}/enforcement/local-info`, {
          headers: {
            Authorization: `Bearer ${config.apiToken}`,
          },
        });

        if (!response.ok) {
          return ctx.body = {
            data: {
              passed: false,
              error: `Cannot reach remote server (${response.status})`,
            },
          };
        }

        remoteInfo = (await response.json()).data;
      } catch (err) {
        return ctx.body = {
          data: {
            passed: false,
            error: `Connection failed: ${err.message}`,
          },
        };
      }

      const localInfo = enforcementService.getLocalVersionInfo();
      const settings = await enforcementService.getSettings();

      let result = { passed: true, details: {} };

      switch (type) {
        case 'version': {
          const versionResult = enforcementService.compareVersions(
            localInfo.strapiVersion,
            remoteInfo.strapiVersion,
            settings.allowedVersionDrift
          );
          result = {
            passed: versionResult.compatible,
            details: {
              localVersion: localInfo.strapiVersion,
              remoteVersion: remoteInfo.strapiVersion,
              driftLevel: versionResult.driftLevel,
              message: versionResult.message,
            },
          };
          break;
        }

        case 'time': {
          const localTime = new Date();
          const remoteTime = new Date(remoteInfo.serverTime);
          const driftMs = Math.abs(localTime - remoteTime);
          const passed = driftMs <= settings.maxTimeDriftMs;

          result = {
            passed,
            details: {
              localTime: localTime.toISOString(),
              remoteTime: remoteInfo.serverTime,
              driftMs,
              maxAllowed: settings.maxTimeDriftMs,
              message: passed 
                ? `Time drift of ${driftMs}ms is within allowed limit`
                : `Time drift of ${driftMs}ms exceeds limit of ${settings.maxTimeDriftMs}ms`,
            },
          };
          break;
        }

        case 'schema': {
          const syncConfig = await syncConfigService.getSyncConfig();
          const enabledTypes = (syncConfig.contentTypes || [])
            .filter((ct) => ct.enabled !== false)
            .map((ct) => ct.uid);
          const mismatches = [];

          if (enabledTypes.length === 0) {
            result = {
              passed: true,
              details: {
                checkedTypes: [],
                mismatches: [],
                matchMode: settings.schemaMatchMode,
                message: 'No content types enabled for sync',
              },
            };
            break;
          }

          for (const uid of enabledTypes) {
            try {
              // Get remote schema
              const schemaResponse = await fetch(
                `${config.baseUrl}/api/${PLUGIN_ID}/enforcement/schema/${encodeURIComponent(uid)}`,
                {
                  headers: {
                    Authorization: `Bearer ${config.apiToken}`,
                  },
                }
              );

              if (!schemaResponse.ok) {
                mismatches.push({
                  type: uid,
                  reason: `Not found on remote (${schemaResponse.status})`,
                });
                continue;
              }

              const remoteSchema = (await schemaResponse.json()).data?.schema;
              const localSchema = enforcementService.getLocalSchema(uid);

              if (!localSchema) {
                mismatches.push({
                  type: uid,
                  reason: 'Not found locally',
                });
                continue;
              }

              // Compare schemas
              const comparison = enforcementService.compareSchemas(localSchema, remoteSchema, settings.schemaMatchMode);
              if (!comparison.compatible) {
                mismatches.push({
                  type: uid,
                  reason: comparison.differences?.join(', ') || 'Schema mismatch',
                });
              }
            } catch (err) {
              mismatches.push({
                type: uid,
                reason: err.message,
              });
            }
          }

          result = {
            passed: mismatches.length === 0,
            details: {
              checkedTypes: enabledTypes,
              mismatches,
              matchMode: settings.schemaMatchMode,
            },
          };
          break;
        }
      }

      ctx.body = { data: result };
    } catch (err) {
      ctx.throw(500, err.message);
    }
  },

  /**
   * GET /enforcement/schema/:uid
   * Get local schema for a content type
   */
  async getLocalSchema(ctx) {
    const { uid } = ctx.params;
    try {
      const schema = strapi.plugin(PLUGIN_ID).service('syncEnforcement').getLocalSchema(uid);
      if (!schema) {
        return ctx.throw(404, `Content type "${uid}" not found`);
      }
      ctx.body = { data: { uid, schema } };
    } catch (err) {
      ctx.throw(500, err.message);
    }
  },

  /**
   * POST /enforcement/check
   * Run pre-sync enforcement checks
   */
  async runChecks(ctx) {
    const { contentType, remoteInfo } = ctx.request.body;
    if (!contentType) {
      return ctx.throw(400, 'contentType is required');
    }
    if (!remoteInfo) {
      return ctx.throw(400, 'remoteInfo is required');
    }
    try {
      const results = await strapi.plugin(PLUGIN_ID).service('syncEnforcement').runPreSyncChecks(contentType, remoteInfo);
      ctx.body = { data: results };
    } catch (err) {
      ctx.throw(400, err.message);
    }
  },

  /**
   * GET /enforcement/summary
   * Get enforcement summary for UI
   */
  async getSummary(ctx) {
    try {
      const summary = await strapi.plugin(PLUGIN_ID).service('syncEnforcement').getEnforcementSummary();
      ctx.body = { data: summary };
    } catch (err) {
      ctx.throw(500, err.message);
    }
  },
});
