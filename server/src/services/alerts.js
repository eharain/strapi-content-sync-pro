'use strict';

const nodemailer = require('nodemailer');

const STORE_KEY = 'sync-alerts-settings';

/**
 * Sync Alerts Service
 * 
 * Manages notifications for sync success/failure events.
 * Supports:
 * - Strapi built-in notifications (admin panel)
 * - Email notifications (using user-configured SMTP)
 * - Custom webhook notifications
 */
module.exports = ({ strapi }) => {
  function getStore() {
    return strapi.store({ type: 'plugin', name: 'strapi-to-strapi-data-sync' });
  }

  function plugin() {
    return strapi.plugin('strapi-to-strapi-data-sync');
  }

  const DEFAULT_ALERT_SETTINGS = {
    enabled: true,
    channels: {
      strapiNotification: {
        enabled: true,
        onSuccess: false,
        onFailure: true,
      },
      email: {
        enabled: false,
        onSuccess: false,
        onFailure: true,
        recipients: [],
        // SMTP settings provided by user
        smtp: {
          host: '',
          port: 587,
          secure: false, // true for 465, false for other ports
          auth: {
            user: '',
            pass: '',
          },
          from: '', // sender email address
        },
      },
      webhook: {
        enabled: false,
        onSuccess: true,
        onFailure: true,
        url: '',
        headers: {},
      },
    },
    throttle: {
      enabled: true,
      maxAlertsPerHour: 10,
    },
  };

  // In-memory alert tracking for throttling
  let alertHistory = [];

  // Cached email transporter
  let emailTransporter = null;

  return {
    /**
     * Get alert settings
     */
    async getSettings() {
      const store = getStore();
      const data = await store.get({ key: STORE_KEY });
      const settings = { ...DEFAULT_ALERT_SETTINGS };

      if (data) {
        Object.assign(settings, data);
        // Deep merge channels
        if (data.channels) {
          settings.channels = {
            ...DEFAULT_ALERT_SETTINGS.channels,
            ...data.channels,
          };
          for (const channel of ['strapiNotification', 'email', 'webhook']) {
            if (data.channels[channel]) {
              settings.channels[channel] = {
                ...DEFAULT_ALERT_SETTINGS.channels[channel],
                ...data.channels[channel],
              };
            }
          }
          // Deep merge SMTP settings
          if (data.channels.email?.smtp) {
            settings.channels.email.smtp = {
              ...DEFAULT_ALERT_SETTINGS.channels.email.smtp,
              ...data.channels.email.smtp,
              auth: {
                ...DEFAULT_ALERT_SETTINGS.channels.email.smtp.auth,
                ...(data.channels.email.smtp.auth || {}),
              },
            };
          }
        }
      }

      // Mask password in response
      const responseSettings = JSON.parse(JSON.stringify(settings));
      if (responseSettings.channels.email.smtp.auth.pass) {
        responseSettings.channels.email.smtp.auth.pass = '••••••••';
      }

      return responseSettings;
    },

    /**
     * Update alert settings
     */
    async updateSettings(updates) {
      const store = getStore();
      const storedData = await store.get({ key: STORE_KEY }) || {};

      // Deep merge for nested channel settings
      const newSettings = {
        ...storedData,
        ...updates,
      };

      if (updates.channels) {
        newSettings.channels = {
          ...(storedData.channels || {}),
          ...updates.channels,
        };

        for (const channel of ['strapiNotification', 'email', 'webhook']) {
          if (updates.channels[channel]) {
            newSettings.channels[channel] = {
              ...(storedData.channels?.[channel] || {}),
              ...updates.channels[channel],
            };
          }
        }

        // Handle SMTP settings specially - don't overwrite password if masked
        if (updates.channels.email?.smtp) {
          const existingSmtp = storedData.channels?.email?.smtp || {};
          newSettings.channels.email.smtp = {
            ...existingSmtp,
            ...updates.channels.email.smtp,
            auth: {
              ...(existingSmtp.auth || {}),
              ...(updates.channels.email.smtp.auth || {}),
            },
          };
          // Don't overwrite password if it's masked
          if (updates.channels.email.smtp.auth?.pass === '••••••••') {
            newSettings.channels.email.smtp.auth.pass = existingSmtp.auth?.pass || '';
          }
        }
      }

      // Validate email settings if enabled
      if (newSettings.channels?.email?.enabled) {
        if (!newSettings.channels.email.recipients || newSettings.channels.email.recipients.length === 0) {
          throw new Error('Email channel enabled but no recipients configured');
        }
        const smtp = newSettings.channels.email.smtp;
        if (!smtp?.host) {
          throw new Error('Email channel enabled but SMTP host not configured');
        }
        if (!smtp?.auth?.user) {
          throw new Error('Email channel enabled but SMTP username not configured');
        }
        if (!smtp?.from) {
          throw new Error('Email channel enabled but sender email (from) not configured');
        }
      }

      // Validate webhook URL
      if (newSettings.channels?.webhook?.enabled && !newSettings.channels.webhook.url) {
        throw new Error('Webhook channel enabled but no URL configured');
      }

      await store.set({ key: STORE_KEY, value: newSettings });

      // Reset transporter so it gets recreated with new settings
      emailTransporter = null;

      // Return masked settings
      const responseSettings = JSON.parse(JSON.stringify(newSettings));
      if (responseSettings.channels?.email?.smtp?.auth?.pass) {
        responseSettings.channels.email.smtp.auth.pass = '••••••••';
      }

      return responseSettings;
    },

    /**
     * Get or create email transporter
     */
    async getEmailTransporter() {
      if (emailTransporter) {
        return emailTransporter;
      }

      const store = getStore();
      const data = await store.get({ key: STORE_KEY });
      const smtp = data?.channels?.email?.smtp;

      if (!smtp?.host || !smtp?.auth?.user) {
        throw new Error('SMTP not configured. Please configure email settings in Configuration > Alerts.');
      }

      emailTransporter = nodemailer.createTransport({
        host: smtp.host,
        port: smtp.port || 587,
        secure: smtp.secure || false,
        auth: {
          user: smtp.auth.user,
          pass: smtp.auth.pass,
        },
      });

      return emailTransporter;
    },

    /**
     * Check if alerts are being throttled
     */
    isThrottled() {
      const oneHourAgo = Date.now() - 3600000;
      alertHistory = alertHistory.filter(ts => ts > oneHourAgo);
      return alertHistory.length >= 10; // Default max
    },

    /**
     * Record an alert for throttling
     */
    recordAlert() {
      alertHistory.push(Date.now());
    },

    /**
     * Send an alert through configured channels
     */
    async sendAlert(eventType, data) {
      const store = getStore();
      const settings = await store.get({ key: STORE_KEY }) || DEFAULT_ALERT_SETTINGS;

      if (!settings.enabled) {
        return { sent: false, reason: 'Alerts disabled' };
      }

      // Check throttling
      if (settings.throttle?.enabled && this.isThrottled()) {
        strapi.log.warn('Alert throttled - too many alerts in the past hour');
        return { sent: false, reason: 'Throttled' };
      }

      const isSuccess = eventType === 'sync_success';
      const isFailure = eventType === 'sync_failure';
      const results = [];

      // Strapi notification channel
      if (settings.channels?.strapiNotification?.enabled) {
        const shouldSend = (isSuccess && settings.channels.strapiNotification.onSuccess) ||
                          (isFailure && settings.channels.strapiNotification.onFailure);
        if (shouldSend) {
          try {
            await this.sendStrapiNotification(eventType, data);
            results.push({ channel: 'strapiNotification', success: true });
          } catch (error) {
            results.push({ channel: 'strapiNotification', success: false, error: error.message });
          }
        }
      }

      // Email channel
      if (settings.channels?.email?.enabled) {
        const shouldSend = (isSuccess && settings.channels.email.onSuccess) ||
                          (isFailure && settings.channels.email.onFailure);
        if (shouldSend) {
          try {
            await this.sendEmailNotification(eventType, data, settings.channels.email);
            results.push({ channel: 'email', success: true });
          } catch (error) {
            results.push({ channel: 'email', success: false, error: error.message });
          }
        }
      }

      // Webhook channel
      if (settings.channels?.webhook?.enabled) {
        const shouldSend = (isSuccess && settings.channels.webhook.onSuccess) ||
                          (isFailure && settings.channels.webhook.onFailure);
        if (shouldSend) {
          try {
            await this.sendWebhookNotification(eventType, data, settings.channels.webhook);
            results.push({ channel: 'webhook', success: true });
          } catch (error) {
            results.push({ channel: 'webhook', success: false, error: error.message });
          }
        }
      }

      if (results.length > 0) {
        this.recordAlert();
      }

      return { sent: results.length > 0, results };
    },

    /**
     * Send Strapi admin notification
     */
    async sendStrapiNotification(eventType, data) {
      const logService = plugin().service('syncLog');
      const isFailure = eventType === 'sync_failure';

      // Log to sync log (visible in admin)
      await logService.log({
        action: isFailure ? 'sync_error' : 'sync_complete',
        contentType: data.contentType || 'unknown',
        direction: 'system',
        status: isFailure ? 'error' : 'success',
        message: this.formatMessage(eventType, data),
        details: data,
      });

      // Note: Strapi v5 doesn't have built-in admin notifications API
      // This could be extended with a custom notification system
      strapi.log.info(`[Sync Alert] ${eventType}: ${this.formatMessage(eventType, data)}`);
    },

    /**
     * Send email notification using user-configured SMTP
     */
    async sendEmailNotification(eventType, data, emailConfig) {
      const transporter = await this.getEmailTransporter();
      const store = getStore();
      const settings = await store.get({ key: STORE_KEY });
      const smtp = settings?.channels?.email?.smtp;

      const subject = eventType === 'sync_failure'
        ? `[Sync Alert] Sync Failed - ${data.profile || data.contentType}`
        : `[Sync Alert] Sync Completed - ${data.profile || data.contentType}`;

      const html = this.formatEmailBody(eventType, data);

      for (const recipient of emailConfig.recipients) {
        await transporter.sendMail({
          from: smtp.from,
          to: recipient,
          subject,
          html,
        });
      }
    },

    /**
     * Send webhook notification
     */
    async sendWebhookNotification(eventType, data, webhookConfig) {
      const payload = {
        event: eventType,
        timestamp: new Date().toISOString(),
        data,
      };

      const response = await fetch(webhookConfig.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...webhookConfig.headers,
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error(`Webhook failed with status ${response.status}`);
      }
    },

    /**
     * Format alert message
     */
    formatMessage(eventType, data) {
      if (eventType === 'sync_failure') {
        return `Sync failed for ${data.profile || data.contentType}: ${data.error || 'Unknown error'}`;
      }
      if (eventType === 'sync_success') {
        const duration = data.duration ? ` (${Math.round(data.duration / 1000)}s)` : '';
        return `Sync completed for ${data.profile || data.contentType}${duration}`;
      }
      return `Sync event: ${eventType}`;
    },

    /**
     * Format email body
     */
    formatEmailBody(eventType, data) {
      const isFailure = eventType === 'sync_failure';
      const statusColor = isFailure ? '#dc3545' : '#28a745';
      const statusText = isFailure ? 'Failed' : 'Completed';

      return `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: ${statusColor};">Sync ${statusText}</h2>
          <table style="width: 100%; border-collapse: collapse;">
            <tr>
              <td style="padding: 8px; border-bottom: 1px solid #ddd;"><strong>Profile:</strong></td>
              <td style="padding: 8px; border-bottom: 1px solid #ddd;">${data.profile || 'N/A'}</td>
            </tr>
            <tr>
              <td style="padding: 8px; border-bottom: 1px solid #ddd;"><strong>Content Type:</strong></td>
              <td style="padding: 8px; border-bottom: 1px solid #ddd;">${data.contentType || 'N/A'}</td>
            </tr>
            <tr>
              <td style="padding: 8px; border-bottom: 1px solid #ddd;"><strong>Time:</strong></td>
              <td style="padding: 8px; border-bottom: 1px solid #ddd;">${new Date().toISOString()}</td>
            </tr>
            ${data.duration ? `
            <tr>
              <td style="padding: 8px; border-bottom: 1px solid #ddd;"><strong>Duration:</strong></td>
              <td style="padding: 8px; border-bottom: 1px solid #ddd;">${Math.round(data.duration / 1000)}s</td>
            </tr>
            ` : ''}
            ${isFailure ? `
            <tr>
              <td style="padding: 8px; border-bottom: 1px solid #ddd;"><strong>Error:</strong></td>
              <td style="padding: 8px; border-bottom: 1px solid #ddd; color: #dc3545;">${data.error || 'Unknown error'}</td>
            </tr>
            ` : ''}
          </table>
          <p style="margin-top: 20px; color: #666; font-size: 12px;">
            This is an automated notification from Strapi-to-Strapi Data Sync Plugin.
          </p>
        </div>
      `;
    },

    /**
     * Test alert channels
     */
    async testChannel(channel) {
      const testData = {
        profile: 'Test Profile',
        contentType: 'api::test.test',
        duration: 5000,
      };

      const store = getStore();
      const settings = await store.get({ key: STORE_KEY }) || DEFAULT_ALERT_SETTINGS;

      switch (channel) {
        case 'strapiNotification':
          await this.sendStrapiNotification('sync_success', testData);
          return { success: true, message: 'Strapi notification sent - check sync logs' };

        case 'email':
          if (!settings.channels?.email?.recipients?.length) {
            throw new Error('No email recipients configured');
          }
          if (!settings.channels?.email?.smtp?.host) {
            throw new Error('SMTP not configured');
          }
          await this.sendEmailNotification('sync_success', testData, settings.channels.email);
          return { success: true, message: `Test email sent to: ${settings.channels.email.recipients.join(', ')}` };

        case 'webhook':
          if (!settings.channels?.webhook?.url) {
            throw new Error('No webhook URL configured');
          }
          await this.sendWebhookNotification('sync_success', testData, settings.channels.webhook);
          return { success: true, message: 'Webhook notification sent' };

        default:
          throw new Error(`Unknown channel: ${channel}`);
      }
    },

    /**
     * Verify SMTP connection
     */
    async verifySmtpConnection() {
      const transporter = await this.getEmailTransporter();
      await transporter.verify();
      return { success: true, message: 'SMTP connection verified successfully' };
    },

    /**
     * Get alert history summary
     */
    getAlertStats() {
      const oneHourAgo = Date.now() - 3600000;
      const recentAlerts = alertHistory.filter(ts => ts > oneHourAgo);

      return {
        alertsLastHour: recentAlerts.length,
        throttleLimit: 10,
        isThrottled: this.isThrottled(),
      };
    },
  };
};
