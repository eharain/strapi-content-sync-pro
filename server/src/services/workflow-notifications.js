'use strict';

const CONTENT_TYPE_UID = 'plugin::strapi-content-sync-pro.workflow-notification';
const STORE_KEY = 'workflow-notification-templates';

const DEFAULT_TEMPLATES = [
  {
    sourceApp: 'web',
    workflow: 'order',
    event: 'order_created',
    title: 'New order placed',
    message: 'Order {{orderId}} placed by {{customerName}} for {{amount}}.',
  },
  {
    sourceApp: 'web',
    workflow: 'order',
    event: 'order_paid',
    title: 'Order payment received',
    message: 'Payment received for order {{orderId}}.',
  },
  {
    sourceApp: 'web-user-app',
    workflow: 'purchase',
    event: 'purchase_initiated',
    title: 'Purchase initiated',
    message: 'User {{userId}} initiated purchase {{purchaseId}}.',
  },
  {
    sourceApp: 'web-user-app',
    workflow: 'purchase',
    event: 'purchase_completed',
    title: 'Purchase completed',
    message: 'Purchase {{purchaseId}} completed successfully for {{userId}}.',
  },
];

module.exports = ({ strapi }) => ({
  getStore() {
    return strapi.store({ type: 'plugin', name: 'strapi-content-sync-pro' });
  },

  interpolate(template, payload = {}) {
    return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key) => {
      const value = payload[key];
      return value === undefined || value === null ? '' : String(value);
    });
  },

  async seedTemplates() {
    const store = this.getStore();
    const existing = await store.get({ key: STORE_KEY });

    if (Array.isArray(existing) && existing.length > 0) {
      return { seeded: false, total: existing.length };
    }

    await store.set({ key: STORE_KEY, value: DEFAULT_TEMPLATES });
    return { seeded: true, total: DEFAULT_TEMPLATES.length };
  },

  async getTemplates() {
    const store = this.getStore();
    const templates = await store.get({ key: STORE_KEY });
    if (Array.isArray(templates) && templates.length > 0) {
      return templates;
    }

    await this.seedTemplates();
    return DEFAULT_TEMPLATES;
  },

  async findTemplate({ sourceApp, workflow, event }) {
    const templates = await this.getTemplates();
    return templates.find((template) => (
      template.sourceApp === sourceApp
      && template.workflow === workflow
      && template.event === event
    ));
  },

  async emit(payload = {}) {
    const { sourceApp, workflow, event, recipient, metadata } = payload;

    if (!sourceApp || !workflow || !event) {
      throw new Error('sourceApp, workflow, and event are required');
    }

    const template = await this.findTemplate({ sourceApp, workflow, event });
    if (!template) {
      throw new Error(`No notification template found for ${sourceApp}/${workflow}/${event}`);
    }

    const title = this.interpolate(template.title, payload);
    const message = this.interpolate(template.message, payload);

    const entry = await strapi.documents(CONTENT_TYPE_UID).create({
      data: {
        sourceApp,
        workflow,
        event,
        title,
        message,
        recipient: recipient || '',
        orderId: payload.orderId || '',
        purchaseId: payload.purchaseId || '',
        status: 'pending',
        metadata: metadata || payload,
      },
    });

    return entry;
  },

  async list({ page = 1, pageSize = 25, sourceApp, workflow, event, status } = {}) {
    const filters = {};
    if (sourceApp) filters.sourceApp = sourceApp;
    if (workflow) filters.workflow = workflow;
    if (event) filters.event = event;
    if (status) filters.status = status;

    const start = (page - 1) * pageSize;

    const [entries, total] = await Promise.all([
      strapi.documents(CONTENT_TYPE_UID).findMany({
        filters,
        sort: { createdAt: 'desc' },
        limit: pageSize,
        start,
      }),
      strapi.documents(CONTENT_TYPE_UID).count({ filters }),
    ]);

    return {
      data: entries,
      meta: {
        pagination: {
          page,
          pageSize,
          pageCount: Math.ceil(total / pageSize),
          total,
        },
      },
    };
  },
});
