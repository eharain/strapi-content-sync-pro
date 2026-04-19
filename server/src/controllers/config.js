'use strict';

const PLUGIN_ID = 'strapi-to-strapi-data-sync';

module.exports = {
  async get(ctx) {
    const configService = strapi.plugin(PLUGIN_ID).service('config');
    const config = await configService.getConfig({ safe: true });

    ctx.body = { data: config };
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
    const { baseUrl, email, password } = ctx.request.body;

    if (!baseUrl || !email || !password) {
      return ctx.badRequest('baseUrl, email, and password are required');
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
        const errorMessage = errorBody?.error?.message || `Login failed with status ${loginResponse.status}`;
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
        const remoteConfigResponse = await fetch(`${baseUrl}/api/${PLUGIN_ID}/config`, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${apiToken}`,
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
