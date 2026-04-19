import { useState, useEffect } from 'react';
import {
  Box,
  Flex,
  Typography,
  Button,
  Alert,
  SingleSelect,
  SingleSelectOption,
  Field,
  Switch,
  Badge,
  Table,
  Thead,
  Tbody,
  Tr,
  Th,
  Td,
  Tabs,
  NumberInput,
  Modal,
  IconButton,
} from '@strapi/design-system';
import { Play, Clock, Cog } from '@strapi/icons';
import { useFetchClient } from '@strapi/strapi/admin';

const PLUGIN_ID = 'strapi-to-strapi-data-sync';

const EXECUTION_MODE_OPTIONS = [
  { value: 'on_demand', label: 'On Demand (Manual)' },
  { value: 'scheduled', label: 'Scheduled' },
  { value: 'live', label: 'Live (Real-time)' },
];

const SyncTab = () => {
  const { get, post, put } = useFetchClient();

  const [syncing, setSyncing] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [message, setMessage] = useState(null);

  // Profiles and execution status
  const [profiles, setProfiles] = useState([]);
  const [executionStatus, setExecutionStatus] = useState([]);
  const [globalSettings, setGlobalSettings] = useState({});
  const [loading, setLoading] = useState(true);

  // Execution settings modal
  const [settingsModalOpen, setSettingsModalOpen] = useState(false);
  const [selectedProfile, setSelectedProfile] = useState(null);
  const [executionSettings, setExecutionSettings] = useState({
    executionMode: 'on_demand',
    scheduleInterval: 60,
    enabled: false,
    syncDependencies: false,
    dependencyDepth: 1,
  });

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [profilesRes, statusRes, globalRes] = await Promise.all([
        get(`/${PLUGIN_ID}/sync-profiles`),
        get(`/${PLUGIN_ID}/sync-execution/status`),
        get(`/${PLUGIN_ID}/sync-execution/global-settings`),
      ]);
      setProfiles(profilesRes.data.data || []);
      setExecutionStatus(statusRes.data.data || []);
      setGlobalSettings(globalRes.data.data || {});
    } catch (err) {
      console.error('Failed to load sync data', err);
      setMessage({ type: 'danger', text: 'Failed to load sync data' });
    } finally {
      setLoading(false);
    }
  };

  const handleSyncAll = async () => {
    setSyncing(true);
    setResult(null);
    setError(null);
    try {
      const { data } = await post(`/${PLUGIN_ID}/sync-now`);
      setResult(data.data);
      loadData();
    } catch (err) {
      setError(err.response?.data?.error?.message || err.message || 'Sync failed');
    } finally {
      setSyncing(false);
    }
  };

  const handleExecuteProfile = async (profileId) => {
    try {
      await post(`/${PLUGIN_ID}/sync-execution/execute/${profileId}`);
      setMessage({ type: 'success', text: 'Sync executed successfully' });
      loadData();
    } catch (err) {
      setMessage({ type: 'danger', text: err.response?.data?.error?.message || 'Execution failed' });
    }
  };

  const openSettingsModal = async (profileId) => {
    try {
      const res = await get(`/${PLUGIN_ID}/sync-execution/settings/${profileId}`);
      setExecutionSettings(res.data.data || {
        executionMode: 'on_demand',
        scheduleInterval: 60,
        enabled: false,
        syncDependencies: false,
        dependencyDepth: 1,
      });
      setSelectedProfile(profileId);
      setSettingsModalOpen(true);
    } catch (err) {
      setMessage({ type: 'danger', text: 'Failed to load execution settings' });
    }
  };

  const handleSaveExecutionSettings = async () => {
    try {
      await put(`/${PLUGIN_ID}/sync-execution/settings/${selectedProfile}`, executionSettings);
      setMessage({ type: 'success', text: 'Execution settings saved' });
      setSettingsModalOpen(false);
      loadData();
    } catch (err) {
      setMessage({ type: 'danger', text: err.response?.data?.error?.message || 'Failed to save settings' });
    }
  };

  const getProfileById = (profileId) => {
    return profiles.find(p => p.id === profileId);
  };

  const getStatusForProfile = (profileId) => {
    return executionStatus.find(s => s.profileId === profileId) || {};
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return 'Never';
    return new Date(dateStr).toLocaleString();
  };

  if (loading) return <Typography>Loading…</Typography>;

  return (
    <Box>
      <Tabs.Root defaultValue="execute">
        <Tabs.List>
          <Tabs.Trigger value="execute">Execute Sync</Tabs.Trigger>
          <Tabs.Trigger value="status">Execution Status</Tabs.Trigger>
        </Tabs.List>

        <Box paddingTop={4}>
          <Tabs.Content value="execute">
            <Box>
              <Flex justifyContent="space-between" alignItems="center">
                <Box>
                  <Typography variant="beta" tag="h2">Execute Sync</Typography>
                  <Typography variant="omega" textColor="neutral600">
                    Run sync operations on-demand or configure scheduled/live execution.
                  </Typography>
                </Box>
                <Button onClick={handleSyncAll} loading={syncing} disabled={syncing}>
                  {syncing ? 'Syncing All…' : 'Sync All Active Profiles'}
                </Button>
              </Flex>

              {message && (
                <Box paddingTop={4}>
                  <Alert variant={message.type} closeLabel="Close" onClose={() => setMessage(null)}>
                    {message.text}
                  </Alert>
                </Box>
              )}

              {error && (
                <Box paddingTop={4}>
                  <Alert variant="danger" closeLabel="Close" onClose={() => setError(null)}>
                    {error}
                  </Alert>
                </Box>
              )}

              {result && (
                <Box paddingTop={4}>
                  <Alert variant="success" closeLabel="Close" onClose={() => setResult(null)}>
                    Sync completed at {result.syncedAt}
                  </Alert>
                </Box>
              )}

              <Box paddingTop={4}>
                <Typography variant="delta">Profiles</Typography>
                {profiles.filter(p => p.isActive).length === 0 ? (
                  <Box padding={4} background="neutral0" hasRadius marginTop={2}>
                    <Typography textColor="neutral600">
                      No active profiles. Activate a profile in the Sync Profiles tab first.
                    </Typography>
                  </Box>
                ) : (
                  <Table marginTop={2}>
                    <Thead>
                      <Tr>
                        <Th><Typography variant="sigma">Profile</Typography></Th>
                        <Th><Typography variant="sigma">Content Type</Typography></Th>
                        <Th><Typography variant="sigma">Execution Mode</Typography></Th>
                        <Th><Typography variant="sigma">Last Executed</Typography></Th>
                        <Th><Typography variant="sigma">Actions</Typography></Th>
                      </Tr>
                    </Thead>
                    <Tbody>
                      {profiles.filter(p => p.isActive).map((profile) => {
                        const status = getStatusForProfile(profile.id);
                        return (
                          <Tr key={profile.id}>
                            <Td>
                              <Typography fontWeight="bold">{profile.name}</Typography>
                            </Td>
                            <Td>
                              <Typography textColor="neutral600">{profile.contentType}</Typography>
                            </Td>
                            <Td>
                              <Badge active={status.executionMode !== 'on_demand'}>
                                {EXECUTION_MODE_OPTIONS.find(o => o.value === status.executionMode)?.label || 'On Demand'}
                              </Badge>
                              {status.isSchedulerRunning && (
                                <Badge active marginLeft={1}>Running</Badge>
                              )}
                            </Td>
                            <Td>
                              <Typography textColor="neutral500">
                                {formatDate(status.lastExecutedAt)}
                              </Typography>
                            </Td>
                            <Td>
                              <Flex gap={1}>
                                <Button
                                  variant="secondary"
                                  size="S"
                                  startIcon={<Play />}
                                  onClick={() => handleExecuteProfile(profile.id)}
                                >
                                  Run Now
                                </Button>
                                <IconButton
                                  label="Execution Settings"
                                  onClick={() => openSettingsModal(profile.id)}
                                >
                                  <Cog />
                                </IconButton>
                              </Flex>
                            </Td>
                          </Tr>
                        );
                      })}
                    </Tbody>
                  </Table>
                )}
              </Box>
            </Box>
          </Tabs.Content>

          <Tabs.Content value="status">
            <Box>
              <Typography variant="beta" tag="h2">Execution Status</Typography>
              <Typography variant="omega" textColor="neutral600">
                Monitor scheduled and live sync jobs.
              </Typography>

              <Box paddingTop={4}>
                <Table>
                  <Thead>
                    <Tr>
                      <Th><Typography variant="sigma">Profile</Typography></Th>
                      <Th><Typography variant="sigma">Mode</Typography></Th>
                      <Th><Typography variant="sigma">Enabled</Typography></Th>
                      <Th><Typography variant="sigma">Last Run</Typography></Th>
                      <Th><Typography variant="sigma">Next Run</Typography></Th>
                      <Th><Typography variant="sigma">Status</Typography></Th>
                    </Tr>
                  </Thead>
                  <Tbody>
                    {executionStatus.map((status) => (
                      <Tr key={status.profileId}>
                        <Td>
                          <Typography fontWeight="bold">{status.profileName}</Typography>
                        </Td>
                        <Td>
                          <Badge>
                            {EXECUTION_MODE_OPTIONS.find(o => o.value === status.executionMode)?.label || status.executionMode}
                          </Badge>
                        </Td>
                        <Td>
                          <Badge active={status.enabled}>
                            {status.enabled ? 'Enabled' : 'Disabled'}
                          </Badge>
                        </Td>
                        <Td>
                          <Typography textColor="neutral500">
                            {formatDate(status.lastExecutedAt)}
                          </Typography>
                        </Td>
                        <Td>
                          <Typography textColor="neutral500">
                            {status.executionMode === 'scheduled' && status.enabled
                              ? formatDate(status.nextExecutionAt)
                              : '—'}
                          </Typography>
                        </Td>
                        <Td>
                          {status.isSchedulerRunning ? (
                            <Badge active><Clock /> Running</Badge>
                          ) : (
                            <Badge>Idle</Badge>
                          )}
                        </Td>
                      </Tr>
                    ))}
                  </Tbody>
                </Table>
              </Box>
            </Box>
          </Tabs.Content>
        </Box>
      </Tabs.Root>

      {/* Execution Settings Modal */}
      {settingsModalOpen && (
        <Modal.Root open={settingsModalOpen} onOpenChange={setSettingsModalOpen}>
          <Modal.Content>
            <Modal.Header>
              <Modal.Title>Execution Settings</Modal.Title>
            </Modal.Header>
            <Modal.Body>
              <Box paddingBottom={4}>
                <Field.Root>
                  <Field.Label>Execution Mode</Field.Label>
                  <SingleSelect
                    value={executionSettings.executionMode}
                    onChange={(value) => setExecutionSettings((p) => ({ ...p, executionMode: value }))}
                  >
                    {EXECUTION_MODE_OPTIONS.map((opt) => (
                      <SingleSelectOption key={opt.value} value={opt.value}>
                        {opt.label}
                      </SingleSelectOption>
                    ))}
                  </SingleSelect>
                  <Field.Hint>
                    {executionSettings.executionMode === 'on_demand' && 'Sync only when manually triggered'}
                    {executionSettings.executionMode === 'scheduled' && 'Sync automatically at regular intervals'}
                    {executionSettings.executionMode === 'live' && 'Sync immediately when changes occur'}
                  </Field.Hint>
                </Field.Root>
              </Box>

              {executionSettings.executionMode === 'scheduled' && (
                <Box paddingBottom={4}>
                  <Field.Root>
                    <Field.Label>Schedule Interval (minutes)</Field.Label>
                    <NumberInput
                      value={executionSettings.scheduleInterval}
                      onValueChange={(value) => setExecutionSettings((p) => ({ ...p, scheduleInterval: value }))}
                      min={1}
                      max={1440}
                    />
                    <Field.Hint>How often to run the sync (1-1440 minutes)</Field.Hint>
                  </Field.Root>
                </Box>
              )}

              {(executionSettings.executionMode === 'scheduled' || executionSettings.executionMode === 'live') && (
                <Box paddingBottom={4}>
                  <Flex alignItems="center" gap={2}>
                    <Switch
                      checked={executionSettings.enabled}
                      onCheckedChange={(checked) => setExecutionSettings((p) => ({ ...p, enabled: checked }))}
                    />
                    <Typography>Enable automatic execution</Typography>
                  </Flex>
                </Box>
              )}

              <Box paddingBottom={4}>
                <Flex alignItems="center" gap={2}>
                  <Switch
                    checked={executionSettings.syncDependencies}
                    onCheckedChange={(checked) => setExecutionSettings((p) => ({ ...p, syncDependencies: checked }))}
                  />
                  <Typography>Sync related dependencies</Typography>
                </Flex>
                <Box paddingTop={1}>
                  <Typography variant="pi" textColor="neutral500">
                    Also sync related entities (relations, components) when syncing this content type.
                  </Typography>
                </Box>
              </Box>

              {executionSettings.syncDependencies && (
                <Box paddingBottom={4}>
                  <Field.Root>
                    <Field.Label>Dependency Depth</Field.Label>
                    <NumberInput
                      value={executionSettings.dependencyDepth}
                      onValueChange={(value) => setExecutionSettings((p) => ({ ...p, dependencyDepth: value }))}
                      min={1}
                      max={5}
                    />
                    <Field.Hint>How many levels of relations to follow (1-5)</Field.Hint>
                  </Field.Root>
                </Box>
              )}
            </Modal.Body>
            <Modal.Footer>
              <Modal.Close>
                <Button variant="tertiary">Cancel</Button>
              </Modal.Close>
              <Button onClick={handleSaveExecutionSettings}>Save Settings</Button>
            </Modal.Footer>
          </Modal.Content>
        </Modal.Root>
      )}
    </Box>
  );
};

export { SyncTab };
export default SyncTab;
