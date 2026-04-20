import { useState, useEffect } from 'react';
import {
  Box,
  Flex,
  Typography,
  TextInput,
  Textarea,
  Button,
  Alert,
  Field,
  SingleSelect,
  SingleSelectOption,
  Switch,
  NumberInput,
  Badge,
  Loader,
  Divider,
  Tabs,
  Dialog,
  IconButton,
} from '@strapi/design-system';
import { Pencil, Trash, Play, Check } from '@strapi/icons';
import { useFetchClient } from '@strapi/strapi/admin';

const PLUGIN_ID = 'strapi-content-sync-pro';

const STRATEGY_OPTIONS = [
  { value: 'disabled', label: 'Disabled' },
  { value: 'url', label: 'URL (HTTP upload/download)' },
  { value: 'rsync', label: 'rsync (file-level copy)' },
];

const DIRECTION_OPTIONS = [
  { value: 'push', label: 'Push (local → remote)' },
  { value: 'pull', label: 'Pull (remote → local)' },
  { value: 'both', label: 'Both directions' },
];

const CONFLICT_OPTIONS = [
  { value: 'latest_wins', label: 'Latest Wins' },
  { value: 'local_wins', label: 'Local Wins' },
  { value: 'remote_wins', label: 'Remote Wins' },
];

const EXECUTION_MODE_OPTIONS = [
  { value: 'on_demand', label: 'On Demand (Manual)' },
  { value: 'scheduled', label: 'Scheduled' },
  { value: 'live', label: 'Live (Real-time)' },
];

const SCHEDULE_TYPE_OPTIONS = [
  { value: 'interval', label: 'Interval (setInterval)' },
  { value: 'timeout', label: 'Timeout (chained setTimeout)' },
  { value: 'cron', label: 'Cron (wall-clock)' },
  { value: 'external', label: 'External scheduler' },
];

function patternsToText(arr) {
  return (arr || []).join('\n');
}
function textToPatterns(text) {
  return (text || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
}
function mimeToText(arr) {
  return (arr || []).join(', ');
}
function textToMime(text) {
  return (text || '').split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
}

const EMPTY_PROFILE = {
  name: '',
  strategy: 'url',
  direction: 'both',
  conflictStrategy: 'latest_wins',
  syncDbRows: true,
  syncFileBytes: true,
  includeMime: [],
  excludeMime: [],
  includePatterns: [],
  excludePatterns: [],
  dryRun: false,
  executionMode: 'on_demand',
  scheduleType: 'interval',
  scheduleInterval: 60,
  cronExpression: '',
  enabled: true,
};

const MediaTab = () => {
  const { get, put, post, del } = useFetchClient();
  const [profiles, setProfiles] = useState([]);
  const [globalSettings, setGlobalSettings] = useState({});
  const [status, setStatus] = useState(null);
  const [defaults, setDefaults] = useState(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState(null);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [testing, setTesting] = useState(false);

  // Edit modal state
  const [editProfile, setEditProfile] = useState(null);
  const [editMode, setEditMode] = useState(null); // 'create' | 'edit'

  const reload = async () => {
    try {
      const [pRes, gRes, sRes, dRes] = await Promise.all([
        get(`/${PLUGIN_ID}/media-sync/profiles`),
        get(`/${PLUGIN_ID}/media-sync/global-settings`),
        get(`/${PLUGIN_ID}/media-sync/status`),
        get(`/${PLUGIN_ID}/media-sync/defaults`),
      ]);
      setProfiles(pRes.data.data || []);
      setGlobalSettings(gRes.data.data || {});
      setStatus(sRes.data.data || {});
      setDefaults(dRes.data.data || {});
    } catch (err) {
      setMessage({ type: 'danger', text: `Failed to load: ${err?.response?.data?.error?.message || err.message}` });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { reload(); }, []);

  const handleSaveGlobal = async () => {
    setSaving(true); setMessage(null);
    try {
      const res = await put(`/${PLUGIN_ID}/media-sync/global-settings`, globalSettings);
      setGlobalSettings(res.data.data || {});
      setMessage({ type: 'success', text: 'Global settings saved.' });
    } catch (err) {
      setMessage({ type: 'danger', text: err?.response?.data?.error?.message || err.message });
    } finally { setSaving(false); }
  };

  const handleSaveProfile = async () => {
    setSaving(true); setMessage(null);
    try {
      if (editMode === 'create') {
        await post(`/${PLUGIN_ID}/media-sync/profiles`, editProfile);
        setMessage({ type: 'success', text: 'Profile created.' });
      } else {
        await put(`/${PLUGIN_ID}/media-sync/profiles/${editProfile.id}`, editProfile);
        setMessage({ type: 'success', text: 'Profile updated.' });
      }
      setEditProfile(null); setEditMode(null);
      await reload();
    } catch (err) {
      setMessage({ type: 'danger', text: err?.response?.data?.error?.message || err.message });
    } finally { setSaving(false); }
  };

  const handleDelete = async (id) => {
    if (!confirm('Delete this media profile?')) return;
    try {
      await del(`/${PLUGIN_ID}/media-sync/profiles/${id}`);
      setMessage({ type: 'success', text: 'Profile deleted.' });
      await reload();
    } catch (err) {
      setMessage({ type: 'danger', text: err?.response?.data?.error?.message || err.message });
    }
  };

  const handleActivate = async (id) => {
    try {
      await post(`/${PLUGIN_ID}/media-sync/profiles/${id}/activate`, {});
      setMessage({ type: 'success', text: 'Profile activated.' });
      await reload();
    } catch (err) {
      setMessage({ type: 'danger', text: err?.response?.data?.error?.message || err.message });
    }
  };

  const handleRunProfile = async (id) => {
    setRunning(true); setMessage(null);
    try {
      await post(`/${PLUGIN_ID}/media-sync/profiles/${id}/run`, {});
      setMessage({ type: 'success', text: 'Media sync complete.' });
      await reload();
    } catch (err) {
      setMessage({ type: 'danger', text: err?.response?.data?.error?.message || err.message });
    } finally { setRunning(false); }
  };

  const handleRunAll = async () => {
    setRunning(true); setMessage(null);
    try {
      await post(`/${PLUGIN_ID}/media-sync/run-active`, {});
      setMessage({ type: 'success', text: 'All active media profiles synced.' });
      await reload();
    } catch (err) {
      setMessage({ type: 'danger', text: err?.response?.data?.error?.message || err.message });
    } finally { setRunning(false); }
  };

  const handleTest = async () => {
    setTesting(true); setMessage(null);
    try {
      const res = await post(`/${PLUGIN_ID}/media-sync/test`, {});
      const data = res.data.data;
      setMessage({
        type: data.ok ? 'success' : 'danger',
        text: data.ok ? `Connection OK${data.version ? ` (${data.version})` : ''}` : `Test failed: ${data.error}`,
      });
    } catch (err) {
      setMessage({ type: 'danger', text: err?.response?.data?.error?.message || err.message });
    } finally { setTesting(false); }
  };

  if (loading) {
    return <Flex justifyContent="center" padding={8}><Loader /></Flex>;
  }

  const ep = editProfile || {};
  const updateEp = (patch) => setEditProfile((p) => ({ ...p, ...patch }));

  return (
    <Box padding={4}>
      <Box paddingBottom={4}>
        <Typography variant="alpha">Media Sync</Typography>
        <Typography variant="epsilon" textColor="neutral600" paddingTop={1}>
          Profile-based media synchronization for <code>plugin::upload.file</code>. Sync both file metadata (DB rows) and actual file bytes.
        </Typography>
      </Box>

      {message && (
        <Box paddingBottom={4}>
          <Alert variant={message.type} onClose={() => setMessage(null)} closeLabel="Close">{message.text}</Alert>
        </Box>
      )}

      <Tabs.Root defaultValue="profiles">
        <Tabs.List>
          <Tabs.Trigger value="profiles">Profiles</Tabs.Trigger>
          <Tabs.Trigger value="global">Global Settings</Tabs.Trigger>
          <Tabs.Trigger value="status">Status</Tabs.Trigger>
        </Tabs.List>

        {/* ── Profiles Tab ────────────────────────────────────────────── */}
        <Tabs.Content value="profiles">
          <Box paddingTop={4}>
            <Flex justifyContent="space-between" alignItems="center" paddingBottom={3}>
              <Typography variant="delta">Media Sync Profiles</Typography>
              <Flex gap={2}>
                <Button variant="secondary" onClick={handleTest} loading={testing} disabled={testing}>Test connection</Button>
                <Button variant="secondary" onClick={handleRunAll} loading={running} disabled={running}>Sync All Active</Button>
                <Button onClick={() => { setEditProfile({ ...EMPTY_PROFILE, includeMime: defaults?.mimeAll || [] }); setEditMode('create'); }}>
                  Create Profile
                </Button>
              </Flex>
            </Flex>

            {profiles.length === 0 ? (
              <Box background="neutral100" padding={6} hasRadius>
                <Typography variant="omega" textColor="neutral600">No media profiles yet. Click "Create Profile" to get started.</Typography>
              </Box>
            ) : (
              <Box>
                {/* Header */}
                <Flex background="neutral100" padding={3} hasRadius style={{ fontWeight: 600 }}>
                  <Box style={{ flex: 2 }}><Typography variant="sigma">Name</Typography></Box>
                  <Box style={{ flex: 1 }}><Typography variant="sigma">Strategy</Typography></Box>
                  <Box style={{ flex: 1 }}><Typography variant="sigma">Direction</Typography></Box>
                  <Box style={{ flex: 1 }}><Typography variant="sigma">Conflict</Typography></Box>
                  <Box style={{ flex: 1 }}><Typography variant="sigma">Execution</Typography></Box>
                  <Box style={{ flex: 1 }}><Typography variant="sigma">Sync Scope</Typography></Box>
                  <Box style={{ width: 180 }}><Typography variant="sigma">Actions</Typography></Box>
                </Flex>
                {profiles.map((p) => (
                  <Flex key={p.id} padding={3} borderColor="neutral150" style={{ borderBottom: '1px solid #eee' }} alignItems="center">
                    <Box style={{ flex: 2 }}>
                      <Flex gap={2} alignItems="center">
                        <Typography variant="omega" fontWeight={p.active ? 'bold' : 'regular'}>{p.name}</Typography>
                        {p.active && <Badge active>Active</Badge>}
                      </Flex>
                    </Box>
                    <Box style={{ flex: 1 }}><Typography variant="pi">{p.strategy}</Typography></Box>
                    <Box style={{ flex: 1 }}><Typography variant="pi">{p.direction}</Typography></Box>
                    <Box style={{ flex: 1 }}><Typography variant="pi">{(p.conflictStrategy || '').replace('_', ' ')}</Typography></Box>
                    <Box style={{ flex: 1 }}><Typography variant="pi">{(p.executionMode || '').replace('_', ' ')}</Typography></Box>
                    <Box style={{ flex: 1 }}>
                      <Typography variant="pi">
                        {p.syncDbRows && p.syncFileBytes ? 'DB + Files' : p.syncDbRows ? 'DB rows' : p.syncFileBytes ? 'Files' : 'None'}
                      </Typography>
                    </Box>
                    <Flex style={{ width: 180 }} gap={1}>
                      {!p.active && (
                        <Button variant="tertiary" size="S" onClick={() => handleActivate(p.id)} startIcon={<Check />}>Activate</Button>
                      )}
                      {p.active && (
                        <Button variant="secondary" size="S" onClick={() => handleRunProfile(p.id)} loading={running} disabled={running} startIcon={<Play />}>Run</Button>
                      )}
                      <IconButton label="Edit" onClick={() => { setEditProfile({ ...p }); setEditMode('edit'); }}><Pencil /></IconButton>
                      <IconButton label="Delete" onClick={() => handleDelete(p.id)}><Trash /></IconButton>
                    </Flex>
                  </Flex>
                ))}
              </Box>
            )}
          </Box>
        </Tabs.Content>

        {/* ── Global Settings Tab ─────────────────────────────────────── */}
        <Tabs.Content value="global">
          <Box paddingTop={4}>
            <Typography variant="delta" paddingBottom={3}>Global Media Settings</Typography>
            <Box background="neutral0" padding={4} hasRadius shadow="tableShadow" marginBottom={4}>
              <Flex gap={4} wrap="wrap">
                <Box style={{ minWidth: 220 }}>
                  <Field.Root>
                    <Field.Label>Page size</Field.Label>
                    <NumberInput value={globalSettings.pageSize || 50} onValueChange={(v) => setGlobalSettings((s) => ({ ...s, pageSize: v }))} min={1} max={500} />
                    <Field.Hint>Files per page (1-500).</Field.Hint>
                  </Field.Root>
                </Box>
                <Box style={{ minWidth: 220 }}>
                  <Field.Root>
                    <Field.Label>Batch concurrency</Field.Label>
                    <NumberInput value={globalSettings.batchConcurrency || 2} onValueChange={(v) => setGlobalSettings((s) => ({ ...s, batchConcurrency: v }))} min={1} max={10} />
                  </Field.Root>
                </Box>
                <Box style={{ minWidth: 260, alignSelf: 'center' }}>
                  <Flex alignItems="center" gap={2}>
                    <Switch checked={!!globalSettings.skipIfSameSize} onCheckedChange={(v) => setGlobalSettings((s) => ({ ...s, skipIfSameSize: v }))} />
                    <Typography>Skip when hash + size match</Typography>
                  </Flex>
                </Box>
              </Flex>

              <Divider style={{ margin: '16px 0' }} />
              <Typography variant="sigma" paddingBottom={2}>rsync defaults</Typography>
              <Flex gap={4} wrap="wrap">
                <Box style={{ minWidth: 260, flex: 1 }}>
                  <Field.Root>
                    <Field.Label>rsync command</Field.Label>
                    <TextInput value={globalSettings.rsyncCommand || 'rsync'} onChange={(e) => setGlobalSettings((s) => ({ ...s, rsyncCommand: e.target.value }))} />
                  </Field.Root>
                </Box>
                <Box style={{ minWidth: 260, flex: 1 }}>
                  <Field.Root>
                    <Field.Label>rsync args</Field.Label>
                    <TextInput value={globalSettings.rsyncArgs || '-avz --delete-after'} onChange={(e) => setGlobalSettings((s) => ({ ...s, rsyncArgs: e.target.value }))} />
                  </Field.Root>
                </Box>
              </Flex>
              <Flex gap={4} wrap="wrap" paddingTop={3}>
                <Box style={{ minWidth: 260, flex: 1 }}>
                  <Field.Root>
                    <Field.Label>Local media path</Field.Label>
                    <TextInput value={globalSettings.localMediaPath || ''} onChange={(e) => setGlobalSettings((s) => ({ ...s, localMediaPath: e.target.value }))} placeholder="./public/uploads" />
                  </Field.Root>
                </Box>
                <Box style={{ minWidth: 260, flex: 1 }}>
                  <Field.Root>
                    <Field.Label>Remote media path</Field.Label>
                    <TextInput value={globalSettings.remoteMediaPath || ''} onChange={(e) => setGlobalSettings((s) => ({ ...s, remoteMediaPath: e.target.value }))} placeholder="user@host:/srv/strapi/public/uploads" />
                  </Field.Root>
                </Box>
                <Box style={{ minWidth: 120 }}>
                  <Field.Root>
                    <Field.Label>SSH port</Field.Label>
                    <NumberInput value={globalSettings.sshPort || 22} onValueChange={(v) => setGlobalSettings((s) => ({ ...s, sshPort: v }))} min={1} max={65535} />
                  </Field.Root>
                </Box>
                <Box style={{ minWidth: 220 }}>
                  <Field.Root>
                    <Field.Label>SSH identity file</Field.Label>
                    <TextInput value={globalSettings.sshIdentityFile || ''} onChange={(e) => setGlobalSettings((s) => ({ ...s, sshIdentityFile: e.target.value }))} placeholder="~/.ssh/id_ed25519" />
                  </Field.Root>
                </Box>
              </Flex>

              <Box paddingTop={4}>
                <Button onClick={handleSaveGlobal} loading={saving} disabled={saving}>Save Global Settings</Button>
              </Box>
            </Box>
          </Box>
        </Tabs.Content>

        {/* ── Status Tab ──────────────────────────────────────────────── */}
        <Tabs.Content value="status">
          <Box paddingTop={4}>
            <Typography variant="delta" paddingBottom={3}>Media Sync Status</Typography>
            {status?.profiles?.map((sp) => (
              <Box key={sp.id} background="neutral0" padding={3} hasRadius shadow="tableShadow" marginBottom={2}>
                <Flex justifyContent="space-between" alignItems="center">
                  <Flex gap={2} alignItems="center">
                    <Typography variant="omega" fontWeight="bold">{sp.name}</Typography>
                    {sp.active && <Badge active>Active</Badge>}
                    <Badge>{sp.running ? 'Running' : 'Idle'}</Badge>
                  </Flex>
                  <Typography variant="pi" textColor="neutral600">
                    Mode: {(sp.executionMode || '').replace('_', ' ')} | Last: {sp.lastExecutedAt ? new Date(sp.lastExecutedAt).toLocaleString() : 'never'}
                  </Typography>
                </Flex>
              </Box>
            ))}
            {status?.lastResult && (
              <Box paddingTop={3} background="neutral0" padding={4} hasRadius shadow="tableShadow">
                <Typography variant="sigma">Last Run Result</Typography>
                <Typography variant="pi" style={{ fontFamily: 'monospace', whiteSpace: 'pre-wrap' }}>
                  {JSON.stringify(status.lastResult, null, 2)}
                </Typography>
              </Box>
            )}
          </Box>
        </Tabs.Content>
      </Tabs.Root>

      {/* ── Profile Edit Dialog ────────────────────────────────────────── */}
      {editProfile && (
        <Dialog.Root open onOpenChange={(open) => { if (!open) { setEditProfile(null); setEditMode(null); } }}>
          <Dialog.Content style={{ maxWidth: 720, maxHeight: '90vh', overflow: 'auto' }}>
            <Dialog.Header>{editMode === 'create' ? 'Create Media Profile' : `Edit: ${ep.name}`}</Dialog.Header>
            <Dialog.Body>
              <Flex direction="column" gap={4}>
                <Field.Root>
                  <Field.Label>Profile name</Field.Label>
                  <TextInput value={ep.name || ''} onChange={(e) => updateEp({ name: e.target.value })} placeholder="My Media Profile" />
                </Field.Root>

                <Flex gap={4} wrap="wrap">
                  <Box style={{ flex: 1, minWidth: 200 }}>
                    <Field.Root>
                      <Field.Label>Strategy</Field.Label>
                      <SingleSelect value={ep.strategy} onChange={(v) => updateEp({ strategy: v })}>
                        {STRATEGY_OPTIONS.map((o) => <SingleSelectOption key={o.value} value={o.value}>{o.label}</SingleSelectOption>)}
                      </SingleSelect>
                    </Field.Root>
                  </Box>
                  <Box style={{ flex: 1, minWidth: 200 }}>
                    <Field.Root>
                      <Field.Label>Direction</Field.Label>
                      <SingleSelect value={ep.direction} onChange={(v) => updateEp({ direction: v })}>
                        {DIRECTION_OPTIONS.map((o) => <SingleSelectOption key={o.value} value={o.value}>{o.label}</SingleSelectOption>)}
                      </SingleSelect>
                    </Field.Root>
                  </Box>
                  <Box style={{ flex: 1, minWidth: 200 }}>
                    <Field.Root>
                      <Field.Label>Conflict strategy</Field.Label>
                      <SingleSelect value={ep.conflictStrategy} onChange={(v) => updateEp({ conflictStrategy: v })}>
                        {CONFLICT_OPTIONS.map((o) => <SingleSelectOption key={o.value} value={o.value}>{o.label}</SingleSelectOption>)}
                      </SingleSelect>
                    </Field.Root>
                  </Box>
                </Flex>

                <Divider />
                <Typography variant="sigma">Sync Scope</Typography>
                <Flex gap={4}>
                  <Flex alignItems="center" gap={2}>
                    <Switch checked={!!ep.syncDbRows} onCheckedChange={(v) => updateEp({ syncDbRows: v })} />
                    <Typography>Sync DB rows (metadata)</Typography>
                  </Flex>
                  <Flex alignItems="center" gap={2}>
                    <Switch checked={!!ep.syncFileBytes} onCheckedChange={(v) => updateEp({ syncFileBytes: v })} />
                    <Typography>Sync file bytes</Typography>
                  </Flex>
                  <Flex alignItems="center" gap={2}>
                    <Switch checked={!!ep.dryRun} onCheckedChange={(v) => updateEp({ dryRun: v })} />
                    <Typography>Dry run</Typography>
                  </Flex>
                </Flex>

                <Divider />
                <Typography variant="sigma">File Type Filters</Typography>
                <Field.Root>
                  <Field.Label>Include MIME types (comma or line separated)</Field.Label>
                  <Textarea value={mimeToText(ep.includeMime)} onChange={(e) => updateEp({ includeMime: textToMime(e.target.value) })}
                    placeholder="image/, video/mp4, application/pdf" />
                  <Field.Hint>Leave empty to allow all. Common defaults: image/, video/mp4, video/webm, application/pdf, text/csv</Field.Hint>
                </Field.Root>
                <Field.Root>
                  <Field.Label>Exclude MIME types</Field.Label>
                  <Textarea value={mimeToText(ep.excludeMime)} onChange={(e) => updateEp({ excludeMime: textToMime(e.target.value) })} placeholder="video/x-msvideo" />
                </Field.Root>
                <Flex gap={4} wrap="wrap">
                  <Box style={{ flex: 1, minWidth: 200 }}>
                    <Field.Root>
                      <Field.Label>Include filename patterns</Field.Label>
                      <Textarea value={patternsToText(ep.includePatterns)} onChange={(e) => updateEp({ includePatterns: textToPatterns(e.target.value) })} placeholder={'*.jpg\n*.png'} />
                    </Field.Root>
                  </Box>
                  <Box style={{ flex: 1, minWidth: 200 }}>
                    <Field.Root>
                      <Field.Label>Exclude filename patterns</Field.Label>
                      <Textarea value={patternsToText(ep.excludePatterns)} onChange={(e) => updateEp({ excludePatterns: textToPatterns(e.target.value) })} placeholder={'*.tmp\n.DS_Store'} />
                    </Field.Root>
                  </Box>
                </Flex>

                <Divider />
                <Typography variant="sigma">Execution Settings</Typography>
                <Flex gap={4} wrap="wrap">
                  <Box style={{ flex: 1, minWidth: 200 }}>
                    <Field.Root>
                      <Field.Label>Execution mode</Field.Label>
                      <SingleSelect value={ep.executionMode} onChange={(v) => updateEp({ executionMode: v })}>
                        {EXECUTION_MODE_OPTIONS.map((o) => <SingleSelectOption key={o.value} value={o.value}>{o.label}</SingleSelectOption>)}
                      </SingleSelect>
                    </Field.Root>
                  </Box>
                  {ep.executionMode === 'scheduled' && (
                    <>
                      <Box style={{ flex: 1, minWidth: 200 }}>
                        <Field.Root>
                          <Field.Label>Schedule type</Field.Label>
                          <SingleSelect value={ep.scheduleType} onChange={(v) => updateEp({ scheduleType: v })}>
                            {SCHEDULE_TYPE_OPTIONS.map((o) => <SingleSelectOption key={o.value} value={o.value}>{o.label}</SingleSelectOption>)}
                          </SingleSelect>
                        </Field.Root>
                      </Box>
                      {(ep.scheduleType === 'interval' || ep.scheduleType === 'timeout') && (
                        <Box style={{ minWidth: 180 }}>
                          <Field.Root>
                            <Field.Label>Interval (minutes)</Field.Label>
                            <NumberInput value={ep.scheduleInterval || 60} onValueChange={(v) => updateEp({ scheduleInterval: v })} min={1} />
                          </Field.Root>
                        </Box>
                      )}
                      {ep.scheduleType === 'cron' && (
                        <Box style={{ flex: 1, minWidth: 200 }}>
                          <Field.Root>
                            <Field.Label>Cron expression</Field.Label>
                            <TextInput value={ep.cronExpression || ''} onChange={(e) => updateEp({ cronExpression: e.target.value })} placeholder="0 */2 * * *" />
                          </Field.Root>
                        </Box>
                      )}
                    </>
                  )}
                </Flex>
                <Flex alignItems="center" gap={2}>
                  <Switch checked={!!ep.enabled} onCheckedChange={(v) => updateEp({ enabled: v })} />
                  <Typography>Enabled</Typography>
                </Flex>
              </Flex>
            </Dialog.Body>
            <Dialog.Footer>
              <Dialog.Cancel>
                <Button variant="tertiary">Cancel</Button>
              </Dialog.Cancel>
              <Button onClick={handleSaveProfile} loading={saving} disabled={saving}>
                {editMode === 'create' ? 'Create' : 'Save'}
              </Button>
            </Dialog.Footer>
          </Dialog.Content>
        </Dialog.Root>
      )}
    </Box>
  );
};

export { MediaTab };
export default MediaTab;
