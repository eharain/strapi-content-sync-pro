import { useEffect, useMemo, useRef, useState } from 'react';
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
  Table,
  Thead,
  Tbody,
  Tr,
  Th,
  Td,
  Badge,
  Loader,
} from '@strapi/design-system';
import { useFetchClient } from '@strapi/strapi/admin';

const PLUGIN_ID = 'strapi-content-sync-pro';

const DIRECTIONS = [
  { value: 'pull', label: 'Full Pull (Remote → Local)' },
  { value: 'push', label: 'Full Push (Local → Remote)' },
];

const STATUS_VARIANT = {
  pending: 'secondary',
  running: 'warning',
  paused: 'secondary',
  success: 'success',
  skipped: 'secondary',
  error: 'danger',
};

const BulkTransferTab = ({ syncMode = 'paired' }) => {
  const { get, post } = useFetchClient();

  const [direction, setDirection] = useState('pull');
  const [scopes, setScopes] = useState({
    content: true,
    media: false,
    users: false,
    admins: false,
  });
  const [syncDeletions, setSyncDeletions] = useState(false);
  const [autoContinue, setAutoContinue] = useState(true);
  const [conflictStrategy, setConflictStrategy] = useState('latest');

  const [preview, setPreview] = useState(null);
  const [job, setJob] = useState(null);
  const [message, setMessage] = useState(null);
  const [busy, setBusy] = useState(false);

  const pollRef = useRef(null);

  const scopeCount = Object.values(scopes).filter(Boolean).length;

  useEffect(() => {
    if (syncMode === 'single_side' && direction === 'push') {
      setDirection('pull');
    }
  }, [syncMode, direction]);

  // Refresh preview when choices change
  useEffect(() => {
    let cancelled = false;
    async function loadPreview() {
      if (scopeCount === 0) {
        setPreview(null);
        return;
      }
      try {
        const { data } = await post(`/${PLUGIN_ID}/bulk-transfer/preview`, { direction, scopes });
        if (!cancelled) setPreview(data?.data || null);
      } catch (err) {
        if (!cancelled) setPreview(null);
      }
    }
    loadPreview();
    return () => { cancelled = true; };
  }, [direction, scopes, scopeCount, post]);

  useEffect(() => {
    // Poll job status while it is running or paused so the UI keeps showing
    // page-level progress and can be resumed.
    if (!job || (job.status !== 'running' && job.status !== 'paused')) {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
      return;
    }
    pollRef.current = setInterval(async () => {
      try {
        const { data } = await get(`/${PLUGIN_ID}/bulk-transfer/jobs/${job.id}`);
        setJob(data?.data || null);
      } catch (err) {
        // swallow transient errors
      }
    }, 1500);
    return () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; } };
  }, [job?.id, job?.status, get]);

  const handleToggleScope = (key) => {
    setScopes((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const handleStart = async () => {
    setMessage(null);
    setBusy(true);
    try {
      const { data } = await post(`/${PLUGIN_ID}/bulk-transfer/start`, {
        direction,
        scopes,
        syncDeletions,
        autoContinue,
        conflictStrategy,
      });
      setJob(data?.data || null);
      setMessage({ type: 'success', text: 'Bulk transfer started.' });
    } catch (err) {
      setMessage({ type: 'danger', text: err?.response?.data?.error?.message || err.message || 'Failed to start bulk transfer' });
    } finally {
      setBusy(false);
    }
  };

  const handleNext = async () => {
    if (!job) return;
    setBusy(true);
    try {
      const { data } = await post(`/${PLUGIN_ID}/bulk-transfer/jobs/${job.id}/next`);
      setJob(data?.data || null);
    } catch (err) {
      setMessage({ type: 'danger', text: err?.response?.data?.error?.message || err.message || 'Failed to advance job' });
    } finally {
      setBusy(false);
    }
  };

  const handleRunAll = async () => {
    if (!job) return;
    setBusy(true);
    try {
      const { data } = await post(`/${PLUGIN_ID}/bulk-transfer/jobs/${job.id}/run-all`);
      setJob(data?.data || null);
    } catch (err) {
      setMessage({ type: 'danger', text: err?.response?.data?.error?.message || err.message || 'Failed to run remaining chunks' });
    } finally {
      setBusy(false);
    }
  };

  const handleCancel = async () => {
    if (!job) return;
    try {
      const { data } = await post(`/${PLUGIN_ID}/bulk-transfer/jobs/${job.id}/cancel`);
      setJob(data?.data || null);
    } catch (err) {
      setMessage({ type: 'danger', text: err?.response?.data?.error?.message || err.message || 'Failed to cancel job' });
    }
  };

  const handlePause = async () => {
    if (!job) return;
    try {
      const { data } = await post(`/${PLUGIN_ID}/bulk-transfer/jobs/${job.id}/pause`);
      setJob(data?.data || null);
    } catch (err) {
      setMessage({ type: 'danger', text: err?.response?.data?.error?.message || err.message || 'Failed to pause job' });
    }
  };

  const handleResume = async () => {
    if (!job) return;
    setBusy(true);
    try {
      const { data } = await post(`/${PLUGIN_ID}/bulk-transfer/jobs/${job.id}/resume`);
      setJob(data?.data || null);
    } catch (err) {
      setMessage({ type: 'danger', text: err?.response?.data?.error?.message || err.message || 'Failed to resume job' });
    } finally {
      setBusy(false);
    }
  };

  const chunkRows = useMemo(() => job?.chunks || preview?.chunks || [], [job, preview]);
  const runningOrDone = !!job;
  const isRunning = job?.status === 'running';
  const isPaused = job?.status === 'paused';
  const isActive = isRunning || isPaused;
  const isTerminal = job && ['success', 'partial', 'cancelled', 'error'].includes(job.status);

  const jobStats = useMemo(() => {
    if (!job) return null;
    const totals = (job.chunks || []).reduce(
      (acc, c) => {
        acc.pushed += c.pushed || 0;
        acc.pulled += c.pulled || 0;
        acc.errors += c.errors || 0;
        acc.pagesDone += c.page || 0;
        if (c.pagesTotal) acc.pagesTotal += c.pagesTotal;
        return acc;
      },
      { pushed: 0, pulled: 0, errors: 0, pagesDone: 0, pagesTotal: 0 }
    );
    const currentChunk = (job.chunks || []).find((c) => c.status === 'running')
      || (job.chunks || []).find((c) => c.status === 'paused')
      || (job.chunks || [])[job.cursor]
      || null;
    return { ...totals, currentChunk };
  }, [job]);

  return (
    <Box>
      <Typography variant="beta" tag="h2">Bulk Transfer</Typography>
      <Typography variant="omega" textColor="neutral600">
        One-click full pull or full push across selected scopes. The transfer runs chunk-by-chunk
        (one content type / media profile per chunk) and can auto-advance or pause between chunks.
      </Typography>

      {syncMode === 'single_side' && (
        <Box paddingTop={4}>
          <Alert variant="info" title="Single-side mode">
            Only full pull is available because this instance is configured as single-side.
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

      <Box paddingTop={4}>
        <Flex gap={4} wrap="wrap" alignItems="flex-end">
          <Box style={{ width: 280 }}>
            <Field.Root>
              <Field.Label>Direction</Field.Label>
              <SingleSelect value={direction} onChange={setDirection} disabled={runningOrDone && isRunning}>
                {DIRECTIONS.map((d) => (
                  <SingleSelectOption
                    key={d.value}
                    value={d.value}
                    disabled={syncMode === 'single_side' && d.value === 'push'}
                  >
                    {d.label}
                  </SingleSelectOption>
                ))}
              </SingleSelect>
            </Field.Root>
          </Box>

          <Box style={{ width: 220 }}>
            <Field.Root>
              <Field.Label>Conflict Strategy</Field.Label>
              <SingleSelect value={conflictStrategy} onChange={setConflictStrategy} disabled={runningOrDone && isRunning}>
                <SingleSelectOption value="latest">Latest updated wins</SingleSelectOption>
                <SingleSelectOption value="local">Local wins</SingleSelectOption>
                <SingleSelectOption value="remote">Remote wins</SingleSelectOption>
              </SingleSelect>
            </Field.Root>
          </Box>
        </Flex>
      </Box>

      <Box paddingTop={4}>
        <Typography variant="delta">Scope</Typography>
        <Box paddingTop={2}>
          <Flex direction="column" gap={2}>
            <Flex gap={2} alignItems="center">
              <Checkbox
                checked={scopes.content}
                onCheckedChange={() => handleToggleScope('content')}
                disabled={isRunning}
              />
              <Typography>User-generated content (all <code>api::*</code> collection types)</Typography>
            </Flex>
            <Flex gap={2} alignItems="center">
              <Checkbox
                checked={scopes.media}
                onCheckedChange={() => handleToggleScope('media')}
                disabled={isRunning}
              />
              <Typography>Media (files + morph links, via active media profiles)</Typography>
            </Flex>
            <Flex gap={2} alignItems="center">
              <Checkbox
                checked={scopes.users}
                onCheckedChange={() => handleToggleScope('users')}
                disabled={isRunning}
              />
              <Typography>Strapi Users (<code>plugin::users-permissions.user</code>)</Typography>
            </Flex>
            <Flex gap={2} alignItems="center">
              <Checkbox
                checked={scopes.admins}
                onCheckedChange={() => handleToggleScope('admins')}
                disabled={isRunning}
              />
              <Typography>Admin Users (<code>admin::user</code>) — experimental</Typography>
            </Flex>
          </Flex>
        </Box>
      </Box>

      <Box paddingTop={4}>
        <Typography variant="delta">Run Options</Typography>
        <Box paddingTop={2}>
          <Flex direction="column" gap={2}>
            <Flex gap={2} alignItems="center">
              <Checkbox
                checked={syncDeletions}
                onCheckedChange={() => setSyncDeletions((v) => !v)}
                disabled={isRunning}
              />
              <Typography>Also apply deletions (destination removes items missing on source)</Typography>
            </Flex>
            <Flex gap={2} alignItems="center">
              <Checkbox
                checked={autoContinue}
                onCheckedChange={() => setAutoContinue((v) => !v)}
                disabled={isRunning}
              />
              <Typography>Auto-continue to next chunk (uncheck to stop after each chunk)</Typography>
            </Flex>
          </Flex>
        </Box>
      </Box>

      {(scopes.users || scopes.admins) && syncDeletions && (
        <Box paddingTop={4}>
          <Alert variant="warning" title="Deletion sync on user scopes">
            Enabling deletions on Users or Admin Users can remove accounts on the destination that
            do not exist on the source. Proceed with care.
          </Alert>
        </Box>
      )}

      <Box paddingTop={4}>
        <Flex gap={2} wrap="wrap">
          <Button
            onClick={handleStart}
            loading={busy && !job}
            disabled={busy || scopeCount === 0 || isActive}
          >
            {direction === 'pull' ? 'Start Full Pull' : 'Start Full Push'}
          </Button>
          {job && job.status === 'running' && !autoContinue && (
            <Button variant="secondary" onClick={handleNext} loading={busy} disabled={busy}>
              Run Next Chunk
            </Button>
          )}
          {job && job.status === 'running' && (
            <>
              <Button variant="tertiary" onClick={handleRunAll} disabled={busy}>
                Run All Remaining
              </Button>
              <Button variant="secondary" onClick={handlePause} disabled={busy}>
                Pause
              </Button>
              <Button variant="danger-light" onClick={handleCancel}>
                Cancel
              </Button>
            </>
          )}
          {job && job.status === 'paused' && (
            <>
              <Button onClick={handleResume} loading={busy} disabled={busy}>
                Resume
              </Button>
              {!autoContinue && (
                <Button variant="secondary" onClick={handleNext} disabled={busy}>
                  Run Next Page/Chunk
                </Button>
              )}
              <Button variant="danger-light" onClick={handleCancel}>
                Cancel
              </Button>
            </>
          )}
          {isTerminal && (
            <Button variant="tertiary" onClick={() => setJob(null)}>
              Start New Transfer
            </Button>
          )}
          {isActive && jobStats && (
            <Flex gap={2} alignItems="center" style={{ marginLeft: 'auto' }}>
              {isRunning && <Loader small>Running…</Loader>}
              {isPaused && (
                <Badge backgroundColor="warning100" textColor="warning700">Paused</Badge>
              )}
              <Typography variant="pi" textColor="neutral700">
                Chunk {job.cursor + (isTerminal ? 0 : 1)}/{job.total}
                {jobStats.currentChunk?.label ? ` · ${jobStats.currentChunk.label}` : ''}
                {jobStats.currentChunk?.pagesTotal
                  ? ` · page ${jobStats.currentChunk.page || 0}/${jobStats.currentChunk.pagesTotal}`
                  : jobStats.currentChunk?.page
                    ? ` · page ${jobStats.currentChunk.page}`
                    : ''}
                {' · '}pushed {jobStats.pushed} · pulled {jobStats.pulled}
                {jobStats.errors ? ` · ${jobStats.errors} error(s)` : ''}
              </Typography>
            </Flex>
          )}
          {preview && !job && (
            <Typography variant="pi" textColor="neutral500" style={{ alignSelf: 'center' }}>
              Plan: {preview.total} chunk{preview.total === 1 ? '' : 's'}
            </Typography>
          )}
        </Flex>
      </Box>

      {chunkRows.length > 0 && (
        <Box paddingTop={4}>
          <Typography variant="delta">
            {job ? `Chunks (${job.cursor}/${job.total})` : `Planned Chunks (${preview?.total || chunkRows.length})`}
          </Typography>
          <Box paddingTop={2}>
            <Table>
              <Thead>
                <Tr>
                  <Th style={{ width: 60 }}><Typography variant="sigma">#</Typography></Th>
                  <Th><Typography variant="sigma">Kind</Typography></Th>
                  <Th><Typography variant="sigma">Target</Typography></Th>
                  <Th><Typography variant="sigma">Status</Typography></Th>
                  <Th><Typography variant="sigma">Page</Typography></Th>
                  <Th><Typography variant="sigma">Pushed / Pulled</Typography></Th>
                  <Th><Typography variant="sigma">Notes</Typography></Th>
                </Tr>
              </Thead>
              <Tbody>
                {chunkRows.map((c) => {
                  const pageLabel = c.pagesTotal
                    ? `${c.page || 0}/${c.pagesTotal}`
                    : c.page
                      ? `${c.page}`
                      : '—';
                  const pushPullLabel = (c.pushed || c.pulled || c.errors)
                    ? `${c.pushed || 0} / ${c.pulled || 0}${c.errors ? ` (err ${c.errors})` : ''}`
                    : '—';
                  return (
                    <Tr key={c.index}>
                      <Td><Typography>{c.index + 1}</Typography></Td>
                      <Td><Badge>{c.kind}</Badge></Td>
                      <Td><Typography>{c.label}</Typography></Td>
                      <Td>
                        <Flex gap={2} alignItems="center">
                          {c.status === 'running' && <Loader small />}
                          <Badge active={c.status === 'running' || c.status === 'success'}>
                            {c.status}
                          </Badge>
                        </Flex>
                      </Td>
                      <Td><Typography variant="pi">{pageLabel}</Typography></Td>
                      <Td><Typography variant="pi">{pushPullLabel}</Typography></Td>
                      <Td>
                        {c.error && <Typography textColor="danger600" variant="pi">{c.error}</Typography>}
                        {!c.error && c.warning && <Typography textColor="warning600" variant="pi">{c.warning}</Typography>}
                      </Td>
                    </Tr>
                  );
                })}
              </Tbody>
            </Table>
          </Box>
        </Box>
      )}

      {job && job.status && job.status !== 'running' && (
        <Box paddingTop={4}>
          <Alert
            variant={job.status === 'success' ? 'success' : job.status === 'partial' ? 'warning' : 'danger'}
            closeLabel="Close"
            onClose={() => {}}
          >
            Transfer {job.status}. Ran {job.cursor}/{job.total} chunks
            {job.errors?.length ? `, ${job.errors.length} error(s)` : ''}.
          </Alert>
        </Box>
      )}
    </Box>
  );
};

export { BulkTransferTab };
export default BulkTransferTab;
