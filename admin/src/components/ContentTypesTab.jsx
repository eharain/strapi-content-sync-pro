import { useState, useEffect } from 'react';
import {
  Box,
  Flex,
  Typography,
  Button,
  Alert,
  Switch,
  Badge,
  TextInput,
  Modal,
  Radio,
  Checkbox,
  Loader,
} from '@strapi/design-system';
import { useFetchClient } from '@strapi/strapi/admin';
import { useNavigate } from 'react-router-dom';
import { resolvePath } from '../nav';

const PLUGIN_ID = 'strapi-content-sync-pro';

const ContentTypesTab = () => {
  const { get, post } = useFetchClient();
  const navigate = useNavigate();

  const [contentTypes, setContentTypes] = useState([]);
  const [enabledTypes, setEnabledTypes] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState(null);
  const [search, setSearch] = useState('');
  const [strategy, setStrategy] = useState(null);

  // Enable dialog state
  const [enableTarget, setEnableTarget] = useState(null);   // { uid, displayName }
  const [withDependencies, setWithDependencies] = useState(false);
  const [profileMode, setProfileMode] = useState('quick');  // 'quick' | 'none'
  const [preview, setPreview] = useState(null);
  const [previewing, setPreviewing] = useState(false);
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  // Re-preview whenever the dependency choice changes, so the summary on screen
  // always describes the action the buttons would take.
  useEffect(() => {
    if (!enableTarget) return;
    loadPreview(enableTarget.uid, withDependencies);
  }, [enableTarget, withDependencies]);

  const loadData = async () => {
    try {
      const [ctRes, scRes, profilesRes, strategyRes] = await Promise.all([
        get(`/${PLUGIN_ID}/content-types`),
        get(`/${PLUGIN_ID}/sync-config`),
        get(`/${PLUGIN_ID}/sync-profiles`),
        get(`/${PLUGIN_ID}/strategy`),
      ]);
      setContentTypes(ctRes.data.data || []);
      const config = scRes.data.data || { contentTypes: [] };
      setEnabledTypes(config.contentTypes?.filter(ct => ct.enabled).map(ct => ct.uid) || []);
      setProfiles(profilesRes.data.data || []);
      setStrategy(strategyRes.data.data || null);
    } catch (err) {
      console.error('Failed to load data', err);
      setMessage({ type: 'danger', text: err?.response?.data?.error?.message || err.message || 'Failed to load data' });
    } finally {
      setLoading(false);
    }
  };

  const loadPreview = async (uid, deps) => {
    setPreviewing(true);
    try {
      const res = await post(`/${PLUGIN_ID}/sync-config/enable-preview`, {
        uid,
        withDependencies: deps,
      });
      setPreview(res.data.data);
    } catch (err) {
      setPreview(null);
      setMessage({ type: 'danger', text: err?.response?.data?.error?.message || err.message || 'Failed to preview' });
    } finally {
      setPreviewing(false);
    }
  };

  const isEnabled = (uid) => enabledTypes.includes(uid);

  const getActiveProfile = (uid) => profiles.find(p => p.contentType === uid && p.isActive);

  const getProfileCount = (uid) => profiles.filter(p => p.contentType === uid).length;

  const openEnableDialog = (ct) => {
    setEnableTarget({ uid: ct.uid, displayName: ct.displayName });
    setWithDependencies(false);
    setProfileMode('quick');
    setPreview(null);
  };

  const closeEnableDialog = () => {
    setEnableTarget(null);
    setPreview(null);
  };

  const handleToggle = async (ct) => {
    if (!isEnabled(ct.uid)) {
      // Enabling is a decision (only this type, or its direct dependencies too),
      // so it goes through the preview dialog instead of firing immediately.
      openEnableDialog(ct);
      return;
    }
    await handleDisable(ct.uid);
  };

  const handleDisable = async (uid) => {
    try {
      const res = await post(`/${PLUGIN_ID}/sync-config/disable`, { uid });
      const data = res.data.data || {};
      setEnabledTypes((prev) => prev.filter((u) => u !== uid));

      const orphaned = data.nowOutOfScope || [];
      setMessage({
        type: orphaned.length > 0 ? 'warning' : 'success',
        text: orphaned.length > 0
          ? `${uid} disabled. It is still a dependency of ${orphaned.map((o) => o.referencedBy).join(', ')} — those relations will no longer be linked.`
          : `${uid} disabled for sync. Its profiles and field selection are kept.`,
      });
    } catch (err) {
      setMessage({ type: 'danger', text: err?.response?.data?.error?.message || err.message || 'Failed to update configuration' });
    }
  };

  const handleApplyEnable = async (editNow) => {
    if (!enableTarget) return;
    setApplying(true);
    try {
      const res = await post(`/${PLUGIN_ID}/sync-config/enable`, {
        uid: enableTarget.uid,
        withDependencies,
        profileMode: editNow ? 'none' : profileMode,
      });
      const data = res.data.data || {};
      const enabledUids = (data.toEnable || []).map((t) => t.uid);
      setEnabledTypes((prev) => [...new Set([...prev, ...enabledUids])]);

      const profilesRes = await get(`/${PLUGIN_ID}/sync-profiles`);
      setProfiles(profilesRes.data.data || []);

      closeEnableDialog();

      if (editNow) {
        // "Create + edit now": land in the profile editor with the content type
        // preselected instead of accepting the generated defaults.
        navigate(resolvePath(`configure/profiles?contentType=${encodeURIComponent(enableTarget.uid)}&create=1`));
        return;
      }

      setMessage({
        type: 'success',
        text: `Enabled ${enabledUids.length} content type${enabledUids.length === 1 ? '' : 's'}`
          + (profileMode === 'quick' ? ' with default profiles.' : '. No profiles created yet.'),
      });
    } catch (err) {
      setMessage({ type: 'danger', text: err?.response?.data?.error?.message || err.message || 'Failed to enable content type' });
    } finally {
      setApplying(false);
    }
  };

  const filteredTypes = contentTypes.filter((ct) => {
    if (!search.trim()) return true;
    const q = search.trim().toLowerCase();
    return (ct.displayName || '').toLowerCase().includes(q) || ct.uid.toLowerCase().includes(q);
  });

  if (loading) return <Typography>Loading…</Typography>;

  const depthRule = strategy?.dependencies?.depth ?? 1;

  return (
    <Box>
      <Typography variant="beta" tag="h2">Content Types</Typography>
      <Box paddingTop={2} paddingBottom={4}>
        <Typography variant="omega" textColor="neutral600">
          Enable content types for synchronization. When enabling, you can pull in the type's{' '}
          <strong>direct dependencies</strong> (depth {depthRule}) so its relations have somewhere to point.
          Configure sync behavior in the <strong>Sync Profiles</strong> tab.
        </Typography>
      </Box>

      {message && (
        <Box paddingBottom={4}>
          <Alert variant={message.type} closeLabel="Close" onClose={() => setMessage(null)}>
            {message.text}
          </Alert>
        </Box>
      )}

      <Box paddingBottom={4}>
        <TextInput
          placeholder="Search by name or UID…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          label="Search"
          size="S"
          style={{ maxWidth: 320 }}
        />
      </Box>

      <Box>
        {filteredTypes.map((ct) => {
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
                  {enabled && !activeProfile && (
                    <Box paddingTop={1}>
                      <Typography variant="pi" textColor="warning600">
                        No active profile — this type will not sync until one is activated.
                      </Typography>
                    </Box>
                  )}
                </Box>
                <Switch
                  checked={enabled}
                  onCheckedChange={() => handleToggle(ct)}
                  visibleLabels
                />
              </Flex>
            </Box>
          );
        })}
        {contentTypes.length > 0 && search.trim() && filteredTypes.length === 0 && (
          <Box padding={4} background="neutral0" hasRadius>
            <Typography textColor="neutral500">No content types match the search.</Typography>
          </Box>
        )}
      </Box>

      {/* Enable dialog — choose scope, review the preview, then apply */}
      {enableTarget && (
        <Modal.Root open onOpenChange={(open) => (!open ? closeEnableDialog() : null)}>
          <Modal.Content>
            <Modal.Header>
              <Modal.Title>Enable “{enableTarget.displayName}” for sync</Modal.Title>
            </Modal.Header>
            <Modal.Body>
              <Box paddingBottom={4}>
                <Typography variant="delta">What to enable</Typography>
                <Box paddingTop={2}>
                  <Radio.Group
                    value={withDependencies ? 'with_deps' : 'only'}
                    onValueChange={(value) => setWithDependencies(value === 'with_deps')}
                  >
                    <Radio.Item value="only">Only this content type</Radio.Item>
                    <Radio.Item value="with_deps">
                      This content type + its direct dependencies (depth {depthRule})
                    </Radio.Item>
                  </Radio.Group>
                </Box>
                <Box paddingTop={2}>
                  <Typography variant="pi" textColor="neutral500">
                    Dependency expansion is one level deep and follows owner-side relations only.
                    Inverse sides (mappedBy / inversedBy) and self-references are never expanded, so
                    the list below is exactly what will be enabled — no hidden cascade.
                  </Typography>
                </Box>
              </Box>

              {/* Preview summary */}
              <Box padding={4} background="neutral100" hasRadius>
                {previewing ? (
                  <Flex gap={2} alignItems="center"><Loader small>Loading</Loader><Typography>Building preview…</Typography></Flex>
                ) : !preview ? (
                  <Typography textColor="neutral500">No preview available.</Typography>
                ) : (
                  <Box>
                    <PreviewList
                      title="Will be enabled"
                      tone="success600"
                      items={preview.toEnable}
                      empty="Nothing new — already in scope."
                    />
                    <PreviewList
                      title="Already enabled"
                      tone="neutral600"
                      items={preview.alreadyEnabled}
                      empty="None."
                    />
                    <PreviewList
                      title="Skipped"
                      tone="warning600"
                      items={preview.skipped}
                      empty="None."
                      showReason
                    />
                  </Box>
                )}
              </Box>

              <Box paddingTop={4}>
                <Checkbox
                  checked={profileMode === 'quick'}
                  onCheckedChange={(checked) => setProfileMode(checked ? 'quick' : 'none')}
                >
                  Create default sync profiles (Full Push, Full Pull, Bidirectional)
                </Checkbox>
                <Box paddingTop={1}>
                  <Typography variant="pi" textColor="neutral500">
                    Profiles are never locked by auto-generation — everything they set can be edited
                    afterwards in the Sync Profiles tab.
                  </Typography>
                </Box>
              </Box>
            </Modal.Body>
            <Modal.Footer>
              <Button variant="tertiary" onClick={closeEnableDialog}>Cancel</Button>
              <Button
                variant="secondary"
                onClick={() => handleApplyEnable(true)}
                disabled={applying || previewing || !preview?.toEnable?.length}
              >
                Enable + configure now
              </Button>
              <Button
                onClick={() => handleApplyEnable(false)}
                loading={applying}
                disabled={applying || previewing || !preview?.toEnable?.length}
              >
                {profileMode === 'quick' ? 'Enable with quick defaults' : 'Enable only'}
              </Button>
            </Modal.Footer>
          </Modal.Content>
        </Modal.Root>
      )}
    </Box>
  );
};

const PreviewList = ({ title, tone, items = [], empty, showReason = false }) => (
  <Box paddingBottom={3}>
    <Typography variant="sigma" textColor={tone}>
      {title} ({items.length})
    </Typography>
    <Box paddingTop={1}>
      {items.length === 0 ? (
        <Typography variant="pi" textColor="neutral500">{empty}</Typography>
      ) : (
        items.map((item) => (
          <Box key={`${item.uid}:${item.field || ''}`} paddingBottom={1}>
            <Typography variant="pi">
              {item.displayName || item.uid}
              {item.via && <Typography variant="pi" textColor="neutral500"> — via {item.via}{item.field ? `.${item.field}` : ''}</Typography>}
            </Typography>
            {showReason && item.reasonLabel && (
              <Box>
                <Typography variant="pi" textColor="neutral500">{item.reasonLabel}</Typography>
              </Box>
            )}
          </Box>
        ))
      )}
    </Box>
  </Box>
);

export { ContentTypesTab };
export default ContentTypesTab;
