'use strict';

const PLUGIN_ID = 'strapi-content-sync-pro';

module.exports = {
  async get(ctx) {
    const configService = strapi.plugin(PLUGIN_ID).service('config');
    const config = await configService.getConfig({ safe: true });

    ctx.body = { data: config };
  },

  /**
   * GET /config/test
   * Test connectivity to the remote server using stored credentials
   */
  async test(ctx) {
    const configService = strapi.plugin(PLUGIN_ID).service('config');
    const config = await configService.getConfig({ safe: false });

    if (!config || !config.baseUrl) {
      return ctx.body = {
        data: {
          success: false,
          stage: 'config',
          message: 'Remote server URL is not configured',
        },
      };
    }

    if (!config.apiToken) {
      return ctx.body = {
        data: {
          success: false,
          stage: 'config',
          message: 'API token is not configured',
        },
      };
    }

    const syncMode = config.syncMode || 'paired';

    // Step 1: Basic reachability
    const startTime = Date.now();
    if (syncMode === 'single_side') {
      try {
        const reachRes = await fetch(`${config.baseUrl}/api`, {
          method: 'GET',
          headers: { Authorization: `Bearer ${config.apiToken}` },
        });

        if (reachRes.status === 401 || reachRes.status === 403) {
          return ctx.body = {
            data: {
              success: false,
              stage: 'auth',
              message: `API token rejected by remote server (${reachRes.status}). Verify the token is valid and can read target content APIs.`,
              latency: Date.now() - startTime,
            },
          };
        }
      } catch (err) {
        return ctx.body = {
          data: {
            success: false,
            stage: 'network',
            message: `Cannot reach remote server in single-side mode: ${err.message}`,
            latency: Date.now() - startTime,
          },
        };
      }

      return ctx.body = {
        data: {
          success: true,
          stage: 'complete',
          message: 'Connection successful in single-side mode. Remote plugin endpoints are not required; only remote content APIs and token access are validated.',
          latency: Date.now() - startTime,
          remoteInfo: null,
          mode: syncMode,
        },
      };
    }

    let pingStatus = null;
    try {
      const pingRes = await fetch(`${config.baseUrl}/api/${PLUGIN_ID}/ping`, {
        method: 'GET',
      });
      pingStatus = pingRes.status;
      if (!pingRes.ok) {
        return ctx.body = {
          data: {
            success: false,
            stage: 'ping',
            message: `Remote server returned ${pingRes.status} on /ping. The plugin may not be installed on the remote server.`,
            latency: Date.now() - startTime,
          },
        };
      }
    } catch (err) {
      return ctx.body = {
        data: {
          success: false,
          stage: 'network',
          message: `Cannot reach remote server: ${err.message}`,
          latency: Date.now() - startTime,
        },
      };
    }

    const pingLatency = Date.now() - startTime;

    // Step 2: Verify API token works against an authenticated plugin endpoint
    let authWorks = false;
    let remoteInfo = null;
    try {
      const infoRes = await fetch(`${config.baseUrl}/api/${PLUGIN_ID}/enforcement/local-info`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${config.apiToken}` },
      });
      if (infoRes.ok) {
        authWorks = true;
        const body = await infoRes.json().catch(() => ({}));
        remoteInfo = body?.data || null;
      } else if (infoRes.status === 401 || infoRes.status === 403) {
        return ctx.body = {
          data: {
            success: false,
            stage: 'auth',
            message: `API token rejected by remote server (${infoRes.status}). Verify the token is valid and has Full Access.`,
            latency: pingLatency,
          },
        };
      } else if (infoRes.status === 404) {
        return ctx.body = {
          data: {
            success: false,
            stage: 'plugin',
            message: 'Remote server reachable but /enforcement/local-info not found. Ensure the plugin is installed and updated on the remote server.',
            latency: pingLatency,
          },
        };
      }
    } catch (err) {
      return ctx.body = {
        data: {
          success: false,
          stage: 'auth',
          message: `Error validating API token: ${err.message}`,
          latency: pingLatency,
        },
      };
    }

    ctx.body = {
      data: {
        success: true,
        stage: 'complete',
        message: authWorks
          ? 'Connection successful: remote plugin is reachable and API token is valid. Ensure matching sync settings (content types, active profiles, execution mode, and shared secret) on both servers before running sync.'
          : 'Reachable but API token could not be validated',
        latency: pingLatency,
        remoteInfo,
        mode: syncMode,
      },
    };
  },

  async set(ctx) {
    const { body } = ctx.request;

    if (!body || typeof body !== 'object') {
      return ctx.badRequest('Request body must be a JSON object');
    }

    const configService = strapi.plugin(PLUGIN_ID).service('config');

    try {
      const saved = await configService.setConfig(body);

      const sanitized = { ...saved };
      if (sanitized.apiToken) {
        sanitized.apiToken = '••••••••';
      }
      if (sanitized.sharedSecret) {
        sanitized.sharedSecret = '••••••••';
      }

      ctx.body = { data: sanitized };
    } catch (err) {
      return ctx.badRequest(err.message);
    }
  },

  /**
   * POST /config/remote-login
   * Proxy login to remote Strapi and retrieve/create API token
   */
  async remoteLogin(ctx) {
    const { baseUrl: rawBaseUrl, email, password } = ctx.request.body;

    if (!rawBaseUrl || !email || !password) {
      return ctx.badRequest('baseUrl, email, and password are required');
    }

    // --- Normalize and validate the base URL so URL mistakes produce a clear message ---
    let baseUrl = String(rawBaseUrl).trim();
    if (!/^https?:\/\//i.test(baseUrl)) {
      return ctx.badRequest(
        `Invalid Server URL "${rawBaseUrl}": must start with http:// or https:// (e.g. http://localhost:4010)`
      );
    }
    // Strip trailing slashes and accidental /admin suffix
    baseUrl = baseUrl.replace(/\/+$/, '').replace(/\/admin$/i, '');
    let parsedUrl;
    try {
      parsedUrl = new URL(baseUrl);
    } catch {
      return ctx.badRequest(
        `Invalid Server URL "${rawBaseUrl}": not a valid URL. Expected format: http(s)://host[:port]`
      );
    }
    if (!parsedUrl.hostname) {
      return ctx.badRequest(`Invalid Server URL "${rawBaseUrl}": missing hostname`);
    }

    // --- Pre-flight reachability check against /admin/init so wrong URL != "invalid credentials" ---
    try {
      const initResp = await fetch(`${baseUrl}/admin/init`, { method: 'GET' });
      if (!initResp.ok) {
        return ctx.throw(
          502,
          `Server URL "${baseUrl}" is reachable but did not respond as a Strapi admin (HTTP ${initResp.status} on /admin/init). Check that the URL points to the root of a Strapi v5 server (no /admin suffix) and that the admin panel is enabled.`
        );
      }
      const initData = await initResp.json().catch(() => null);
      if (!initData || typeof initData !== 'object' || !('data' in initData)) {
        return ctx.throw(
          502,
          `Server URL "${baseUrl}" did not return a valid Strapi /admin/init response. Please verify the URL points to a Strapi v5 instance.`
        );
      }
      if (initData.data && initData.data.hasAdmin === false) {
        return ctx.throw(
          400,
          `Remote Strapi at "${baseUrl}" has no admin user yet. Create the first admin in the remote Strapi panel before generating a token.`
        );
      }
    } catch (err) {
      if (err && err.status) throw err;
      const code = err && (err.cause?.code || err.code);
      const hint =
        code === 'ECONNREFUSED'
          ? 'Connection refused — the server is not running or not listening on that port.'
          : code === 'ENOTFOUND'
            ? 'Host not found — check the hostname/IP spelling and that it resolves from this machine.'
            : code === 'ETIMEDOUT'
              ? 'Request timed out — check firewall, network, and that the port is reachable.'
              : 'Network error while contacting the remote server.';
      return ctx.throw(502, `Cannot reach "${baseUrl}": ${hint}${code ? ` (${code})` : ''}`);
    }

    try {
      // Step 1: Login to remote Strapi admin
      const loginResponse = await fetch(`${baseUrl}/admin/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email,
          password,
        }),
      });

      if (!loginResponse.ok) {
        const errorBody = await loginResponse.json().catch(() => ({}));
        const remoteMsg = errorBody?.error?.message;
        // Distinguish URL-vs-credential failures so users aren't misled
        if (loginResponse.status === 404) {
          return ctx.throw(
            404,
            `"${baseUrl}/admin/login" not found (HTTP 404). The Server URL likely points to the wrong path — use the Strapi root URL (e.g. http://localhost:4010), not an admin or API sub-path.`
          );
        }
        if (loginResponse.status === 405) {
          return ctx.throw(
            405,
            `"${baseUrl}/admin/login" rejected the request method. The Server URL may be pointing to a proxy or non-Strapi endpoint.`
          );
        }
        const errorMessage = remoteMsg
          ? `Remote login failed: ${remoteMsg}. If you believe the credentials are correct, double-check the Server URL "${baseUrl}" is the right Strapi instance.`
          : `Login failed with status ${loginResponse.status} at ${baseUrl}/admin/login`;
        return ctx.throw(loginResponse.status, errorMessage);
      }

      const loginData = await loginResponse.json();
      const adminJwt = loginData.data?.token;

      if (!adminJwt) {
        return ctx.throw(500, 'No token received from remote server');
      }

      // Step 2: Check for existing token or create new one
      let apiToken = null;
      const TOKEN_NAME = 'strapi-data-sync-plugin'; // Fixed name for easy identification

      // First, list existing API tokens to see if one exists for the plugin
      const listTokensResponse = await fetch(`${baseUrl}/admin/api-tokens`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${adminJwt}`,
        },
      });

      let existingTokenId = null;
      if (listTokensResponse.ok) {
        const tokensData = await listTokensResponse.json();
        const existingToken = tokensData.data?.find(t => 
          t.name === TOKEN_NAME || 
          t.name?.startsWith('strapi-data-sync') ||
          t.name?.startsWith('data-sync-auto')
        );

        if (existingToken) {
          existingTokenId = existingToken.id;
          // Delete the old token so we can create a fresh one with the access key
          await fetch(`${baseUrl}/admin/api-tokens/${existingTokenId}`, {
            method: 'DELETE',
            headers: {
              Authorization: `Bearer ${adminJwt}`,
            },
          });
        }
      }

      // Step 3: Create a new API token with full access
      const createTokenResponse = await fetch(`${baseUrl}/admin/api-tokens`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminJwt}`,
        },
        body: JSON.stringify({
          name: TOKEN_NAME,
          description: 'Auto-generated token for Strapi-to-Strapi Data Sync plugin',
          type: 'full-access',
          lifespan: null, // No expiration
        }),
      });

      if (!createTokenResponse.ok) {
        const errorBody = await createTokenResponse.json().catch(() => ({}));
        const errorMessage = errorBody?.error?.message || 'Failed to create API token';
        return ctx.throw(createTokenResponse.status, errorMessage);
      }

      const tokenData = await createTokenResponse.json();
      apiToken = tokenData.data?.accessKey;

      if (!apiToken) {
        return ctx.throw(500, 'Failed to retrieve API token from created token');
      }

      // Step 4: Optionally get remote instance ID if plugin is installed
      let remoteInstanceId = null;
      try {
        const remoteConfigResponse = await fetch(`${baseUrl}/strapi-content-sync-pro/config`, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${adminJwt}`,
          },
        });

        if (remoteConfigResponse.ok) {
          const remoteConfig = await remoteConfigResponse.json();
          remoteInstanceId = remoteConfig.data?.instanceId;
        }
      } catch {
        // Remote plugin might not be installed or configured
      }

      // Step 5: Save the token to local config
      const configService = strapi.plugin(PLUGIN_ID).service('config');
      await configService.setConfig({
        baseUrl,
        apiToken,
      });

      ctx.body = {
        data: {
          success: true,
          apiToken: '••••••••', // Don't send actual token back to frontend
          tokenName: TOKEN_NAME,
          instanceId: remoteInstanceId,
          message: 'Successfully authenticated and created API token',
        },
      };
    } catch (err) {
      if (err.status) {
        throw err; // Re-throw Koa errors
      }
      ctx.throw(500, err.message || 'Remote login failed');
    }
  },
};
