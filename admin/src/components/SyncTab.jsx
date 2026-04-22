import { useState, useEffect, useMemo } from 'react';
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
  Checkbox,
  TextInput,
} from '@strapi/design-system';
import { Play, Clock, Cog, ArrowUp, ArrowDown } from '@strapi/icons';
import { useFetchClient } from '@strapi/strapi/admin';
import BulkTransferTab from './BulkTransferTab';

const PLUGIN_ID = 'strapi-content-sync-pro';

const EXECUTION_MODE_OPTIONS = [
  { value: 'on_demand', label: 'On Demand (Manual)' },
  { value: 'scheduled', label: 'Scheduled (Batch)' },
  { value: 'live', label: 'Live (Real-time)' },
];

const FILTER_OPTIONS = [
  { value: 'all', label: 'All Profiles' },
  { value: 'active', label: 'Active Only' },
];

const SyncTab = () => {
  const { get, post, put } = useFetchClient();

  const [syncing, setSyncing] = useState(false);
  const [executingProfiles, setExecutingProfiles] = useState(new Set());
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [message, setMessage] = useState(null);

  // Profiles and execution status
  const [profiles, setProfiles] = useState([]);
  const [executionStatus, setExecutionStatus] = useState([]);
  const [globalSettings, setGlobalSettings] = useState({});
  const [loading, setLoading] = useState(true);
  const [syncMode, setSyncMode] = useState('paired');

  // Filter and ordering
  const [profileFilter, setProfileFilter] = useState('all');
  const [executionOrder, setExecutionOrder] = useState({}); // { profileId: order }
  const [orderModified, setOrderModified] = useState(false);

  // Selection for batch execution
  const [selectedProfiles, setSelectedProfiles] = useState([]);

  // Execution settings modal
  const [settingsModalOpen, setSettingsModalOpen] = useState(false);
  const [selectedProfile, setSelectedProfile] = useState(null);
  const [executionSettings, setExecutionSettings] = useState({
    executionMode: 'on_demand',
    scheduleType: 'interval',
    scheduleInterval: 60,
    cronExpression: '0 * * * *',
    enabled: false,
    syncDependencies: false,
    dependencyDepth: 1,
  });

  // Dependencies data
  const [dependencies, setDependencies] = useState({});

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [profilesRes, statusRes, globalRes, depsRes, configRes] = await Promise.all([
        get(`/${PLUGIN_ID}/sync-profiles`),
        get(`/${PLUGIN_ID}/sync-execution/status`),
        get(`/${PLUGIN_ID}/sync-execution/global-settings`),
        get(`/${PLUGIN_ID}/dependencies/all`).catch(() => ({ data: { data: {} } })),
        get(`/${PLUGIN_ID}/config`),
      ]);
      const loadedProfiles = profilesRes.data.data || [];
      setProfiles(loadedProfiles);
      setExecutionStatus(statusRes.data.data || []);
      setGlobalSettings(globalRes.data.data || {});
      setDependencies(depsRes.data.data || {});
      setSyncMode(configRes?.data?.data?.syncMode || 'paired');

      // Load saved execution order or calculate from dependencies
      const savedOrder = globalRes.data.data?.executionOrder || {};
      if (Object.keys(savedOrder).length > 0) {
        setExecutionOrder(savedOrder);
      } else {
        // Calculate initial order from dependencies
        const calculatedOrder = calculateExecutionOrder(loadedProfiles, depsRes.data.data || {});
        setExecutionOrder(calculatedOrder);
      }
    } catch (err) {
      console.error('Failed to load sync data', err);
      setMessage({ type: 'danger', text: err?.response?.data?.error?.message || err.message || 'Failed to load sync data' });
    } finally {
      setLoading(false);
    }
  };

  /**
   * Calculate execution order based on dependencies.
   * Profiles that others depend on get higher priority (lower order number).
   * More dependencies = lower priority (higher order number).
   */
  const calculateExecutionOrder = (profileList, deps) => {
    const order = {};
    const contentTypeToProfile = {};

    // Map content types to profiles
    profileList.forEach(p => {
      contentTypeToProfile[p.contentType] = p.id;
    });

    // Count how many profiles depend on each profile
    const dependedOnCount = {};
    const dependsOnCount = {};

    profileList.forEach(p => {
      dependedOnCount[p.id] = 0;
      dependsOnCount[p.id] = 0;
    });

    // Analyze dependencies
    profileList.forEach(profile => {
      const contentTypeDeps = deps[profile.contentType] || [];
      contentTypeDeps.forEach(dep => {
        const depProfileId = contentTypeToProfile[dep.target];
        if (depProfileId && depProfileId !== profile.id) {
          // This profile depends on depProfileId
          dependsOnCount[profile.id] = (dependsOnCount[profile.id] || 0) + 1;
          // depProfileId is depended on by this profile
          dependedOnCount[depProfileId] = (dependedOnCount[depProfileId] || 0) + 1;
        }
      });
    });

    // Sort profiles: higher dependedOnCount = lower order (executes first)
    // Lower dependsOnCount = lower order (executes first)
    const sortedProfiles = [...profileList].sort((a, b) => {
      // Primary: profiles that are depended on more should execute first
      const depOnDiff = (dependedOnCount[b.id] || 0) - (dependedOnCount[a.id] || 0);
      if (depOnDiff !== 0) return depOnDiff;

      // Secondary: profiles with fewer dependencies should execute first
      const depsOnDiff = (dependsOnCount[a.id] || 0) - (dependsOnCount[b.id] || 0);
      if (depsOnDiff !== 0) return depsOnDiff;

      // Tertiary: alphabetical by name
      return a.name.localeCompare(b.name);
    });

    sortedProfiles.forEach((p, index) => {
      order[p.id] = index + 1;
    });

    return order;
  };

  const handleResetOrder = () => {
    const calculatedOrder = calculateExecutionOrder(profiles, dependencies);
    setExecutionOrder(calculatedOrder);
    setOrderModified(false);
    setMessage({ type: 'success', text: 'Execution order reset to dependency-based calculation' });
  };

  const handleSaveOrder = async () => {
    try {
      await put(`/${PLUGIN_ID}/sync-execution/global-settings`, {
        ...globalSettings,
        executionOrder,
      });
      setOrderModified(false);
      setMessage({ type: 'success', text: 'Execution order saved' });
    } catch (err) {
      setMessage({ type: 'danger', text: err?.response?.data?.error?.message || err.message || 'Failed to save execution order' });
    }
  };

  const handleOrderChange = (profileId, newOrder) => {
    const parsed = parseInt(newOrder, 10);
    if (isNaN(parsed) || parsed < 1) return;

    setExecutionOrder(prev => ({
      ...prev,
      [profileId]: parsed,
    }));
    setOrderModified(true);
  };

  const handleMoveUp = (profileId) => {
    const currentOrder = executionOrder[profileId] || 999;
    if (currentOrder <= 1) return;

    // Find profile with the order one less
    const targetOrder = currentOrder - 1;
    const swapProfileId = Object.keys(executionOrder).find(
      id => executionOrder[id] === targetOrder
    );

    setExecutionOrder(prev => {
      const newOrder = { ...prev };
      newOrder[profileId] = targetOrder;
      if (swapProfileId) {
        newOrder[swapProfileId] = currentOrder;
      }
      return newOrder;
    });
    setOrderModified(true);
  };

  const handleMoveDown = (profileId) => {
    const currentOrder = executionOrder[profileId] || 1;
    const maxOrder = profiles.length;
    if (currentOrder >= maxOrder) return;

    // Find profile with the order one more
    const targetOrder = currentOrder + 1;
    const swapProfileId = Object.keys(executionOrder).find(
      id => executionOrder[id] === targetOrder
    );

    setExecutionOrder(prev => {
      const newOrder = { ...prev };
      newOrder[profileId] = targetOrder;
      if (swapProfileId) {
        newOrder[swapProfileId] = currentOrder;
      }
      return newOrder;
    });
    setOrderModified(true);
  };

  const handleSyncAll = async () => {
    setSyncing(true);
    setResult(null);
    setError(null);
    try {
      const { data } = await post(`/${PLUGIN_ID}/sync-now`);
      setResult(data.data);
      setMessage({ type: 'success', text: 'All active profiles synced successfully' });
      loadData();
    } catch (err) {
      setError(err.response?.data?.error?.message || err.message || 'Sync failed');
    } finally {
      setSyncing(false);
    }
  };

  const handleExecuteProfile = async (profileId) => {
    setExecutingProfiles(prev => new Set([...prev, profileId]));
    try {
      await post(`/${PLUGIN_ID}/sync-execution/execute/${profileId}`);
      const profile = profiles.find(p => p.id === profileId);
      setMessage({ type: 'success', text: `Sync completed: ${profile?.name || profileId}` });
      loadData();
    } catch (err) {
      setMessage({ type: 'danger', text: err.response?.data?.error?.message || 'Execution failed' });
    } finally {
      setExecutingProfiles(prev => {
        const next = new Set(prev);
        next.delete(profileId);
        return next;
      });
    }
  };

  const handleExecuteSelected = async () => {
    if (selectedProfiles.length === 0) return;
    setSyncing(true);
    try {
      const { data } = await post(`/${PLUGIN_ID}/sync-execution/execute-batch`, { profileIds: selectedProfiles });
      const successCount = data.data?.results?.length || 0;
      const errorCount = data.data?.errors?.length || 0;
      setMessage({ 
        type: errorCount > 0 ? 'warning' : 'success', 
        text: `Batch sync: ${successCount} succeeded, ${errorCount} failed` 
      });
      setSelectedProfiles([]);
      loadData();
    } catch (err) {
      setMessage({ type: 'danger', text: err.response?.data?.error?.message || 'Batch execution failed' });
    } finally {
      setSyncing(false);
    }
  };

  const handleSelectProfile = (profileId) => {
    // Only allow selecting active profiles
    const profile = profiles.find(p => p.id === profileId);
    if (!profile?.isActive) return;

    setSelectedProfiles(prev => 
      prev.includes(profileId) 
        ? prev.filter(id => id !== profileId)
        : [...prev, profileId]
    );
  };

  const handleSelectAllActive = () => {
    const activeIds = filteredProfiles.filter(p => p.isActive).map(p => p.id);
    const allSelected = activeIds.every(id => selectedProfiles.includes(id));
    if (allSelected) {
      setSelectedProfiles(prev => prev.filter(id => !activeIds.includes(id)));
    } else {
      setSelectedProfiles(prev => [...new Set([...prev, ...activeIds])]);
    }
  };

  const openSettingsModal = async (profileId) => {
    try {
      const res = await get(`/${PLUGIN_ID}/sync-execution/settings/${profileId}`);
      const settings = res.data.data || {
        executionMode: 'on_demand',
        scheduleType: 'interval',
        scheduleInterval: 60,
        cronExpression: '0 * * * *',
        enabled: false,
        syncDependencies: false,
        dependencyDepth: 1,
      };

      const profile = profiles.find((p) => p.id === profileId);
      if (profile && profile.syncDeletions && settings.executionMode === 'live') {
        settings.executionMode = 'on_demand';
        settings.enabled = false;
      }

      setExecutionSettings(settings);
      setSelectedProfile(profileId);
      setSettingsModalOpen(true);
    } catch (err) {
      setMessage({ type: 'danger', text: err?.response?.data?.error?.message || err.message || 'Failed to load execution settings' });
    }
  };

  const handleSaveExecutionSettings = async () => {
    try {
      const payload = { ...executionSettings };
      if (syncMode === 'single_side' && payload.executionMode === 'live') {
        payload.executionMode = 'on_demand';
        payload.enabled = false;
      }

      const selected = profiles.find((p) => p.id === selectedProfile);
      if (selected?.syncDeletions && payload.executionMode === 'live') {
        payload.executionMode = 'on_demand';
        payload.enabled = false;
      }

      await put(`/${PLUGIN_ID}/sync-execution/settings/${selectedProfile}`, payload);
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

  // Get dependency count for a profile
  const getDependencyInfo = (profile) => {
    const contentTypeDeps = dependencies[profile.contentType] || [];
    const dependsOn = contentTypeDeps.length;

    // Count how many profiles depend on this one
    let dependedBy = 0;
    profiles.forEach(p => {
      const pDeps = dependencies[p.contentType] || [];
      if (pDeps.some(d => d.target === profile.contentType)) {
        dependedBy++;
      }
    });

    return { dependsOn, dependedBy };
  };

  // Filter and sort profiles
  const filteredProfiles = useMemo(() => {
    let result = [...profiles];

    // Apply filter
    if (profileFilter === 'active') {
      result = result.filter(p => p.isActive);
    }

    // Sort by execution order
    result.sort((a, b) => {
      const orderA = executionOrder[a.id] || 999;
      const orderB = executionOrder[b.id] || 999;
      return orderA - orderB;
    });

    return result;
  }, [profiles, profileFilter, executionOrder]);

  const activeProfilesInFilter = filteredProfiles.filter(p => p.isActive);

  if (loading) return <Typography>Loading…</Typography>;

  return (
    <Box>
      <Tabs.Root defaultValue="execute">
        <Tabs.List>
          <Tabs.Trigger value="execute">Execute Sync</Tabs.Trigger>
          <Tabs.Trigger value="bulk">Bulk Transfer</Tabs.Trigger>
          <Tabs.Trigger value="status">Execution Status</Tabs.Trigger>
          <Tabs.Trigger value="info">How It Works</Tabs.Trigger>
        </Tabs.List>

        <Box paddingTop={4}>
          <Tabs.Content value="execute">
            <Box>
              <Flex justifyContent="space-between" alignItems="center">
                <Box>
                  <Typography variant="beta" tag="h2">Execute Sync</Typography>
                  <Typography variant="omega" textColor="neutral600">
                    Run sync operations on-demand. Select profiles or sync all at once.
                  </Typography>
                </Box>
                <Flex gap={2}>
                  {selectedProfiles.length > 0 && (
                    <Button 
                      variant="secondary" 
                      onClick={handleExecuteSelected} 
                      loading={syncing} 
                      disabled={syncing}
                    >
                      Run {selectedProfiles.length} Selected
                    </Button>
                  )}
                  <Button onClick={handleSyncAll} loading={syncing} disabled={syncing}>
                    {syncing ? 'Syncing…' : 'Sync All Active'}
                  </Button>
                </Flex>
              </Flex>

              {syncMode === 'single_side' && (
                <Box paddingTop={4}>
                  <Alert variant="info" title="Single-side mode restrictions">
                    Live execution is disabled in single-side mode. Use on-demand or scheduled execution with pull-only profiles.
                  </Alert>
                </Box>
              )}

              {profiles.some((p) => p.syncDeletions) && (
                <Box paddingTop={4}>
                  <Alert variant="info" title="Deletion sync profile rules">
                    Profiles with deletion sync enabled run as explicit one-way operations. Avoid live mode for these profiles.
                  </Alert>
                </Box>
              )}

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
                {/* Filter and Order Controls */}
                <Flex justifyContent="space-between" alignItems="center" marginBottom={4}>
                  <Flex gap={4} alignItems="center">
                    <Typography variant="delta">Profiles</Typography>
                    <SingleSelect
                      value={profileFilter}
                      onChange={setProfileFilter}
                      size="S"
                      style={{ width: 180 }}
                    >
                      {FILTER_OPTIONS.map(opt => (
                        <SingleSelectOption key={opt.value} value={opt.value}>
                          {opt.label}
                        </SingleSelectOption>
                      ))}
                    </SingleSelect>
                  </Flex>
                  <Flex gap={2}>
                    {orderModified && (
                      <Button variant="success" size="S" onClick={handleSaveOrder}>
                        Save Order
                      </Button>
                    )}
                    <Button 
                      variant="tertiary" 
                      size="S" 
                      onClick={handleResetOrder}
                    >
                      ↻ Reset Order
                    </Button>
                  </Flex>
                </Flex>

                {filteredProfiles.length === 0 ? (
                  <Box padding={4} background="neutral0" hasRadius>
                    <Typography textColor="neutral600">
                      {profileFilter === 'active' 
                        ? 'No active profiles. Activate a profile in the Sync Profiles tab first.'
                        : 'No profiles found. Create a profile in the Sync Profiles tab.'}
                    </Typography>
                  </Box>
                ) : (
                  <Table>
                    <Thead>
                      <Tr>
                        <Th style={{ width: 50 }}>
                          <Checkbox
                            checked={activeProfilesInFilter.length > 0 && activeProfilesInFilter.every(p => selectedProfiles.includes(p.id))}
                            indeterminate={activeProfilesInFilter.some(p => selectedProfiles.includes(p.id)) && !activeProfilesInFilter.every(p => selectedProfiles.includes(p.id))}
                            onCheckedChange={handleSelectAllActive}
                            aria-label="Select all active profiles"
                          />
                        </Th>
                        <Th style={{ width: 80 }}><Typography variant="sigma">Order</Typography></Th>
                        <Th><Typography variant="sigma">Profile</Typography></Th>
                        <Th><Typography variant="sigma">Content Type</Typography></Th>
                        <Th><Typography variant="sigma">Dependencies</Typography></Th>
                        <Th><Typography variant="sigma">Status</Typography></Th>
                        <Th><Typography variant="sigma">Execution Mode</Typography></Th>
                        <Th><Typography variant="sigma">Actions</Typography></Th>
                      </Tr>
                    </Thead>
                    <Tbody>
                      {filteredProfiles.map((profile) => {
                        const status = getStatusForProfile(profile.id);
                        const isExecuting = executingProfiles.has(profile.id);
                        const depInfo = getDependencyInfo(profile);
                        const order = executionOrder[profile.id] || 999;

                        return (
                          <Tr key={profile.id} style={{ opacity: profile.isActive ? 1 : 0.6 }}>
                            <Td>
                              {profile.isActive ? (
                                <Checkbox
                                  checked={selectedProfiles.includes(profile.id)}
                                  onCheckedChange={() => handleSelectProfile(profile.id)}
                                  aria-label={`Select ${profile.name}`}
                                />
                              ) : (
                                <Typography textColor="neutral400">—</Typography>
                              )}
                            </Td>
                            <Td>
                              <Flex gap={1} alignItems="center">
                                <Flex direction="column" gap={0}>
                                  <IconButton 
                                    label="Move up" 
                                    size="S" 
                                    variant="ghost"
                                    onClick={() => handleMoveUp(profile.id)}
                                    disabled={order <= 1}
                                  >
                                    <ArrowUp />
                                  </IconButton>
                                  <IconButton 
                                    label="Move down" 
                                    size="S" 
                                    variant="ghost"
                                    onClick={() => handleMoveDown(profile.id)}
                                    disabled={order >= profiles.length}
                                  >
                                    <ArrowDown />
                                  </IconButton>
                                </Flex>
                                <TextInput 
                                  value={order}
                                  onChange={(e) => handleOrderChange(profile.id, e.target.value)}
                                  style={{ width: 50, textAlign: 'center' }}
                                  size="S"
                                  type="number"
                                  min={1}
                                />
                              </Flex>
                            </Td>
                            <Td>
                              <Typography fontWeight="bold">{profile.name}</Typography>
                            </Td>
                            <Td>
                              <Typography textColor="neutral600" style={{ fontSize: '0.85em' }}>
                                {profile.contentType}
                              </Typography>
                            </Td>
                            <Td>
                              <Flex gap={1}>
                                {depInfo.dependedBy > 0 && (
                                  <Badge active title="Other profiles depend on this">
                                    ↑{depInfo.dependedBy}
                                  </Badge>
                                )}
                                {depInfo.dependsOn > 0 && (
                                  <Badge title="This profile depends on others">
                                    ↓{depInfo.dependsOn}
                                  </Badge>
                                )}
                                {depInfo.dependedBy === 0 && depInfo.dependsOn === 0 && (
                                  <Typography textColor="neutral400">—</Typography>
                                )}
                              </Flex>
                            </Td>
                            <Td>
                              {profile.isActive ? (
                                <Badge active>Active</Badge>
                              ) : (
                                <Badge>Inactive</Badge>
                              )}
                            </Td>
                            <Td>
                              <Badge active={status.executionMode !== 'on_demand'}>
                                {EXECUTION_MODE_OPTIONS.find(o => o.value === status.executionMode)?.label || 'On Demand'}
                              </Badge>
                              {status.executionMode === 'live' && status.enabled && (
                                <Badge active style={{ marginLeft: 4 }}>Live</Badge>
                              )}
                              {status.isSchedulerRunning && (
                                <Badge active style={{ marginLeft: 4 }}>Scheduled</Badge>
                              )}
                            </Td>
                            <Td>
                              <Flex gap={1}>
                                {profile.isActive ? (
                                  <Button
                                    variant="secondary"
                                    size="S"
                                    startIcon={<Play />}
                                    onClick={() => handleExecuteProfile(profile.id)}
                                    loading={isExecuting}
                                    disabled={isExecuting}
                                  >
                                    {isExecuting ? 'Running…' : 'Run Now'}
                                  </Button>
                                ) : (
                                  <Typography textColor="neutral400" variant="pi">
                                    Activate to run
                                  </Typography>
                                )}
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

                {/* Dependency Legend */}
                <Box paddingTop={3}>
                  <Flex gap={4}>
                    <Typography variant="pi" textColor="neutral500">
                      <Badge active>↑N</Badge> = N profiles depend on this (executes earlier)
                    </Typography>
                    <Typography variant="pi" textColor="neutral500">
                      <Badge>↓N</Badge> = Depends on N other profiles (executes later)
                    </Typography>
                  </Flex>
                </Box>
              </Box>
            </Box>
          </Tabs.Content>

          <Tabs.Content value="bulk">
            <BulkTransferTab syncMode={syncMode} />
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
                          ) : status.executionMode === 'live' && status.enabled ? (
                            <Badge active>Live Active</Badge>
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

          {/* How It Works Tab */}
          <Tabs.Content value="info">
            <Box>
              <Typography variant="beta" tag="h2">How Sync Execution Works</Typography>
              <Typography variant="omega" textColor="neutral600" paddingBottom={4}>
                Understanding the different execution modes and how they are triggered.
              </Typography>

              {/* On-Demand Section */}
              <Box padding={4} background="neutral0" hasRadius marginBottom={4}>
                <Typography variant="delta" textColor="primary600">On-Demand (Manual)</Typography>
                <Box paddingTop={2}>
                  <Typography>
                    <strong>Trigger:</strong> User clicks "Run Now" or "Sync All Active" buttons in this tab.
                  </Typography>
                  <Typography paddingTop={1}>
                    <strong>Use Case:</strong> Testing, initial data migration, or when you want full control over when sync happens.
                  </Typography>
                  <Typography paddingTop={1}>
                    <strong>How It Works:</strong>
                  </Typography>
                  <Box as="ul" paddingLeft={4} paddingTop={1}>
                    <li>Select individual profiles using checkboxes and click "Run Selected"</li>
                    <li>Or click "Run Now" on a specific profile row</li>
                    <li>Or click "Sync All Active" to run all active profiles at once</li>
                  </Box>
                </Box>
              </Box>

              {/* Scheduled Section */}
              <Box padding={4} background="neutral0" hasRadius marginBottom={4}>
                <Typography variant="delta" textColor="warning600">Scheduled (Batch)</Typography>
                <Box paddingTop={2}>
                  <Typography>
                    <strong>Trigger:</strong> Automatic timer runs at the configured interval (e.g., every 60 minutes).
                  </Typography>
                  <Typography paddingTop={1}>
                    <strong>Use Case:</strong> Regular background synchronization without manual intervention. Best for production environments.
                  </Typography>
                  <Typography paddingTop={1}>
                    <strong>How It Works:</strong>
                  </Typography>
                  <Box as="ul" paddingLeft={4} paddingTop={1}>
                    <li>Set execution mode to "Scheduled" in profile settings (⚙️ icon)</li>
                    <li>Configure the interval (1-1440 minutes)</li>
                    <li>Enable automatic execution with the toggle</li>
                    <li>The scheduler starts automatically and runs in the background</li>
                    <li>Next execution time is displayed in the Execution Status tab</li>
                  </Box>
                </Box>
              </Box>

              {/* Live Section */}
              <Box padding={4} background="neutral0" hasRadius marginBottom={4}>
                <Typography variant="delta" textColor="success600">Live (Real-time)</Typography>
                <Box paddingTop={2}>
                  <Typography>
                    <strong>Trigger:</strong> Database lifecycle hooks (afterCreate, afterUpdate, afterDelete) on content.
                  </Typography>
                  <Typography paddingTop={1}>
                    <strong>Use Case:</strong> Instant synchronization when content changes. Best for critical data that must stay in sync immediately.
                  </Typography>
                  <Typography paddingTop={1}>
                    <strong>How It Works:</strong>
                  </Typography>
                  <Box as="ul" paddingLeft={4} paddingTop={1}>
                    <li>Set execution mode to "Live" in profile settings (⚙️ icon)</li>
                    <li>Enable automatic execution with the toggle</li>
                    <li>When any record of that content type is created/updated/deleted:</li>
                    <li style={{ marginLeft: 16 }}>→ The plugin checks if live sync is enabled for that content type</li>
                    <li style={{ marginLeft: 16 }}>→ If enabled, it immediately pushes/pulls the change to the remote instance</li>
                    <li>Changes are synced within seconds of occurring</li>
                  </Box>
                </Box>
              </Box>

              {/* Dependencies Section */}
              <Box padding={4} background="neutral100" hasRadius>
                <Typography variant="delta">Dependency Syncing</Typography>
                <Box paddingTop={2}>
                  <Typography>
                    When enabled in profile settings, the sync will also include related entities:
                  </Typography>
                  <Box as="ul" paddingLeft={4} paddingTop={1}>
                    <li><strong>Relations:</strong> Linked content from other content types</li>
                    <li><strong>Components:</strong> Embedded component data</li>
                    <li><strong>Dynamic Zones:</strong> Multi-type component areas</li>
                  </Box>
                  <Typography paddingTop={2} textColor="neutral500">
                    Dependency depth (1-5) controls how many levels of nested relations are followed.
                  </Typography>
                </Box>
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
                      <SingleSelectOption
                        key={opt.value}
                        value={opt.value}
                        disabled={syncMode === 'single_side' && opt.value === 'live'}
                      >
                        {opt.label}
                      </SingleSelectOption>
                    ))}
                  </SingleSelect>
                  <Field.Hint>
                    {executionSettings.executionMode === 'on_demand' && 'Sync only when manually triggered'}
                    {executionSettings.executionMode === 'scheduled' && 'Sync automatically at regular intervals'}
                    {executionSettings.executionMode === 'live' && 'Sync immediately when changes occur'}
                    {syncMode === 'single_side' && executionSettings.executionMode === 'live' && ' (not supported in single-side mode)'}
                  </Field.Hint>
                </Field.Root>
              </Box>

              {executionSettings.executionMode === 'scheduled' && (
                <Box paddingBottom={4}>
                  <Field.Root>
                    <Field.Label>Schedule Type</Field.Label>
                    <SingleSelect
                      value={executionSettings.scheduleType || 'interval'}
                      onChange={(value) => setExecutionSettings((p) => ({ ...p, scheduleType: value }))}
                    >
                      <SingleSelectOption value="interval">Interval (setInterval)</SingleSelectOption>
                      <SingleSelectOption value="timeout">Timeout (chained, no overlap)</SingleSelectOption>
                      <SingleSelectOption value="cron">Cron (wall-clock)</SingleSelectOption>
                      <SingleSelectOption value="external">External scheduler</SingleSelectOption>
                    </SingleSelect>
                    <Field.Hint>
                      {(!executionSettings.scheduleType || executionSettings.scheduleType === 'interval') && 'Fires every N minutes via setInterval. Light and simple; may overlap if a run is slow.'}
                      {executionSettings.scheduleType === 'timeout' && 'Chained setTimeout: waits for each run to finish before scheduling the next. Best for long-running syncs.'}
                      {executionSettings.scheduleType === 'cron' && 'Uses Strapi\'s built-in cron. Recommended for production and larger datasets.'}
                      {executionSettings.scheduleType === 'external' && 'No in-process timer. Trigger the execute endpoint from an external scheduler (cron, Task Scheduler, K8s CronJob, etc.). See the Help tab.'}
                    </Field.Hint>
                  </Field.Root>
                </Box>
              )}

              {executionSettings.executionMode === 'scheduled' &&
                (executionSettings.scheduleType === 'interval' ||
                  executionSettings.scheduleType === 'timeout' ||
                  !executionSettings.scheduleType) && (
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

              {executionSettings.executionMode === 'scheduled' && executionSettings.scheduleType === 'cron' && (
                <Box paddingBottom={4}>
                  <Field.Root>
                    <Field.Label>Cron Expression</Field.Label>
                    <TextInput
                      value={executionSettings.cronExpression || ''}
                      onChange={(e) => setExecutionSettings((p) => ({ ...p, cronExpression: e.target.value }))}
                      placeholder="0 */2 * * *"
                    />
                    <Field.Hint>
                      Standard 5- or 6-field cron. Examples: "0 * * * *" (hourly), "*/15 * * * *" (every 15 min), "0 2 * * *" (daily at 02:00).
                    </Field.Hint>
                  </Field.Root>
                </Box>
              )}

              {executionSettings.executionMode === 'scheduled' && executionSettings.scheduleType === 'external' && (
                <Box paddingBottom={4}>
                  <Typography variant="pi" textColor="neutral600">
                    External mode: the plugin will NOT run an in-process timer. Your external scheduler must POST to
                    {' '}<code>/api/strapi-content-sync-pro/sync-execution/execute/&lt;profileId&gt;</code>{' '}
                    with a valid API token. See the Help tab for concrete examples (cron, Windows Task Scheduler, systemd, Kubernetes CronJob, GitHub Actions).
                  </Typography>
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
