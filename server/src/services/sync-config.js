'use strict';

const STORE_KEY = 'sync-configuration';

module.exports = ({ strapi }) => {
  function getStore() {
    return strapi.store({ type: 'plugin', name: 'strapi-to-strapi-data-sync' });
  }

  return {
    async getSyncConfig() {
      const store = getStore();
      const data = await store.get({ key: STORE_KEY });
      return data || { contentTypes: [], conflictStrategy: 'latest' };
    },

    async setSyncConfig(config) {
      const store = getStore();

      if (!config.contentTypes || !Array.isArray(config.contentTypes)) {
        throw new Error('contentTypes must be an array');
      }

      for (const ct of config.contentTypes) {
        if (!ct.uid) throw new Error('Each content type must have a uid');
        if (ct.direction && !['push', 'pull', 'both'].includes(ct.direction)) {
          throw new Error(`Invalid direction "${ct.direction}" for ${ct.uid}`);
        }
      }

      const value = {
        contentTypes: config.contentTypes.map((ct) => ({
          uid: ct.uid,
          direction: ct.direction || 'both',
          fields: ct.fields || [],
          enabled: ct.enabled !== undefined ? ct.enabled : true,
        })),
        conflictStrategy: config.conflictStrategy || 'latest',
      };

      await store.set({ key: STORE_KEY, value });
      return value;
    },
  };
};
