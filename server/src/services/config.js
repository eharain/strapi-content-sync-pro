'use strict';

const STORE_KEY = 'remote-server-config';

const SENSITIVE_FIELDS = ['apiToken', 'sharedSecret'];

module.exports = ({ strapi }) => {
  function getStore() {
    return strapi.store({
      type: 'plugin',
      name: 'strapi-content-sync-pro',
    });
  }

  return {
    async getConfig({ safe = true } = {}) {
      const store = getStore();
      const data = await store.get({ key: STORE_KEY });

      if (!data) {
        return null;
      }

      if (!safe) {
        return data;
      }

      const sanitized = { ...data };
      for (const field of SENSITIVE_FIELDS) {
        if (sanitized[field]) {
          sanitized[field] = '••••••••';
        }
      }
      return sanitized;
    },

    async setConfig(config) {
      const store = getStore();

      const existing = await store.get({ key: STORE_KEY }) || {};

      const merged = { ...existing };

      if (config.baseUrl !== undefined) {
        merged.baseUrl = config.baseUrl;
      }
      if (config.apiToken !== undefined) {
        merged.apiToken = config.apiToken;
      }
      if (config.syncDirection !== undefined) {
        if (!['push', 'pull', 'bidirectional'].includes(config.syncDirection)) {
          throw new Error('syncDirection must be "push", "pull", or "bidirectional"');
        }
        merged.syncDirection = config.syncDirection;
      }
      if (config.instanceId !== undefined) {
        merged.instanceId = config.instanceId;
      }
      if (config.sharedSecret !== undefined) {
        merged.sharedSecret = config.sharedSecret;
      }

      await store.set({ key: STORE_KEY, value: merged });

      return merged;
    },
  };
};
