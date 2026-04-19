import { useState, useEffect } from 'react';
import {
  Box,
  Flex,
  Typography,
  TextInput,
  Button,
  Alert,
  Field,
  Tabs,
  SingleSelect,
  SingleSelectOption,
  Switch,
  NumberInput,
  TextButton,
} from '@strapi/design-system';
import { useFetchClient } from '@strapi/strapi/admin';

const PLUGIN_ID = 'strapi-to-strapi-data-sync';

const ConfigTab = () => {
  const { get, post, put } = useFetchClient();

  // Connection config
  const [config, setConfig] = useState({
    baseUrl: '',
    apiToken: '',
    instanceId: '',
    sharedSecret: '',
  });

  // Enforcement settings
  const [enforcement, setEnforcement] = useState({
    enforceSchemaMatch: true,
    schemaMatchMode: 'strict',
    enforceVersionCheck: true,
    allowedVersionDrift: 'minor',
    enforceDateTimeSync: true,
    maxTimeDriftMs: 60000,
    validateBeforeSync: true,
    blockOnFailure: true,
  });

  // Alert settings
  const [alerts, setAlerts] = useState({
    enabled: true,
    emailPluginConfigured: false,
    channels: {
      strapiNotification: { enabled: true, onSuccess: false, onFailure: true },
      email: {
        enabled: false,
        onSuccess: false,
        onFailure: true,
        recipients: [],
        from: '', // Optional custom from address
      },
      webhook: { enabled: false, onSuccess: true, onFailure: true, url: '' },
    },
  });

  const [emailRecipients, setEmailRecipients] = useState('');

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);

  useEffect(() => {
    fetchAllConfig();
  }, []);

  const fetchAllConfig = async () => {
    try {
      const [configRes, enforcementRes, alertsRes] = await Promise.all([
        get(`/${PLUGIN_ID}/config`),
        get(`/${PLUGIN_ID}/enforcement/settings`),
        get(`/${PLUGIN_ID}/alerts/settings`),
      ]);
      if (configRes.data.data) {
        setConfig((prev) => ({ ...prev, ...configRes.data.data }));
      }
      if (enforcementRes.data.data) {
        setEnforcement((prev) => ({ ...prev, ...enforcementRes.data.data }));
      }
      if (alertsRes.data.data) {
        setAlerts((prev) => ({ ...prev, ...alertsRes.data.data }));
        if (alertsRes.data.data.channels?.email?.recipients) {
          setEmailRecipients(alertsRes.data.data.channels.email.recipients.join(', '));
        }
      }
    } catch (err) {
      console.error('Failed to fetch config', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveConnection = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const payload = {};
      if (config.baseUrl) payload.baseUrl = config.baseUrl;
      if (config.apiToken && config.apiToken !== '••••••••') payload.apiToken = config.apiToken;
      if (config.instanceId) payload.instanceId = config.instanceId;
      if (config.sharedSecret && config.sharedSecret !== '••••••••') payload.sharedSecret = config.sharedSecret;

      await post(`/${PLUGIN_ID}/config`, payload);
      setMessage({ type: 'success', text: 'Connection configuration saved' });
    } catch {
      setMessage({ type: 'danger', text: 'Failed to save configuration' });
    } finally {
      setSaving(false);
    }
  };

  const handleSaveEnforcement = async () => {
    setSaving(true);
    setMessage(null);
    try {
      await put(`/${PLUGIN_ID}/enforcement/settings`, enforcement);
      setMessage({ type: 'success', text: 'Enforcement settings saved' });
    } catch (err) {
      setMessage({ type: 'danger', text: err.response?.data?.error?.message || 'Failed to save enforcement settings' });
    } finally {
      setSaving(false);
    }
  };

  const handleSaveAlerts = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const alertPayload = {
        ...alerts,
        channels: {
          ...alerts.channels,
          email: {
            ...alerts.channels.email,
            recipients: emailRecipients.split(',').map(e => e.trim()).filter(e => e),
          },
        },
      };
      await put(`/${PLUGIN_ID}/alerts/settings`, alertPayload);
      setMessage({ type: 'success', text: 'Alert settings saved' });
    } catch (err) {
      setMessage({ type: 'danger', text: err.response?.data?.error?.message || 'Failed to save alert settings' });
    } finally {
      setSaving(false);
    }
  };

  const handleTestAlert = async (channel) => {
    try {
      await post(`/${PLUGIN_ID}/alerts/test/${channel}`);
      setMessage({ type: 'success', text: `Test alert sent to ${channel}` });
    } catch (err) {
      setMessage({ type: 'danger', text: err.response?.data?.error?.message || 'Failed to send test alert' });
    }
  };

  if (loading) return <Typography>Loading…</Typography>;

  return (
    <Box>
      <Typography variant="beta" tag="h2">Configuration</Typography>
      <Box paddingTop={2} paddingBottom={4}>
        <Typography variant="omega" textColor="neutral600">
          Configure connection, enforcement policies, and alert notifications.
        </Typography>
      </Box>

      {message && (
        <Box paddingBottom={4}>
          <Alert variant={message.type} closeLabel="Close" onClose={() => setMessage(null)}>
            {message.text}
          </Alert>
        </Box>
      )}

      <Tabs.Root defaultValue="connection">
        <Tabs.List>
          <Tabs.Trigger value="connection">Connection</Tabs.Trigger>
          <Tabs.Trigger value="enforcement">Enforcement</Tabs.Trigger>
          <Tabs.Trigger value="alerts">Alerts</Tabs.Trigger>
        </Tabs.List>

        <Box paddingTop={4}>
          {/* Connection Tab */}
          <Tabs.Content value="connection">
            <Box>
              <Typography variant="delta" paddingBottom={2}>Remote Server Connection</Typography>
              <Flex direction="column" gap={4}>
                <Field.Root>
                  <Field.Label>Base URL</Field.Label>
                  <TextInput
                    placeholder="https://remote-strapi.example.com"
                    value={config.baseUrl}
                    onChange={(e) => setConfig((p) => ({ ...p, baseUrl: e.target.value }))}
                  />
                  <Field.Hint>The base URL of the remote Strapi instance (no trailing slash)</Field.Hint>
                </Field.Root>

                <Field.Root>
                  <Field.Label>API Token</Field.Label>
                  <TextInput
                    type="password"
                    placeholder="Enter API token"
                    value={config.apiToken}
                    onChange={(e) => setConfig((p) => ({ ...p, apiToken: e.target.value }))}
                  />
                  <Field.Hint>API token for authenticating with the remote server</Field.Hint>
                </Field.Root>

                <Field.Root>
                  <Field.Label>Instance ID</Field.Label>
                  <TextInput
                    placeholder="unique-instance-id"
                    value={config.instanceId}
                    onChange={(e) => setConfig((p) => ({ ...p, instanceId: e.target.value }))}
                  />
                  <Field.Hint>A unique identifier for this Strapi instance</Field.Hint>
                </Field.Root>

                <Field.Root>
                  <Field.Label>Shared Secret</Field.Label>
                  <TextInput
                    type="password"
                    placeholder="Enter shared secret for HMAC signing"
                    value={config.sharedSecret}
                    onChange={(e) => setConfig((p) => ({ ...p, sharedSecret: e.target.value }))}
                  />
                  <Field.Hint>Must match on both instances for secure communication</Field.Hint>
                </Field.Root>

                <Button onClick={handleSaveConnection} loading={saving}>
                  Save Connection
                </Button>
              </Flex>
            </Box>
          </Tabs.Content>

          {/* Enforcement Tab */}
          <Tabs.Content value="enforcement">
            <Box>
              <Typography variant="delta" paddingBottom={2}>Sync Enforcement Policies</Typography>
              <Typography variant="omega" textColor="neutral600" paddingBottom={4}>
                Configure validation checks that run before each sync operation.
              </Typography>

              <Flex direction="column" gap={4}>
                {/* Schema Match */}
                <Box padding={4} background="neutral0" hasRadius>
                  <Flex justifyContent="space-between" alignItems="center">
                    <Box>
                      <Typography fontWeight="bold">Schema Match</Typography>
                      <Typography variant="pi" textColor="neutral500">
                        Verify content type schemas are compatible before syncing
                      </Typography>
                    </Box>
                    <Switch
                      checked={enforcement.enforceSchemaMatch}
                      onCheckedChange={(checked) => setEnforcement((p) => ({ ...p, enforceSchemaMatch: checked }))}
                    />
                  </Flex>
                  {enforcement.enforceSchemaMatch && (
                    <Box paddingTop={3}>
                      <Field.Root>
                        <Field.Label>Match Mode</Field.Label>
                        <SingleSelect
                          value={enforcement.schemaMatchMode}
                          onChange={(value) => setEnforcement((p) => ({ ...p, schemaMatchMode: value }))}
                        >
                          <SingleSelectOption value="strict">Strict (exact match)</SingleSelectOption>
                          <SingleSelectOption value="compatible">Compatible (allow extra fields)</SingleSelectOption>
                          <SingleSelectOption value="none">None (skip check)</SingleSelectOption>
                        </SingleSelect>
                      </Field.Root>
                    </Box>
                  )}
                </Box>

                {/* Version Check */}
                <Box padding={4} background="neutral0" hasRadius>
                  <Flex justifyContent="space-between" alignItems="center">
                    <Box>
                      <Typography fontWeight="bold">Version Check</Typography>
                      <Typography variant="pi" textColor="neutral500">
                        Ensure Strapi versions are compatible
                      </Typography>
                    </Box>
                    <Switch
                      checked={enforcement.enforceVersionCheck}
                      onCheckedChange={(checked) => setEnforcement((p) => ({ ...p, enforceVersionCheck: checked }))}
                    />
                  </Flex>
                  {enforcement.enforceVersionCheck && (
                    <Box paddingTop={3}>
                      <Field.Root>
                        <Field.Label>Allowed Version Drift</Field.Label>
                        <SingleSelect
                          value={enforcement.allowedVersionDrift}
                          onChange={(value) => setEnforcement((p) => ({ ...p, allowedVersionDrift: value }))}
                        >
                          <SingleSelectOption value="exact">Exact (must match)</SingleSelectOption>
                          <SingleSelectOption value="minor">Minor (same major)</SingleSelectOption>
                          <SingleSelectOption value="major">Major (allow any)</SingleSelectOption>
                          <SingleSelectOption value="none">None (skip check)</SingleSelectOption>
                        </SingleSelect>
                      </Field.Root>
                    </Box>
                  )}
                </Box>

                {/* DateTime Sync */}
                <Box padding={4} background="neutral0" hasRadius>
                  <Flex justifyContent="space-between" alignItems="center">
                    <Box>
                      <Typography fontWeight="bold">DateTime Sync</Typography>
                      <Typography variant="pi" textColor="neutral500">
                        Verify server clocks are synchronized
                      </Typography>
                    </Box>
                    <Switch
                      checked={enforcement.enforceDateTimeSync}
                      onCheckedChange={(checked) => setEnforcement((p) => ({ ...p, enforceDateTimeSync: checked }))}
                    />
                  </Flex>
                  {enforcement.enforceDateTimeSync && (
                    <Box paddingTop={3}>
                      <Field.Root>
                        <Field.Label>Max Time Drift (ms)</Field.Label>
                        <NumberInput
                          value={enforcement.maxTimeDriftMs}
                          onValueChange={(value) => setEnforcement((p) => ({ ...p, maxTimeDriftMs: value }))}
                          min={1000}
                          max={86400000}
                        />
                        <Field.Hint>Maximum allowed time difference (1000ms - 86400000ms)</Field.Hint>
                      </Field.Root>
                    </Box>
                  )}
                </Box>

                {/* Block on Failure */}
                <Box padding={4} background="neutral0" hasRadius>
                  <Flex justifyContent="space-between" alignItems="center">
                    <Box>
                      <Typography fontWeight="bold">Block on Failure</Typography>
                      <Typography variant="pi" textColor="neutral500">
                        Prevent sync if enforcement checks fail
                      </Typography>
                    </Box>
                    <Switch
                      checked={enforcement.blockOnFailure}
                      onCheckedChange={(checked) => setEnforcement((p) => ({ ...p, blockOnFailure: checked }))}
                    />
                  </Flex>
                </Box>

                <Button onClick={handleSaveEnforcement} loading={saving}>
                  Save Enforcement Settings
                </Button>
              </Flex>
            </Box>
          </Tabs.Content>

          {/* Alerts Tab */}
          <Tabs.Content value="alerts">
            <Box>
              <Typography variant="delta" paddingBottom={2}>Alert Notifications</Typography>
              <Typography variant="omega" textColor="neutral600" paddingBottom={4}>
                Configure notifications for sync success and failure events.
              </Typography>

              <Flex direction="column" gap={4}>
                <Flex justifyContent="space-between" alignItems="center">
                  <Typography fontWeight="bold">Enable Alerts</Typography>
                  <Switch
                    checked={alerts.enabled}
                    onCheckedChange={(checked) => setAlerts((p) => ({ ...p, enabled: checked }))}
                  />
                </Flex>

                {alerts.enabled && (
                  <>
                    {/* Strapi Notifications */}
                    <Box padding={4} background="neutral0" hasRadius>
                      <Flex justifyContent="space-between" alignItems="center">
                        <Box>
                          <Typography fontWeight="bold">Strapi Notifications</Typography>
                          <Typography variant="pi" textColor="neutral500">
                            Log events to sync log (visible in admin)
                          </Typography>
                        </Box>
                        <Switch
                          checked={alerts.channels.strapiNotification.enabled}
                          onCheckedChange={(checked) => setAlerts((p) => ({
                            ...p,
                            channels: {
                              ...p.channels,
                              strapiNotification: { ...p.channels.strapiNotification, enabled: checked },
                            },
                          }))}
                        />
                      </Flex>
                      {alerts.channels.strapiNotification.enabled && (
                        <Flex gap={4} paddingTop={3}>
                          <Flex alignItems="center" gap={2}>
                            <Switch
                              checked={alerts.channels.strapiNotification.onSuccess}
                              onCheckedChange={(checked) => setAlerts((p) => ({
                                ...p,
                                channels: {
                                  ...p.channels,
                                  strapiNotification: { ...p.channels.strapiNotification, onSuccess: checked },
                                },
                              }))}
                            />
                            <Typography variant="pi">On Success</Typography>
                          </Flex>
                          <Flex alignItems="center" gap={2}>
                            <Switch
                              checked={alerts.channels.strapiNotification.onFailure}
                              onCheckedChange={(checked) => setAlerts((p) => ({
                                ...p,
                                channels: {
                                  ...p.channels,
                                  strapiNotification: { ...p.channels.strapiNotification, onFailure: checked },
                                },
                              }))}
                            />
                            <Typography variant="pi">On Failure</Typography>
                          </Flex>
                          <TextButton onClick={() => handleTestAlert('strapiNotification')}>
                            Test
                          </TextButton>
                        </Flex>
                      )}
                    </Box>

                    {/* Email */}
                    <Box padding={4} background="neutral0" hasRadius>
                      <Flex justifyContent="space-between" alignItems="center">
                        <Box>
                          <Typography fontWeight="bold">Email Notifications</Typography>
                          <Typography variant="pi" textColor="neutral500">
                            Send email alerts using Strapi's email plugin
                          </Typography>
                        </Box>
                        <Switch
                          checked={alerts.channels.email.enabled}
                          onCheckedChange={(checked) => setAlerts((p) => ({
                            ...p,
                            channels: {
                              ...p.channels,
                              email: { ...p.channels.email, enabled: checked },
                            },
                          }))}
                        />
                      </Flex>
                      {alerts.channels.email.enabled && (
                        <Box paddingTop={3}>
                          {/* Email Plugin Status */}
                          {!alerts.emailPluginConfigured && (
                            <Alert
                              variant="warning"
                              title="Email Plugin Not Configured"
                              style={{ marginBottom: '16px' }}
                            >
                              <Typography variant="omega">
                                Strapi's email plugin is not configured. To enable email alerts, install and configure an email provider:
                              </Typography>
                              <ul style={{ paddingLeft: '20px', marginTop: '8px' }}>
                                <li><Typography variant="pi">@strapi/provider-email-sendgrid</Typography></li>
                                <li><Typography variant="pi">@strapi/provider-email-mailgun</Typography></li>
                                <li><Typography variant="pi">@strapi/provider-email-amazon-ses</Typography></li>
                                <li><Typography variant="pi">@strapi/provider-email-nodemailer</Typography></li>
                              </ul>
                              <Typography variant="pi" paddingTop={2}>
                                See: <a href="https://docs.strapi.io/dev-docs/providers" target="_blank" rel="noopener noreferrer">Strapi Email Providers Documentation</a>
                              </Typography>
                            </Alert>
                          )}
                          {alerts.emailPluginConfigured && (
                            <Alert variant="success" title="Email Plugin Configured" style={{ marginBottom: '16px' }}>
                              <Typography variant="omega">
                                Strapi's email plugin is configured and ready to send alerts.
                              </Typography>
                            </Alert>
                          )}

                          {/* Recipients */}
                          <Field.Root>
                            <Field.Label>Email Recipients (comma-separated)</Field.Label>
                            <TextInput
                              placeholder="admin@example.com, alerts@example.com"
                              value={emailRecipients}
                              onChange={(e) => setEmailRecipients(e.target.value)}
                            />
                            <Field.Hint>Enter email addresses to receive sync alerts</Field.Hint>
                          </Field.Root>

                          {/* Optional From Address */}
                          <Box paddingTop={3}>
                            <Field.Root>
                              <Field.Label>From Email Address (optional)</Field.Label>
                              <TextInput
                                placeholder="Leave empty to use default"
                                value={alerts.channels.email.from || ''}
                                onChange={(e) => setAlerts((p) => ({
                                  ...p,
                                  channels: {
                                    ...p.channels,
                                    email: { ...p.channels.email, from: e.target.value },
                                  },
                                }))}
                              />
                              <Field.Hint>Override the default sender address from Strapi email plugin</Field.Hint>
                            </Field.Root>
                          </Box>

                          {/* Triggers */}
                          <Box paddingTop={4}>
                            <Typography variant="delta" paddingBottom={2}>Alert Triggers</Typography>
                            <Flex gap={4}>
                              <Flex alignItems="center" gap={2}>
                                <Switch
                                  checked={alerts.channels.email.onSuccess}
                                  onCheckedChange={(checked) => setAlerts((p) => ({
                                    ...p,
                                    channels: {
                                      ...p.channels,
                                      email: { ...p.channels.email, onSuccess: checked },
                                    },
                                  }))}
                                />
                                <Typography variant="pi">On Success</Typography>
                              </Flex>
                              <Flex alignItems="center" gap={2}>
                                <Switch
                                  checked={alerts.channels.email.onFailure}
                                  onCheckedChange={(checked) => setAlerts((p) => ({
                                    ...p,
                                    channels: {
                                      ...p.channels,
                                      email: { ...p.channels.email, onFailure: checked },
                                    },
                                  }))}
                                />
                                <Typography variant="pi">On Failure</Typography>
                              </Flex>
                              <TextButton 
                                onClick={() => handleTestAlert('email')}
                                disabled={!alerts.emailPluginConfigured}
                              >
                                Send Test Email
                              </TextButton>
                            </Flex>
                          </Box>
                        </Box>
                      )}
                    </Box>

                    {/* Webhook */}
                    <Box padding={4} background="neutral0" hasRadius>
                      <Flex justifyContent="space-between" alignItems="center">
                        <Box>
                          <Typography fontWeight="bold">Webhook Notifications</Typography>
                          <Typography variant="pi" textColor="neutral500">
                            Send alerts to a custom webhook endpoint
                          </Typography>
                        </Box>
                        <Switch
                          checked={alerts.channels.webhook.enabled}
                          onCheckedChange={(checked) => setAlerts((p) => ({
                            ...p,
                            channels: {
                              ...p.channels,
                              webhook: { ...p.channels.webhook, enabled: checked },
                            },
                          }))}
                        />
                      </Flex>
                      {alerts.channels.webhook.enabled && (
                        <Box paddingTop={3}>
                          <Field.Root>
                            <Field.Label>Webhook URL</Field.Label>
                            <TextInput
                              placeholder="https://hooks.example.com/sync-alerts"
                              value={alerts.channels.webhook.url}
                              onChange={(e) => setAlerts((p) => ({
                                ...p,
                                channels: {
                                  ...p.channels,
                                  webhook: { ...p.channels.webhook, url: e.target.value },
                                },
                              }))}
                            />
                          </Field.Root>
                          <Flex gap={4} paddingTop={3}>
                            <Flex alignItems="center" gap={2}>
                              <Switch
                                checked={alerts.channels.webhook.onSuccess}
                                onCheckedChange={(checked) => setAlerts((p) => ({
                                  ...p,
                                  channels: {
                                    ...p.channels,
                                    webhook: { ...p.channels.webhook, onSuccess: checked },
                                  },
                                }))}
                              />
                              <Typography variant="pi">On Success</Typography>
                            </Flex>
                            <Flex alignItems="center" gap={2}>
                              <Switch
                                checked={alerts.channels.webhook.onFailure}
                                onCheckedChange={(checked) => setAlerts((p) => ({
                                  ...p,
                                  channels: {
                                    ...p.channels,
                                    webhook: { ...p.channels.webhook, onFailure: checked },
                                  },
                                }))}
                              />
                              <Typography variant="pi">On Failure</Typography>
                            </Flex>
                            <TextButton onClick={() => handleTestAlert('webhook')}>
                              Test
                            </TextButton>
                          </Flex>
                        </Box>
                      )}
                    </Box>
                  </>
                )}

                <Button onClick={handleSaveAlerts} loading={saving}>
                  Save Alert Settings
                </Button>
              </Flex>
            </Box>
          </Tabs.Content>
        </Box>
      </Tabs.Root>
    </Box>
  );
};

export { ConfigTab };
export default ConfigTab;
