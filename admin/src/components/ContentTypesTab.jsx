import { useState, useEffect } from 'react';
import {
  Box,
  Flex,
  Typography,
  Button,
  Alert,
  Switch,
  Badge,
} from '@strapi/design-system';
import { useFetchClient } from '@strapi/strapi/admin';

const PLUGIN_ID = 'strapi-content-sync-pro';

const ContentTypesTab = () => {
  const { get, post } = useFetchClient();

  const [contentTypes, setContentTypes] = useState([]);
  const [enabledTypes, setEnabledTypes] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState(null);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [ctRes, scRes, profilesRes] = await Promise.all([
        get(`/${PLUGIN_ID}/content-types`),
        get(`/${PLUGIN_ID}/sync-config`),
        get(`/${PLUGIN_ID}/sync-profiles`),
      ]);
      setContentTypes(ctRes.data.data || []);
      const config = scRes.data.data || { contentTypes: [] };
      setEnabledTypes(config.contentTypes?.filter(ct => ct.enabled).map(ct => ct.uid) || []);
      setProfiles(profilesRes.data.data || []);
    } catch (err) {
      console.error('Failed to load data', err);
      setMessage({ type: 'danger', text: err?.response?.data?.error?.message || err.message || 'Failed to load data' });
    } finally {
      setLoading(false);
    }
  };

  const isEnabled = (uid) => enabledTypes.includes(uid);

  const getActiveProfile = (uid) => profiles.find(p => p.contentType === uid && p.isActive);

  const getProfileCount = (uid) => profiles.filter(p => p.contentType === uid).length;

  const handleToggle = async (uid) => {
    const wasEnabled = isEnabled(uid);
    const newEnabledTypes = wasEnabled
      ? enabledTypes.filter(u => u !== uid)
      : [...enabledTypes, uid];

    setEnabledTypes(newEnabledTypes);

    try {
      // Save the config
      const contentTypesConfig = newEnabledTypes.map(u => ({
        uid: u,
        enabled: true,
      }));
      await post(`/${PLUGIN_ID}/sync-config`, { contentTypes: contentTypesConfig });

      // Auto-generate default profiles if enabling and no profiles exist
      if (!wasEnabled) {
        const existingProfiles = profiles.filter(p => p.contentType === uid);
        if (existingProfiles.length === 0) {
          await post(`/${PLUGIN_ID}/sync-profiles/auto-generate`, { contentType: uid });
          // Reload profiles
          const profilesRes = await get(`/${PLUGIN_ID}/sync-profiles`);
          setProfiles(profilesRes.data.data || []);
        }
      }

      setMessage({ 
        type: 'success', 
        text: wasEnabled 
          ? `${uid} disabled for sync` 
          : `${uid} enabled for sync. Default profiles created.`
      });
    } catch (err) {
      // Revert on error
      setEnabledTypes(enabledTypes);
      setMessage({ type: 'danger', text: err?.response?.data?.error?.message || err.message || 'Failed to update configuration' });
    }
  };

  if (loading) return <Typography>Loading…</Typography>;

  return (
    <Box>
      <Typography variant="beta" tag="h2">Content Types</Typography>
      <Box paddingTop={2} paddingBottom={4}>
        <Typography variant="omega" textColor="neutral600">
          Enable content types for synchronization. When enabled, default sync profiles (Full Push, Full Pull, Bidirectional) 
          are automatically created. Configure sync behavior in the <strong>Sync Profiles</strong> tab.
        </Typography>
      </Box>

      {message && (
        <Box paddingBottom={4}>
          <Alert variant={message.type} closeLabel="Close" onClose={() => setMessage(null)}>
            {message.text}
          </Alert>
        </Box>
      )}

      <Box>
        {contentTypes.map((ct) => {
          const enabled = isEnabled(ct.uid);
          const activeProfile = getActiveProfile(ct.uid);
          const profileCount = getProfileCount(ct.uid);

          return (
            <Box
              key={ct.uid}
              padding={4}
              background="neutral0"
              shadow="filterShadow"
              marginBottom={3}
              hasRadius
            >
              <Flex justifyContent="space-between" alignItems="center">
                <Box>
                  <Flex alignItems="center" gap={2}>
                    <Typography variant="delta">{ct.displayName}</Typography>
                    {enabled && (
                      <Badge active>{profileCount} profile{profileCount !== 1 ? 's' : ''}</Badge>
                    )}
                  </Flex>
                  <Typography variant="pi" textColor="neutral500">{ct.uid}</Typography>
                  {enabled && activeProfile && (
                    <Box paddingTop={1}>
                      <Typography variant="pi" textColor="success600">
                        Active: {activeProfile.name}
                      </Typography>
                    </Box>
                  )}
                </Box>
                <Switch
                  checked={enabled}
                  onCheckedChange={() => handleToggle(ct.uid)}
                  visibleLabels
                />
              </Flex>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
};

export { ContentTypesTab };
export default ContentTypesTab;
