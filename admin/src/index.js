import { ArrowsCounterClockwise } from '@strapi/icons';
import pluginId from './pluginId';

export default {
  register(app) {
    app.addMenuLink({
      to: `plugins/${pluginId}`,
      icon: ArrowsCounterClockwise,
      intlLabel: {
        id: `${pluginId}.plugin.name`,
        defaultMessage: 'Data Sync',
      },
      Component: async () => {
        const { App } = await import('./pages/App');
        return App;
      },
    });

    app.registerPlugin({
      id: pluginId,
      name: pluginId,
    });
  },

  async registerTrads({ locales }) {
    return locales.map((locale) => ({
      data: {},
      locale,
    }));
  },
};
