import { useState, useEffect, useMemo } from 'react';
import {
  Box,
  Flex,
  Typography,
  Button,
  Alert,
  TextInput,
  SingleSelect,
  SingleSelectOption,
  Checkbox,
  Field,
  Modal,
  IconButton,
  Badge,
  Table,
  Thead,
  Tbody,
  Tr,
  Th,
  Td,
  Tabs,
} from '@strapi/design-system';
import { Pencil, Trash, Plus, Check, CaretUp, CaretDown } from '@strapi/icons';
import { useFetchClient } from '@strapi/strapi/admin';

const PLUGIN_ID = 'strapi-to-strapi-data-sync';

const DIRECTION_OPTIONS = [
  { value: 'push', label: 'Push Only' },
  { value: 'pull', label: 'Pull Only' },
  { value: 'both', label: 'Bidirectional' },
];

const CONFLICT_STRATEGY_OPTIONS = [
  { value: 'latest', label: 'Latest Wins' },
  { value: 'local_wins', label: 'Local Wins' },
  { value: 'remote_wins', label: 'Remote Wins' },
];

const FIELD_DIRECTION_OPTIONS = [
  { value: 'both', label: 'Both' },
  { value: 'push', label: 'Push' },
  { value: 'pull', label: 'Pull' },
  { value: 'none', label: 'Exclude' },
];

const SIMPLE_PRESETS = [
  { value: 'full_push', label: 'Full Push', description: 'Push all data to remote' },
  { value: 'full_pull', label: 'Full Pull', description: 'Pull all data from remote' },
  { value: 'bidirectional', label: 'Bidirectional', description: 'Two-way sync' },
];

const SyncProfilesTab = () => {
  const { get, post, put, del } = useFetchClient();

  const [profiles, setProfiles] = useState([]);
  const [contentTypes, setContentTypes] = useState([]);
  const [enabledTypes, setEnabledTypes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState(null);

  // Sorting state
  const [sortField, setSortField] = useState('name');
  const [sortDirection, setSortDirection] = useState('asc');

  // Selection state for bulk operations
  const [selectedProfiles, setSelectedProfiles] = useState([]);

  // Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [editingProfile, setEditingProfile] = useState(null);
  const [createMode, setCreateMode] = useState('simple'); // 'simple' or 'advanced'
  const [selectedPreset, setSelectedPreset] = useState('');
  const [formData, setFormData] = useState({
    name: '',
    contentType: '',
    direction: 'both',
    conflictStrategy: 'latest',
    isActive: false,
    isSimple: true,
    fieldPolicies: [],
  });
  const [schemaFields, setSchemaFields] = useState([]);
  const [loadingSchema, setLoadingSchema] = useState(false);

  // Sorted profiles
  const sortedProfiles = useMemo(() => {
    const sorted = [...profiles].sort((a, b) => {
      let aVal = a[sortField];
      let bVal = b[sortField];

      // Handle content type display name
      if (sortField === 'contentType') {
        const ctA = contentTypes.find(ct => ct.uid === a.contentType);
        const ctB = contentTypes.find(ct => ct.uid === b.contentType);
        aVal = ctA?.displayName || a.contentType;
        bVal = ctB?.displayName || b.contentType;
      }

      // Handle boolean for isActive
      if (sortField === 'isActive') {
        aVal = a.isActive ? 1 : 0;
        bVal = b.isActive ? 1 : 0;
      }

      if (typeof aVal === 'string') {
        return sortDirection === 'asc' 
          ? aVal.localeCompare(bVal)
          : bVal.localeCompare(aVal);
      }
      return sortDirection === 'asc' ? aVal - bVal : bVal - aVal;
    });
    return sorted;
  }, [profiles, sortField, sortDirection, contentTypes]);

  const handleSort = (field) => {
    if (sortField === field) {
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const SortableHeader = ({ field, children }) => (
    <Th 
      onClick={() => handleSort(field)} 
      style={{ cursor: 'pointer', userSelect: 'none' }}
    >
      <Flex alignItems="center" gap={1}>
        <Typography variant="sigma">{children}</Typography>
        {sortField === field && (
          sortDirection === 'asc' ? <CaretUp /> : <CaretDown />
        )}
      </Flex>
    </Th>
  );

  const handleSelectProfile = (profileId) => {
    setSelectedProfiles(prev => 
      prev.includes(profileId)
        ? prev.filter(id => id !== profileId)
        : [...prev, profileId]
    );
  };

  const handleSelectAll = () => {
    if (selectedProfiles.length === profiles.length) {
      setSelectedProfiles([]);
    } else {
      setSelectedProfiles(profiles.map(p => p.id));
    }
  };

  const handleBulkActivate = async () => {
    if (selectedProfiles.length === 0) return;
    try {
      for (const profileId of selectedProfiles) {
        await put(`/${PLUGIN_ID}/sync-profiles/${profileId}`, { isActive: true });
      }
      setMessage({ type: 'success', text: `Activated ${selectedProfiles.length} profiles` });
      setSelectedProfiles([]);
      loadData();
    } catch (err) {
      setMessage({ type: 'danger', text: 'Failed to activate profiles' });
    }
  };

  const handleBulkDeactivate = async () => {
    if (selectedProfiles.length === 0) return;
    try {
      for (const profileId of selectedProfiles) {
        await put(`/${PLUGIN_ID}/sync-profiles/${profileId}`, { isActive: false });
      }
      setMessage({ type: 'success', text: `Deactivated ${selectedProfiles.length} profiles` });
      setSelectedProfiles([]);
      loadData();
    } catch (err) {
      setMessage({ type: 'danger', text: 'Failed to deactivate profiles' });
    }
  };

  const handleBulkDelete = async () => {
    if (selectedProfiles.length === 0) return;
    if (!window.confirm(`Delete ${selectedProfiles.length} selected profiles?`)) return;
    try {
      for (const profileId of selectedProfiles) {
        await del(`/${PLUGIN_ID}/sync-profiles/${profileId}`);
      }
      setMessage({ type: 'success', text: `Deleted ${selectedProfiles.length} profiles` });
      setSelectedProfiles([]);
      loadData();
    } catch (err) {
      setMessage({ type: 'danger', text: 'Failed to delete profiles' });
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [profilesRes, ctRes, scRes] = await Promise.all([
        get(`/${PLUGIN_ID}/sync-profiles`),
        get(`/${PLUGIN_ID}/content-types`),
        get(`/${PLUGIN_ID}/sync-config`),
      ]);
      setProfiles(profilesRes.data.data || []);
      setContentTypes(ctRes.data.data || []);
      const config = scRes.data.data || { contentTypes: [] };
      setEnabledTypes(config.contentTypes?.filter(ct => ct.enabled).map(ct => ct.uid) || []);
    } catch (err) {
      console.error('Failed to load data', err);
      setMessage({ type: 'danger', text: 'Failed to load profiles' });
    } finally {
      setLoading(false);
    }
  };

  const loadContentTypeSchema = async (uid) => {
    if (!uid) {
      setSchemaFields([]);
      return;
    }
    setLoadingSchema(true);
    try {
      const res = await get(`/${PLUGIN_ID}/content-type-schema/${encodeURIComponent(uid)}`);
      const fields = res.data.data?.fields || [];
      setSchemaFields(fields);

      // Initialize field policies for all fields with default 'both'
      if (!editingProfile && createMode === 'advanced') {
        setFormData((prev) => ({
          ...prev,
          fieldPolicies: fields.map((f) => ({
            field: f.name,
            direction: 'both',
          })),
        }));
      }
    } catch (err) {
      console.error('Failed to load schema', err);
      setSchemaFields([]);
    } finally {
      setLoadingSchema(false);
    }
  };

  const handleContentTypeChange = (uid) => {
    setFormData((prev) => ({ ...prev, contentType: uid, fieldPolicies: [] }));
    if (createMode === 'advanced') {
      loadContentTypeSchema(uid);
    }
  };

  const handleFieldPolicyChange = (fieldName, direction) => {
    setFormData((prev) => {
      const existing = prev.fieldPolicies.find((fp) => fp.field === fieldName);
      if (existing) {
        return {
          ...prev,
          fieldPolicies: prev.fieldPolicies.map((fp) =>
            fp.field === fieldName ? { ...fp, direction } : fp
          ),
        };
      }
      return {
        ...prev,
        fieldPolicies: [...prev.fieldPolicies, { field: fieldName, direction }],
      };
    });
  };

  const getFieldPolicy = (fieldName) => {
    const fp = formData.fieldPolicies.find((p) => p.field === fieldName);
    return fp?.direction || 'both';
  };

  const openCreateModal = () => {
    setEditingProfile(null);
    setCreateMode('simple');
    setSelectedPreset('');
    setFormData({
      name: '',
      contentType: '',
      direction: 'both',
      conflictStrategy: 'latest',
      isActive: false,
      isSimple: true,
      fieldPolicies: [],
    });
    setSchemaFields([]);
    setModalOpen(true);
  };

  const openEditModal = async (profile) => {
    setEditingProfile(profile);
    setCreateMode(profile.isSimple ? 'simple' : 'advanced');
    setFormData({
      name: profile.name,
      contentType: profile.contentType,
      direction: profile.direction || 'both',
      conflictStrategy: profile.conflictStrategy || 'latest',
      isActive: profile.isActive,
      isSimple: profile.isSimple !== false,
      fieldPolicies: profile.fieldPolicies || [],
    });
    if (!profile.isSimple) {
      await loadContentTypeSchema(profile.contentType);
    }
    setModalOpen(true);
  };

  const handlePresetSelect = (preset) => {
    setSelectedPreset(preset);
    const presetConfig = {
      full_push: { direction: 'push', conflictStrategy: 'local_wins' },
      full_pull: { direction: 'pull', conflictStrategy: 'remote_wins' },
      bidirectional: { direction: 'both', conflictStrategy: 'latest' },
    };
    const config = presetConfig[preset] || {};
    setFormData((prev) => ({
      ...prev,
      ...config,
      isSimple: true,
    }));
  };

  const handleModeChange = async (mode) => {
    setCreateMode(mode);
    setFormData((prev) => ({
      ...prev,
      isSimple: mode === 'simple',
      fieldPolicies: [],
    }));
    if (mode === 'advanced' && formData.contentType) {
      await loadContentTypeSchema(formData.contentType);
    }
  };

  const handleSave = async () => {
    try {
      const payload = {
        ...formData,
        isSimple: createMode === 'simple',
      };

      if (editingProfile) {
        await put(`/${PLUGIN_ID}/sync-profiles/${editingProfile.id}`, payload);
        setMessage({ type: 'success', text: 'Profile updated successfully' });
      } else {
        await post(`/${PLUGIN_ID}/sync-profiles`, payload);
        setMessage({ type: 'success', text: 'Profile created successfully' });
      }
      setModalOpen(false);
      loadData();
    } catch (err) {
      setMessage({ type: 'danger', text: err.response?.data?.error?.message || 'Failed to save profile' });
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Are you sure you want to delete this profile?')) return;
    try {
      await del(`/${PLUGIN_ID}/sync-profiles/${id}`);
      setMessage({ type: 'success', text: 'Profile deleted' });
      loadData();
    } catch (err) {
      setMessage({ type: 'danger', text: 'Failed to delete profile' });
    }
  };

  const handleActivate = async (profile) => {
    try {
      await put(`/${PLUGIN_ID}/sync-profiles/${profile.id}`, { isActive: true });
      setMessage({ type: 'success', text: `Activated: ${profile.name}` });
      loadData();
    } catch (err) {
      setMessage({ type: 'danger', text: 'Failed to activate profile' });
    }
  };

  const getContentTypeName = (uid) => {
    const ct = contentTypes.find((c) => c.uid === uid);
    return ct?.displayName || uid;
  };

  const getEnabledContentTypes = () => {
    return contentTypes.filter((ct) => enabledTypes.includes(ct.uid));
  };

  const getDirectionLabel = (direction) => {
    return DIRECTION_OPTIONS.find(o => o.value === direction)?.label || direction;
  };

  if (loading) return <Typography>Loading…</Typography>;

  return (
    <Box>
      <Flex justifyContent="space-between" alignItems="center">
        <Box>
          <Typography variant="beta" tag="h2">Sync Profiles</Typography>
          <Typography variant="omega" textColor="neutral600">
            Configure sync behavior per content type including direction, conflict strategy, and field policies.
            Execution timing (on-demand, scheduled, live) is configured in the Sync tab.
          </Typography>
        </Box>
        <Button startIcon={<Plus />} onClick={openCreateModal}>
          Create Profile
        </Button>
      </Flex>

      {message && (
        <Box paddingTop={4}>
          <Alert variant={message.type} closeLabel="Close" onClose={() => setMessage(null)}>
            {message.text}
          </Alert>
        </Box>
      )}

      {/* Bulk Actions Bar */}
      {selectedProfiles.length > 0 && (
        <Box paddingTop={4}>
          <Flex gap={2} alignItems="center" background="neutral100" padding={3} hasRadius>
            <Typography variant="omega" fontWeight="bold">
              {selectedProfiles.length} selected
            </Typography>
            <Button variant="success" size="S" onClick={handleBulkActivate}>
              Activate Selected
            </Button>
            <Button variant="secondary" size="S" onClick={handleBulkDeactivate}>
              Deactivate Selected
            </Button>
            <Button variant="danger" size="S" onClick={handleBulkDelete}>
              Delete Selected
            </Button>
            <Button variant="tertiary" size="S" onClick={() => setSelectedProfiles([])}>
              Clear Selection
            </Button>
          </Flex>
        </Box>
      )}

      <Box paddingTop={4}>
        {profiles.length === 0 ? (
          <Box padding={6} background="neutral0" hasRadius>
            <Typography textColor="neutral600">
              No sync profiles found. Enable content types in the Content Types tab to auto-generate profiles, 
              or create a custom profile.
            </Typography>
          </Box>
        ) : (
          <Table>
            <Thead>
              <Tr>
                <Th>
                  <Checkbox
                    checked={selectedProfiles.length === profiles.length && profiles.length > 0}
                    indeterminate={selectedProfiles.length > 0 && selectedProfiles.length < profiles.length}
                    onCheckedChange={handleSelectAll}
                    aria-label="Select all profiles"
                  />
                </Th>
                <SortableHeader field="name">Name</SortableHeader>
                <SortableHeader field="contentType">Content Type</SortableHeader>
                <SortableHeader field="direction">Direction</SortableHeader>
                <SortableHeader field="conflictStrategy">Conflict</SortableHeader>
                <SortableHeader field="isSimple">Mode</SortableHeader>
                <SortableHeader field="isActive">Status</SortableHeader>
                <Th><Typography variant="sigma">Actions</Typography></Th>
              </Tr>
            </Thead>
            <Tbody>
              {sortedProfiles.map((profile) => (
                <Tr key={profile.id}>
                  <Td>
                    <Checkbox
                      checked={selectedProfiles.includes(profile.id)}
                      onCheckedChange={() => handleSelectProfile(profile.id)}
                      aria-label={`Select ${profile.name}`}
                    />
                  </Td>
                  <Td><Typography fontWeight="bold">{profile.name}</Typography></Td>
                  <Td><Typography textColor="neutral600">{getContentTypeName(profile.contentType)}</Typography></Td>
                  <Td><Badge>{getDirectionLabel(profile.direction)}</Badge></Td>
                  <Td><Badge>{profile.conflictStrategy}</Badge></Td>
                  <Td>
                    <Badge active={!profile.isSimple}>
                      {profile.isSimple ? 'Simple' : 'Advanced'}
                    </Badge>
                  </Td>
                  <Td>
                    {profile.isActive ? (
                      <Badge active>Active</Badge>
                    ) : (
                      <Badge>Inactive</Badge>
                    )}
                  </Td>
                  <Td>
                    <Flex gap={1}>
                      <IconButton label="Edit" onClick={() => openEditModal(profile)}>
                        <Pencil />
                      </IconButton>
                      <IconButton label="Delete" onClick={() => handleDelete(profile.id)}>
                        <Trash />
                      </IconButton>
                    </Flex>
                  </Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        )}
      </Box>

      {/* Create/Edit Modal */}
      {modalOpen && (
        <Modal.Root open={modalOpen} onOpenChange={setModalOpen}>
          <Modal.Content>
            <Modal.Header>
              <Modal.Title>
                {editingProfile ? 'Edit Sync Profile' : 'Create Sync Profile'}
              </Modal.Title>
            </Modal.Header>
            <Modal.Body>
              {/* Mode Selection (only for new profiles) */}
              {!editingProfile && (
                <Box paddingBottom={4}>
                  <Tabs.Root value={createMode} onValueChange={handleModeChange}>
                    <Tabs.List>
                      <Tabs.Trigger value="simple">Simple</Tabs.Trigger>
                      <Tabs.Trigger value="advanced">Advanced</Tabs.Trigger>
                    </Tabs.List>
                  </Tabs.Root>
                  <Box paddingTop={2}>
                    <Typography variant="pi" textColor="neutral500">
                      {createMode === 'simple'
                        ? 'Choose a preset and configure basic options.'
                        : 'Configure individual field-level sync policies.'}
                    </Typography>
                  </Box>
                </Box>
              )}

              {/* Content Type Selection */}
              <Box paddingBottom={4}>
                <Field.Root>
                  <Field.Label>Content Type</Field.Label>
                  <SingleSelect
                    value={formData.contentType}
                    onChange={handleContentTypeChange}
                    disabled={!!editingProfile}
                  >
                    <SingleSelectOption value="">Select content type...</SingleSelectOption>
                    {getEnabledContentTypes().map((ct) => (
                      <SingleSelectOption key={ct.uid} value={ct.uid}>
                        {ct.displayName}
                      </SingleSelectOption>
                    ))}
                  </SingleSelect>
                  <Field.Hint>Only enabled content types are shown</Field.Hint>
                </Field.Root>
              </Box>

              {/* Simple Mode: Preset Selection */}
              {createMode === 'simple' && !editingProfile && (
                <Box paddingBottom={4}>
                  <Typography variant="delta" paddingBottom={2}>Quick Presets</Typography>
                  <Flex gap={2} wrap="wrap">
                    {SIMPLE_PRESETS.map((preset) => (
                      <Button
                        key={preset.value}
                        variant={selectedPreset === preset.value ? 'default' : 'tertiary'}
                        onClick={() => handlePresetSelect(preset.value)}
                        size="S"
                      >
                        {preset.label}
                      </Button>
                    ))}
                  </Flex>
                </Box>
              )}

              {/* Profile Name */}
              <Box paddingBottom={4}>
                <Field.Root>
                  <Field.Label>Profile Name</Field.Label>
                  <TextInput
                    placeholder="e.g., Products - Live Push"
                    value={formData.name}
                    onChange={(e) => setFormData((p) => ({ ...p, name: e.target.value }))}
                  />
                </Field.Root>
              </Box>

              {/* Direction */}
              <Box paddingBottom={4}>
                <Field.Root>
                  <Field.Label>Sync Direction</Field.Label>
                  <SingleSelect
                    value={formData.direction}
                    onChange={(value) => setFormData((p) => ({ ...p, direction: value }))}
                  >
                    {DIRECTION_OPTIONS.map((opt) => (
                      <SingleSelectOption key={opt.value} value={opt.value}>
                        {opt.label}
                      </SingleSelectOption>
                    ))}
                  </SingleSelect>
                </Field.Root>
              </Box>

              {/* Conflict Strategy */}
              <Box paddingBottom={4}>
                <Field.Root>
                  <Field.Label>Conflict Strategy</Field.Label>
                  <SingleSelect
                    value={formData.conflictStrategy}
                    onChange={(value) => setFormData((p) => ({ ...p, conflictStrategy: value }))}
                  >
                    {CONFLICT_STRATEGY_OPTIONS.map((opt) => (
                      <SingleSelectOption key={opt.value} value={opt.value}>
                        {opt.label}
                      </SingleSelectOption>
                    ))}
                  </SingleSelect>
                  <Field.Hint>How to resolve when the same record is modified on both sides</Field.Hint>
                </Field.Root>
              </Box>

              {/* Active Checkbox */}
              <Box paddingBottom={4}>
                <Checkbox
                  checked={formData.isActive}
                  onCheckedChange={(checked) => setFormData((p) => ({ ...p, isActive: checked }))}
                >
                  Set as Active Profile
                </Checkbox>
                <Box paddingTop={1}>
                  <Typography variant="pi" textColor="neutral500">
                    Only one profile can be active per content type.
                  </Typography>
                </Box>
              </Box>

              {/* Advanced Mode: Field Policies */}
              {createMode === 'advanced' && formData.contentType && (
                <Box>
                  <Typography variant="delta" paddingBottom={2}>
                    Field Policies
                  </Typography>
                  <Typography variant="pi" textColor="neutral500" paddingBottom={4}>
                    Override sync direction for individual fields.
                  </Typography>

                  {loadingSchema ? (
                    <Typography>Loading fields...</Typography>
                  ) : schemaFields.length === 0 ? (
                    <Typography textColor="neutral500">No fields found</Typography>
                  ) : (
                    <Box background="neutral100" padding={4} hasRadius style={{ maxHeight: '300px', overflow: 'auto' }}>
                      {schemaFields.map((field) => (
                        <Flex
                          key={field.name}
                          justifyContent="space-between"
                          alignItems="center"
                          paddingBottom={2}
                        >
                          <Box>
                            <Typography variant="omega" fontWeight="bold">
                              {field.name}
                            </Typography>
                            <Typography variant="pi" textColor="neutral500">
                              {field.type}
                            </Typography>
                          </Box>
                          <Box style={{ minWidth: '140px' }}>
                            <SingleSelect
                              value={getFieldPolicy(field.name)}
                              onChange={(value) => handleFieldPolicyChange(field.name, value)}
                              size="S"
                            >
                              {FIELD_DIRECTION_OPTIONS.map((opt) => (
                                <SingleSelectOption key={opt.value} value={opt.value}>
                                  {opt.label}
                                </SingleSelectOption>
                              ))}
                            </SingleSelect>
                          </Box>
                        </Flex>
                      ))}
                    </Box>
                  )}
                </Box>
              )}
            </Modal.Body>
            <Modal.Footer>
              <Modal.Close>
                <Button variant="tertiary">Cancel</Button>
              </Modal.Close>
              <Button onClick={handleSave} disabled={!formData.name || !formData.contentType}>
                {editingProfile ? 'Update Profile' : 'Create Profile'}
              </Button>
            </Modal.Footer>
          </Modal.Content>
        </Modal.Root>
      )}
    </Box>
  );
};

export { SyncProfilesTab };
export default SyncProfilesTab;
