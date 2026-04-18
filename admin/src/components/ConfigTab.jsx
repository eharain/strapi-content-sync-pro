import { useState, useEffect } from 'react';
import {
  Box,
  Flex,
  Typography,
  TextInput,
  SingleSelect,
  SingleSelectOption,
  Button,
  Alert,
  Field,
} from '@strapi/design-system';
import { useFetchClient } from '@strapi/strapi/admin';

const PLUGIN_ID = 'strapi-to-strapi-data-sync';

const ConfigTab = () => {
  const { get, post } = useFetchClient();

  const [config, setConfig] = useState({
    baseUrl: '',
    apiToken: '',
    syncDirection: 'bidirectional',
    instanceId: '',
    sharedSecret: '',
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);

  useEffect(() => {
    fetchConfig();
  }, []);

  const fetchConfig = async () => {
    try {
      const { data } = await get(`/${PLUGIN_ID}/config`);
      if (data.data) {
        setConfig((prev) => ({ ...prev, ...data.data }));
      }
    } catch (err) {
      console.error('Failed to fetch config', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const payload = {};
      if (config.baseUrl) payload.baseUrl = config.baseUrl;
      if (config.apiToken && config.apiToken !== '••••••••') payload.apiToken = config.apiToken;
      if (config.syncDirection) payload.syncDirection = config.syncDirection;
      if (config.instanceId) payload.instanceId = config.instanceId;
      if (config.sharedSecret && config.sharedSecret !== '••••••••') payload.sharedSecret = config.sharedSecret;

      await post(`/${PLUGIN_ID}/config`, payload);
      setMessage({ type: 'success', text: 'Configuration saved successfully' });
      fetchConfig();
    } catch {
      setMessage({ type: 'danger', text: 'Failed to save configuration' });
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <Typography>Loading…</Typography>;

  return (
    <Box>
      <Typography variant="beta" tag="h2">Remote Server Configuration</Typography>

      {message && (
        <Box paddingTop={4}>
          <Alert variant={message.type} closeLabel="Close" onClose={() => setMessage(null)}>
            {message.text}
          </Alert>
        </Box>
      )}

      <Box paddingTop={4}>
        <Flex direction="column" gap={4}>
          <Field.Root>
            <Field.Label>Base URL</Field.Label>
            <TextInput
              placeholder="https://remote-strapi.example.com"
              value={config.baseUrl}
              onChange={(e) => setConfig((p) => ({ ...p, baseUrl: e.target.value }))}
            />
            <Field.Hint>The base URL of the remote Strapi instance</Field.Hint>
          </Field.Root>

          <Field.Root>
            <Field.Label>API Token</Field.Label>
            <TextInput
              type="password"
              placeholder="Enter API token"
              value={config.apiToken}
              onChange={(e) => setConfig((p) => ({ ...p, apiToken: e.target.value }))}
            />
          </Field.Root>

          <Field.Root>
            <Field.Label>Sync Direction</Field.Label>
            <SingleSelect
              value={config.syncDirection}
              onChange={(value) => setConfig((p) => ({ ...p, syncDirection: value }))}
            >
              <SingleSelectOption value="push">Push</SingleSelectOption>
              <SingleSelectOption value="pull">Pull</SingleSelectOption>
              <SingleSelectOption value="bidirectional">Bidirectional</SingleSelectOption>
            </SingleSelect>
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
          </Field.Root>

          <Button onClick={handleSave} loading={saving}>
            Save Configuration
          </Button>
        </Flex>
      </Box>
    </Box>
  );
};

export { ConfigTab };
export default ConfigTab;
