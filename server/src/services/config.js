'use strict';

const STORE_KEY = 'remote-server-config';

const SENSITIVE_FIELDS = ['apiToken', 'sharedSecret'];
const VALID_SYNC_MODES = ['paired', 'single_side'];

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

      const normalized = {
        syncMode: 'paired',
        ...data,
      };

      if (!safe) {
        return normalized;
      }

      const sanitized = { ...normalized };
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
      if (config.syncMode !== undefined) {
        if (!VALID_SYNC_MODES.includes(config.syncMode)) {
          throw new Error(`syncMode must be one of: ${VALID_SYNC_MODES.join(', ')}`);
        }
        merged.syncMode = config.syncMode;
      }

      if (!merged.syncMode) {
        merged.syncMode = 'paired';
      }

      await store.set({ key: STORE_KEY, value: merged });

      return merged;
    },
  };
};
