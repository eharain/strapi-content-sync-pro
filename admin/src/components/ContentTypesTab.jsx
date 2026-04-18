import { useState, useEffect } from 'react';
import {
  Box,
  Flex,
  Typography,
  Button,
  Alert,
  Checkbox,
  SingleSelect,
  SingleSelectOption,
  Field,
} from '@strapi/design-system';
import { useFetchClient } from '@strapi/strapi/admin';

const PLUGIN_ID = 'strapi-to-strapi-data-sync';

const ContentTypesTab = () => {
  const { get, post } = useFetchClient();

  const [contentTypes, setContentTypes] = useState([]);
  const [syncConfig, setSyncConfig] = useState({ contentTypes: [], conflictStrategy: 'latest' });
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState(null);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [ctRes, scRes] = await Promise.all([
        get(`/${PLUGIN_ID}/content-types`),
        get(`/${PLUGIN_ID}/sync-config`),
      ]);
      setContentTypes(ctRes.data.data || []);
      setSyncConfig(scRes.data.data || { contentTypes: [], conflictStrategy: 'latest' });
    } catch (err) {
      console.error('Failed to load data', err);
    } finally {
      setLoading(false);
    }
  };

  const getCtConfig = (uid) =>
    syncConfig.contentTypes.find((ct) => ct.uid === uid) || {
      uid,
      direction: 'both',
      fields: [],
      enabled: false,
    };

  const updateCtConfig = (uid, updates) => {
    setSyncConfig((prev) => {
      const exists = prev.contentTypes.find((ct) => ct.uid === uid);
      if (exists) {
        return {
          ...prev,
          contentTypes: prev.contentTypes.map((ct) =>
            ct.uid === uid ? { ...ct, ...updates } : ct
          ),
        };
      }
      return {
        ...prev,
        contentTypes: [
          ...prev.contentTypes,
          { uid, direction: 'both', fields: [], enabled: false, ...updates },
        ],
      };
    });
  };

  const handleSave = async () => {
    try {
      await post(`/${PLUGIN_ID}/sync-config`, syncConfig);
      setMessage({ type: 'success', text: 'Sync configuration saved' });
    } catch {
      setMessage({ type: 'danger', text: 'Failed to save sync configuration' });
    }
  };

  if (loading) return <Typography>Loading…</Typography>;

  return (
    <Box>
      <Typography variant="beta" tag="h2">Content Types</Typography>

      {message && (
        <Box paddingTop={4}>
          <Alert variant={message.type} closeLabel="Close" onClose={() => setMessage(null)}>
            {message.text}
          </Alert>
        </Box>
      )}

      <Box paddingTop={4}>
        <Field.Root>
          <Field.Label>Conflict Strategy</Field.Label>
          <SingleSelect
            value={syncConfig.conflictStrategy}
            onChange={(value) => setSyncConfig((p) => ({ ...p, conflictStrategy: value }))}
          >
            <SingleSelectOption value="latest">Latest wins</SingleSelectOption>
            <SingleSelectOption value="local_wins">Local wins</SingleSelectOption>
            <SingleSelectOption value="remote_wins">Remote wins</SingleSelectOption>
          </SingleSelect>
        </Field.Root>
      </Box>

      <Box paddingTop={6}>
        {contentTypes.map((ct) => {
          const cfg = getCtConfig(ct.uid);
          return (
            <Box
              key={ct.uid}
              padding={4}
              background="neutral0"
              shadow="filterShadow"
              marginBottom={4}
              hasRadius
            >
              <Flex justifyContent="space-between" alignItems="center">
                <Box>
                  <Typography variant="delta">{ct.displayName}</Typography>
                  <Typography variant="pi" textColor="neutral500">{ct.uid}</Typography>
                </Box>
                <Checkbox
                  checked={cfg.enabled}
                  onChange={() => updateCtConfig(ct.uid, { enabled: !cfg.enabled })}
                >
                  Enabled
                </Checkbox>
              </Flex>

              {cfg.enabled && (
                <Box paddingTop={4}>
                  <Field.Root>
                    <Field.Label>Direction</Field.Label>
                    <SingleSelect
                      value={cfg.direction}
                      onChange={(value) => updateCtConfig(ct.uid, { direction: value })}
                    >
                      <SingleSelectOption value="push">Push</SingleSelectOption>
                      <SingleSelectOption value="pull">Pull</SingleSelectOption>
                      <SingleSelectOption value="both">Both</SingleSelectOption>
                    </SingleSelect>
                  </Field.Root>
                </Box>
              )}
            </Box>
          );
        })}

        <Button onClick={handleSave}>Save Sync Configuration</Button>
      </Box>
    </Box>
  );
};

export { ContentTypesTab };
export default ContentTypesTab;
