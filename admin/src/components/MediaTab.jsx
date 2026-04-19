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
} from '@strapi/design-system';
import { useFetchClient } from '@strapi/strapi/admin';

const PLUGIN_ID = 'strapi-to-strapi-data-sync';

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

const DEFAULTS = {
  strategy: 'disabled',
  direction: 'push',
  pageSize: 50,
  batchConcurrency: 2,
  dryRun: false,
  skipIfSameSize: true,
  includeMime: [],
  excludeMime: [],
  rsyncCommand: 'rsync',
  rsyncArgs: '-avz --delete-after',
  localMediaPath: '',
  remoteMediaPath: '',
  sshPort: 22,
  sshIdentityFile: '',
  rsyncTimeoutMs: 30 * 60 * 1000,
  includePatterns: [],
  excludePatterns: [],
};

function patternsToText(arr) {
  return (arr || []).join('\n');
}
function textToPatterns(text) {
  return (text || '')
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

const MediaTab = () => {
  const { get, put, post } = useFetchClient();
  const [settings, setSettings] = useState(DEFAULTS);
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState(null);
  const [runResult, setRunResult] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const s = await get(`/${PLUGIN_ID}/media-sync/settings`);
        setSettings({ ...DEFAULTS, ...(s.data.data || {}) });
        const st = await get(`/${PLUGIN_ID}/media-sync/status`);
        setStatus(st.data.data);
      } catch (err) {
        setMessage({ type: 'danger', text: `Failed to load media sync settings: ${err.message}` });
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const update = (patch) => setSettings((p) => ({ ...p, ...patch }));

  const handleSave = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const res = await put(`/${PLUGIN_ID}/media-sync/settings`, settings);
      setSettings({ ...DEFAULTS, ...(res.data.data || {}) });
      setMessage({ type: 'success', text: 'Media sync settings saved.' });
    } catch (err) {
      setMessage({ type: 'danger', text: err?.response?.data?.error?.message || err.message });
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setMessage(null);
    try {
      const res = await post(`/${PLUGIN_ID}/media-sync/test`, {});
      const data = res.data.data;
      setMessage({
        type: data.ok ? 'success' : 'danger',
        text: data.ok
          ? `Connection OK${data.version ? ` (${data.version})` : ''}`
          : `Test failed: ${data.error}`,
      });
    } catch (err) {
      setMessage({ type: 'danger', text: err?.response?.data?.error?.message || err.message });
    } finally {
      setTesting(false);
    }
  };

  const handleRun = async (dryRun = false) => {
    setRunning(true);
    setMessage(null);
    setRunResult(null);
    try {
      const res = await post(`/${PLUGIN_ID}/media-sync/run`, { dryRun });
      setRunResult(res.data.data);
      setMessage({ type: 'success', text: dryRun ? 'Dry-run complete.' : 'Media sync complete.' });
      const st = await get(`/${PLUGIN_ID}/media-sync/status`);
      setStatus(st.data.data);
    } catch (err) {
      setMessage({ type: 'danger', text: err?.response?.data?.error?.message || err.message });
    } finally {
      setRunning(false);
    }
  };

  if (loading) {
    return (
      <Flex justifyContent="center" padding={8}>
        <Loader />
      </Flex>
    );
  }

  const isRsync = settings.strategy === 'rsync';
  const isUrl = settings.strategy === 'url';
  const isDisabled = settings.strategy === 'disabled';

  return (
    <Box padding={4}>
      <Box paddingBottom={4}>
        <Typography variant="alpha">Media Sync</Typography>
        <Typography variant="epsilon" textColor="neutral600" paddingTop={1}>
          Sync files from <code>plugin::upload.file</code> between two Strapi instances. Choose a strategy, direction, and pagination to safely handle large libraries.
        </Typography>
      </Box>

      {message && (
        <Box paddingBottom={4}>
          <Alert variant={message.type} onClose={() => setMessage(null)} closeLabel="Close">
            {message.text}
          </Alert>
        </Box>
      )}

      {/* Strategy */}
      <Box background="neutral0" padding={4} hasRadius shadow="tableShadow" marginBottom={4}>
        <Typography variant="delta">Strategy</Typography>
        <Box paddingTop={3}>
          <Flex gap={4} wrap="wrap">
            <Box style={{ minWidth: 280, flex: 1 }}>
              <Field.Root>
                <Field.Label>Sync strategy</Field.Label>
                <SingleSelect value={settings.strategy} onChange={(v) => update({ strategy: v })}>
                  {STRATEGY_OPTIONS.map((o) => (
                    <SingleSelectOption key={o.value} value={o.value}>{o.label}</SingleSelectOption>
                  ))}
                </SingleSelect>
                <Field.Hint>
                  {isDisabled && 'No media will be synced.'}
                  {isUrl && 'HTTP upload/download via the remote /api/upload endpoint. Works with any provider on either side.'}
                  {isRsync && 'File-level copy with rsync. Requires both sides to use the local provider and SSH access.'}
                </Field.Hint>
              </Field.Root>
            </Box>
            <Box style={{ minWidth: 280, flex: 1 }}>
              <Field.Root>
                <Field.Label>Direction</Field.Label>
                <SingleSelect value={settings.direction} onChange={(v) => update({ direction: v })}>
                  {DIRECTION_OPTIONS.map((o) => (
                    <SingleSelectOption key={o.value} value={o.value}>{o.label}</SingleSelectOption>
                  ))}
                </SingleSelect>
              </Field.Root>
            </Box>
          </Flex>
        </Box>
      </Box>

      {/* Pagination / batching */}
      <Box background="neutral0" padding={4} hasRadius shadow="tableShadow" marginBottom={4}>
        <Typography variant="delta">Pagination & batching</Typography>
        <Typography variant="pi" textColor="neutral600">
          Files are processed in pages so memory stays bounded even on very large libraries.
        </Typography>
        <Box paddingTop={3}>
          <Flex gap={4} wrap="wrap">
            <Box style={{ minWidth: 220 }}>
              <Field.Root>
                <Field.Label>Page size</Field.Label>
                <NumberInput
                  value={settings.pageSize}
                  onValueChange={(v) => update({ pageSize: v })}
                  min={1}
                  max={500}
                />
                <Field.Hint>Files listed per page (1-500).</Field.Hint>
              </Field.Root>
            </Box>
            <Box style={{ minWidth: 220 }}>
              <Field.Root>
                <Field.Label>Batch concurrency</Field.Label>
                <NumberInput
                  value={settings.batchConcurrency}
                  onValueChange={(v) => update({ batchConcurrency: v })}
                  min={1}
                  max={10}
                />
                <Field.Hint>Parallel file transfers per page (1-10).</Field.Hint>
              </Field.Root>
            </Box>
            <Box style={{ minWidth: 220, alignSelf: 'center' }}>
              <Flex alignItems="center" gap={2}>
                <Switch
                  checked={!!settings.dryRun}
                  onCheckedChange={(v) => update({ dryRun: v })}
                />
                <Typography>Dry run (no changes)</Typography>
              </Flex>
            </Box>
          </Flex>
        </Box>
      </Box>

      {/* URL strategy options */}
      {isUrl && (
        <Box background="neutral0" padding={4} hasRadius shadow="tableShadow" marginBottom={4}>
          <Typography variant="delta">URL strategy options</Typography>
          <Box paddingTop={3}>
            <Flex gap={4} wrap="wrap">
              <Box style={{ minWidth: 260, alignSelf: 'center' }}>
                <Flex alignItems="center" gap={2}>
                  <Switch
                    checked={!!settings.skipIfSameSize}
                    onCheckedChange={(v) => update({ skipIfSameSize: v })}
                  />
                  <Typography>Skip when hash + size match</Typography>
                </Flex>
              </Box>
              <Box style={{ minWidth: 260, flex: 1 }}>
                <Field.Root>
                  <Field.Label>Include MIME prefixes</Field.Label>
                  <TextInput
                    value={(settings.includeMime || []).join(',')}
                    onChange={(e) => update({ includeMime: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })}
                    placeholder="image/, application/pdf"
                  />
                  <Field.Hint>Comma-separated. Leave empty to allow all.</Field.Hint>
                </Field.Root>
              </Box>
              <Box style={{ minWidth: 260, flex: 1 }}>
                <Field.Root>
                  <Field.Label>Exclude MIME prefixes</Field.Label>
                  <TextInput
                    value={(settings.excludeMime || []).join(',')}
                    onChange={(e) => update({ excludeMime: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })}
                    placeholder="video/"
                  />
                </Field.Root>
              </Box>
            </Flex>
          </Box>
        </Box>
      )}

      {/* rsync strategy options */}
      {isRsync && (
        <Box background="neutral0" padding={4} hasRadius shadow="tableShadow" marginBottom={4}>
          <Typography variant="delta">rsync options</Typography>
          <Typography variant="pi" textColor="neutral600">
            The plugin runs the <code>rsync</code> binary on the host where Strapi is running. SSH keys, firewalls, and permissions must be configured outside Strapi.
          </Typography>
          <Box paddingTop={3}>
            <Flex gap={4} wrap="wrap">
              <Box style={{ minWidth: 260, flex: 1 }}>
                <Field.Root>
                  <Field.Label>Local media path</Field.Label>
                  <TextInput
                    value={settings.localMediaPath}
                    onChange={(e) => update({ localMediaPath: e.target.value })}
                    placeholder="./public/uploads"
                  />
                </Field.Root>
              </Box>
              <Box style={{ minWidth: 260, flex: 1 }}>
                <Field.Root>
                  <Field.Label>Remote media path</Field.Label>
                  <TextInput
                    value={settings.remoteMediaPath}
                    onChange={(e) => update({ remoteMediaPath: e.target.value })}
                    placeholder="user@host:/srv/strapi/public/uploads"
                  />
                  <Field.Hint>SSH target (user@host:/path) or a locally mounted share.</Field.Hint>
                </Field.Root>
              </Box>
            </Flex>
            <Box paddingTop={3}>
              <Flex gap={4} wrap="wrap">
                <Box style={{ minWidth: 220 }}>
                  <Field.Root>
                    <Field.Label>rsync command</Field.Label>
                    <TextInput
                      value={settings.rsyncCommand}
                      onChange={(e) => update({ rsyncCommand: e.target.value })}
                      placeholder="rsync"
                    />
                  </Field.Root>
                </Box>
                <Box style={{ minWidth: 260, flex: 1 }}>
                  <Field.Root>
                    <Field.Label>rsync args</Field.Label>
                    <TextInput
                      value={settings.rsyncArgs}
                      onChange={(e) => update({ rsyncArgs: e.target.value })}
                      placeholder="-avz --delete-after"
                    />
                    <Field.Hint>Added before source/destination. Dry-run is toggled separately.</Field.Hint>
                  </Field.Root>
                </Box>
              </Flex>
            </Box>
            <Box paddingTop={3}>
              <Flex gap={4} wrap="wrap">
                <Box style={{ minWidth: 180 }}>
                  <Field.Root>
                    <Field.Label>SSH port</Field.Label>
                    <NumberInput
                      value={settings.sshPort}
                      onValueChange={(v) => update({ sshPort: v })}
                      min={1}
                      max={65535}
                    />
                  </Field.Root>
                </Box>
                <Box style={{ minWidth: 260, flex: 1 }}>
                  <Field.Root>
                    <Field.Label>SSH identity file</Field.Label>
                    <TextInput
                      value={settings.sshIdentityFile}
                      onChange={(e) => update({ sshIdentityFile: e.target.value })}
                      placeholder="~/.ssh/id_ed25519"
                    />
                  </Field.Root>
                </Box>
                <Box style={{ minWidth: 220 }}>
                  <Field.Root>
                    <Field.Label>Timeout (ms)</Field.Label>
                    <NumberInput
                      value={settings.rsyncTimeoutMs}
                      onValueChange={(v) => update({ rsyncTimeoutMs: v })}
                      min={1000}
                    />
                  </Field.Root>
                </Box>
              </Flex>
            </Box>
          </Box>
        </Box>
      )}

      {/* Filename patterns */}
      {!isDisabled && (
        <Box background="neutral0" padding={4} hasRadius shadow="tableShadow" marginBottom={4}>
          <Typography variant="delta">Filename filters</Typography>
          <Typography variant="pi" textColor="neutral600">
            One pattern per line. Wildcards <code>*</code> and <code>?</code> supported (URL strategy). rsync passes these as <code>--include</code>/<code>--exclude</code>.
          </Typography>
          <Box paddingTop={3}>
            <Flex gap={4} wrap="wrap">
              <Box style={{ minWidth: 260, flex: 1 }}>
                <Field.Root>
                  <Field.Label>Include patterns</Field.Label>
                  <Textarea
                    value={patternsToText(settings.includePatterns)}
                    onChange={(e) => update({ includePatterns: textToPatterns(e.target.value) })}
                    placeholder={'*.jpg\n*.png'}
                  />
                </Field.Root>
              </Box>
              <Box style={{ minWidth: 260, flex: 1 }}>
                <Field.Root>
                  <Field.Label>Exclude patterns</Field.Label>
                  <Textarea
                    value={patternsToText(settings.excludePatterns)}
                    onChange={(e) => update({ excludePatterns: textToPatterns(e.target.value) })}
                    placeholder={'*.tmp\n.DS_Store'}
                  />
                </Field.Root>
              </Box>
            </Flex>
          </Box>
        </Box>
      )}

      {/* Actions */}
      <Box background="neutral0" padding={4} hasRadius shadow="tableShadow" marginBottom={4}>
        <Flex gap={2} wrap="wrap">
          <Button onClick={handleSave} loading={saving} disabled={saving}>Save settings</Button>
          <Button variant="secondary" onClick={handleTest} loading={testing} disabled={testing || isDisabled}>
            Test connection
          </Button>
          <Button variant="secondary" onClick={() => handleRun(true)} loading={running} disabled={running || isDisabled}>
            Dry run
          </Button>
          <Button variant="default" onClick={() => handleRun(false)} loading={running} disabled={running || isDisabled}>
            Run media sync now
          </Button>
        </Flex>
      </Box>

      {/* Status */}
      <Box background="neutral0" padding={4} hasRadius shadow="tableShadow" marginBottom={4}>
        <Typography variant="delta">Status</Typography>
        <Box paddingTop={2}>
          <Flex gap={2} wrap="wrap" alignItems="center">
            <Badge active={!!status?.running}>{status?.running ? 'Running' : 'Idle'}</Badge>
            <Typography variant="pi" textColor="neutral600">
              Last run: {status?.lastRunAt ? new Date(status.lastRunAt).toLocaleString() : 'never'}
            </Typography>
          </Flex>
        </Box>
        {status?.lastResult && (
          <Box paddingTop={3}>
            <Divider />
            <Box paddingTop={2}>
              <Typography variant="pi" style={{ fontFamily: 'monospace', whiteSpace: 'pre-wrap' }}>
                {JSON.stringify(status.lastResult, null, 2)}
              </Typography>
            </Box>
          </Box>
        )}
        {runResult && (
          <Box paddingTop={3}>
            <Divider />
            <Box paddingTop={2}>
              <Typography variant="sigma">Last run output</Typography>
              <Typography variant="pi" style={{ fontFamily: 'monospace', whiteSpace: 'pre-wrap' }}>
                {JSON.stringify(runResult, null, 2)}
              </Typography>
            </Box>
          </Box>
        )}
      </Box>
    </Box>
  );
};

export { MediaTab };
export default MediaTab;
