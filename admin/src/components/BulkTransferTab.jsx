import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Box,
  Flex,
  Typography,
  Button,
  Alert,
  Checkbox,
  SingleSelect,
  SingleSelectOption,
  TextInput,
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
import { CaretUp, CaretDown } from '@strapi/icons';
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
  // Per-chunk selection. Key = chunk.index -> boolean (true = include in run).
  // Populated from the preview plan; user can toggle individual rows or
  // use the select-all checkbox in the table header.
  const [selected, setSelected] = useState({});
  const [history, setHistory] = useState([]);
  const [historyBusy, setHistoryBusy] = useState(false);
  // History id whose chunk-level details are expanded in the Previous Runs tab.
  const [expandedHistoryId, setExpandedHistoryId] = useState(null);
  // Internal sub-tab: 'run' shows the configuration + active job,
  // 'history' shows the persisted previous-runs table.
  const [subTab, setSubTab] = useState('run');

  // Chunk table filters + sort
  const [chunkSearch, setChunkSearch] = useState('');
  const [chunkKindFilter, setChunkKindFilter] = useState('');
  const [chunkStatusFilter, setChunkStatusFilter] = useState('');
  const [chunkSortField, setChunkSortField] = useState('');
  const [chunkSortDir, setChunkSortDir] = useState('asc');

  // History table filters + sort
  const [historySearch, setHistorySearch] = useState('');
  const [historySortField, setHistorySortField] = useState('');
  const [historySortDir, setHistorySortDir] = useState('asc');

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
        if (!cancelled) {
          const p = data?.data || null;
          setPreview(p);
          // Default-select every chunk for a fresh preview; preserve existing
          // user toggles for chunks that still exist by index.
          if (p?.chunks) {
            setSelected((prev) => {
              const next = {};
              for (const c of p.chunks) {
                next[c.index] = prev[c.index] !== undefined ? prev[c.index] : true;
              }
              return next;
            });
          }
        }
      } catch (err) {
        if (!cancelled) setPreview(null);
      }
    }
    loadPreview();
    return () => { cancelled = true; };
  }, [direction, scopes, scopeCount, post]);

  // Load persisted run history on mount and whenever a job reaches a terminal
  // state, so the "Previous Runs" panel stays current.
  const loadHistory = async () => {
    try {
      const { data } = await get(`/${PLUGIN_ID}/bulk-transfer/history`);
      setHistory(data?.data?.items || []);
    } catch {
      /* ignore */
    }
  };
  useEffect(() => {
    loadHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (job && ['success', 'partial', 'cancelled', 'error', 'paused'].includes(job.status)) {
      loadHistory();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job?.status]);

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

  const handleToggleChunk = (index) => {
    setSelected((prev) => ({ ...prev, [index]: !prev[index] }));
  };

  const previewChunks = preview?.chunks || [];
  const allSelected = previewChunks.length > 0 && previewChunks.every((c) => selected[c.index]);
  const noneSelected = previewChunks.every((c) => !selected[c.index]);

  const handleToggleAll = () => {
    const target = !allSelected;
    setSelected(() => {
      const next = {};
      for (const c of previewChunks) next[c.index] = target;
      return next;
    });
  };

  const getSelectedIndexes = () =>
    previewChunks.filter((c) => selected[c.index]).map((c) => c.index);

  const handleStart = async () => {
    setMessage(null);
    setBusy(true);
    try {
      const selectedIndexes = getSelectedIndexes();
      if (previewChunks.length > 0 && selectedIndexes.length === 0) {
        throw new Error('Select at least one chunk to run.');
      }
      const { data } = await post(`/${PLUGIN_ID}/bulk-transfer/start`, {
        direction,
        scopes,
        syncDeletions,
        autoContinue,
        conflictStrategy,
        selectedIndexes,
      });
      setJob(data?.data || null);
      setMessage({ type: 'success', text: `Bulk transfer started (${selectedIndexes.length} chunk(s)).` });
    } catch (err) {
      setMessage({ type: 'danger', text: err?.response?.data?.error?.message || err.message || 'Failed to start bulk transfer' });
    } finally {
      setBusy(false);
    }
  };

  const handleRestartFromHistory = async (historyId, overrides = {}) => {
    setHistoryBusy(true);
    setMessage(null);
    try {
      const { data } = await post(
        `/${PLUGIN_ID}/bulk-transfer/history/${historyId}/restart`,
        overrides
      );
      setJob(data?.data || null);
      setSubTab('run');
      setMessage({ type: 'success', text: 'Restarted bulk transfer from history.' });
      await loadHistory();
    } catch (err) {
      setMessage({ type: 'danger', text: err?.response?.data?.error?.message || err.message || 'Failed to restart from history' });
    } finally {
      setHistoryBusy(false);
    }
  };

  const handleResumeFromHistory = async (historyId) => {
    setHistoryBusy(true);
    setMessage(null);
    try {
      const { data } = await post(
        `/${PLUGIN_ID}/bulk-transfer/history/${historyId}/resume`,
        {}
      );
      const jobData = data?.data || null;
      // Rehydrate the Run Transfer form so the UI visibly restores the
      // configuration and chunk selection exactly as they were when paused.
      const rs = jobData?.restoredState;
      if (rs) {
        setDirection(rs.direction || 'pull');
        setScopes({
          content: !!rs.scopes?.content,
          media: !!rs.scopes?.media,
          users: !!rs.scopes?.users,
          admins: !!rs.scopes?.admins,
        });
        setSyncDeletions(!!rs.syncDeletions);
        setAutoContinue(!!rs.autoContinue);
        setConflictStrategy(rs.conflictStrategy || 'latest');
        const sel = {};
        const selSet = new Set((rs.selectedIndexes || []).map(Number));
        for (const c of jobData?.chunks || []) sel[c.index] = selSet.has(c.index);
        setSelected(sel);
      }
      setJob(jobData);
      setSubTab('run');
      setMessage({ type: 'success', text: 'Resumed bulk transfer from where it left off.' });
      await loadHistory();
    } catch (err) {
      setMessage({ type: 'danger', text: err?.response?.data?.error?.message || err.message || 'Failed to resume from history' });
    } finally {
      setHistoryBusy(false);
    }
  };

  const handleLoadFromHistory = (entry) => {
    // Rehydrate the form with the historical selection so the user can tweak
    // and then press Start as usual. Does not create a job.
    setDirection(entry.direction);
    setScopes({
      content: !!entry.scopes?.content,
      media: !!entry.scopes?.media,
      users: !!entry.scopes?.users,
      admins: !!entry.scopes?.admins,
    });
    setSyncDeletions(!!entry.syncDeletions);
    setAutoContinue(!!entry.autoContinue);
    setConflictStrategy(entry.conflictStrategy || 'latest');
    const sel = {};
    for (const c of entry.chunks || []) sel[c.index] = c.selected !== false;
    setSelected(sel);
    setJob(null);
    setSubTab('run');
    setMessage({ type: 'info', text: `Loaded selection from run ${entry.id}. Adjust and press Start.` });
  };

  const handleClearHistory = async () => {
    setHistoryBusy(true);
    try {
      await post(`/${PLUGIN_ID}/bulk-transfer/history/clear`);
      await loadHistory();
    } catch (err) {
      setMessage({ type: 'danger', text: err?.response?.data?.error?.message || err.message || 'Failed to clear history' });
    } finally {
      setHistoryBusy(false);
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

  // Derived chunk list (filter + sort)
  const displayedChunks = useMemo(() => {
    let result = [...chunkRows];
    if (chunkSearch.trim()) {
      const q = chunkSearch.trim().toLowerCase();
      result = result.filter(
        (c) => (c.label || '').toLowerCase().includes(q) || (c.kind || '').toLowerCase().includes(q)
      );
    }
    if (chunkKindFilter) {
      result = result.filter((c) => (c.kind || '') === chunkKindFilter);
    }
    if (chunkStatusFilter) {
      result = result.filter((c) => (c.status || '') === chunkStatusFilter);
    }
    if (chunkSortField) {
      result.sort((a, b) => {
        const aVal = a[chunkSortField] ?? '';
        const bVal = b[chunkSortField] ?? '';
        if (typeof aVal === 'string') {
          return chunkSortDir === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
        }
        return chunkSortDir === 'asc' ? aVal - bVal : bVal - aVal;
      });
    }
    return result;
  }, [chunkRows, chunkSearch, chunkKindFilter, chunkStatusFilter, chunkSortField, chunkSortDir]);

  // Derived history list (filter + sort)
  const displayedHistory = useMemo(() => {
    let result = [...history];
    if (historySearch.trim()) {
      const q = historySearch.trim().toLowerCase();
      result = result.filter((h) => (h.direction || '').toLowerCase().includes(q) || (h.status || '').toLowerCase().includes(q));
    }
    if (historySortField) {
      result.sort((a, b) => {
        const aVal = a[historySortField] ?? '';
        const bVal = b[historySortField] ?? '';
        if (typeof aVal === 'string') {
          return historySortDir === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
        }
        return historySortDir === 'asc' ? aVal - bVal : bVal - aVal;
      });
    }
    return result;
  }, [history, historySearch, historySortField, historySortDir]);

  const handleChunkSort = (field) => {
    if (chunkSortField === field) setChunkSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setChunkSortField(field); setChunkSortDir('asc'); }
  };

  const handleHistorySort = (field) => {
    if (historySortField === field) setHistorySortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setHistorySortField(field); setHistorySortDir('asc'); }
  };

  const SortableTh = ({ field, onSort, sortF, sortD, style, children }) => (
    <Th onClick={() => onSort(field)} style={{ cursor: 'pointer', userSelect: 'none', ...style }}>
      <Flex alignItems="center" gap={1}>
        <Typography variant="sigma">{children}</Typography>
        {sortF === field && (sortD === 'asc' ? <CaretUp /> : <CaretDown />)}
      </Flex>
    </Th>
  );

  // Chunk kind options from current rows
  const chunkKindOptions = useMemo(() => [...new Set(chunkRows.map((c) => c.kind).filter(Boolean))], [chunkRows]);
  const chunkStatusOptions = useMemo(() => [...new Set(chunkRows.map((c) => c.status).filter(Boolean))], [chunkRows]);

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

      <Box paddingTop={3} paddingBottom={1}>
        <Flex gap={2}>
          <Button
            variant={subTab === 'run' ? 'default' : 'tertiary'}
            onClick={() => setSubTab('run')}
          >
            Run Transfer
          </Button>
          <Button
            variant={subTab === 'history' ? 'default' : 'tertiary'}
            onClick={() => setSubTab('history')}
          >
            Previous Runs{history.length ? ` (${history.length})` : ''}
          </Button>
        </Flex>
      </Box>

      {subTab === 'run' && (<>

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
            disabled={busy || scopeCount === 0 || isActive || (previewChunks.length > 0 && noneSelected)}
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
              {previewChunks.length > 0
                ? ` · selected ${getSelectedIndexes().length}/${previewChunks.length}`
                : ''}
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
            {/* Chunk filter bar */}
            <Flex gap={2} wrap="wrap" marginBottom={2} alignItems="flex-end">
              <Box style={{ flex: '1 1 180px', minWidth: 150 }}>
                <TextInput
                  placeholder="Search target or kind…"
                  value={chunkSearch}
                  onChange={(e) => setChunkSearch(e.target.value)}
                  label="Search"
                  size="S"
                />
              </Box>
              {chunkKindOptions.length > 1 && (
                <Box style={{ minWidth: 130 }}>
                  <SingleSelect
                    placeholder="All kinds"
                    value={chunkKindFilter}
                    onChange={setChunkKindFilter}
                    onClear={() => setChunkKindFilter('')}
                    size="S"
                    label="Kind"
                  >
                    {chunkKindOptions.map((k) => (
                      <SingleSelectOption key={k} value={k}>{k}</SingleSelectOption>
                    ))}
                  </SingleSelect>
                </Box>
              )}
              {job && chunkStatusOptions.length > 1 && (
                <Box style={{ minWidth: 130 }}>
                  <SingleSelect
                    placeholder="All statuses"
                    value={chunkStatusFilter}
                    onChange={setChunkStatusFilter}
                    onClear={() => setChunkStatusFilter('')}
                    size="S"
                    label="Status"
                  >
                    {chunkStatusOptions.map((s) => (
                      <SingleSelectOption key={s} value={s}>{s}</SingleSelectOption>
                    ))}
                  </SingleSelect>
                </Box>
              )}
              {(chunkSearch || chunkKindFilter || chunkStatusFilter) && (
                <Button variant="tertiary" size="S" onClick={() => { setChunkSearch(''); setChunkKindFilter(''); setChunkStatusFilter(''); }}>
                  Clear
                </Button>
              )}
            </Flex>

            <Table>
              <Thead>
                <Tr>
                  <Th style={{ width: 48 }}>
                    {!job && previewChunks.length > 0 ? (
                      <Checkbox
                        checked={allSelected ? true : noneSelected ? false : 'indeterminate'}
                        onCheckedChange={handleToggleAll}
                      />
                    ) : (
                      <Typography variant="sigma">Run</Typography>
                    )}
                  </Th>
                  <SortableTh field="index" onSort={handleChunkSort} sortF={chunkSortField} sortD={chunkSortDir} style={{ width: 60 }}>#</SortableTh>
                  <SortableTh field="kind" onSort={handleChunkSort} sortF={chunkSortField} sortD={chunkSortDir}>Kind</SortableTh>
                  <SortableTh field="label" onSort={handleChunkSort} sortF={chunkSortField} sortD={chunkSortDir}>Target</SortableTh>
                  <SortableTh field="status" onSort={handleChunkSort} sortF={chunkSortField} sortD={chunkSortDir}>Status</SortableTh>
                  <Th><Typography variant="sigma">Page</Typography></Th>
                  <Th><Typography variant="sigma">Pushed / Pulled</Typography></Th>
                  <Th><Typography variant="sigma">Notes</Typography></Th>
                </Tr>
              </Thead>
              <Tbody>
                {displayedChunks.length === 0 ? (
                  <Tr>
                    <Td colSpan={8}>
                      <Typography textColor="neutral500">No chunks match the current filters.</Typography>
                    </Td>
                  </Tr>
                ) : displayedChunks.map((c) => {
                  const pageLabel = c.pagesTotal
                    ? `${c.page || 0}/${c.pagesTotal}`
                    : c.page
                      ? `${c.page}`
                      : '—';
                  const pushPullLabel = (c.pushed || c.pulled || c.errors)
                    ? `${c.pushed || 0} / ${c.pulled || 0}${c.errors ? ` (err ${c.errors})` : ''}`
                    : '—';
                  const isSelectedRow = job
                    ? c.selected !== false
                    : !!selected[c.index];
                  return (
                    <Tr key={c.index}>
                      <Td>
                        {!job ? (
                          <Checkbox
                            checked={isSelectedRow}
                            onCheckedChange={() => handleToggleChunk(c.index)}
                          />
                        ) : (
                          <Badge>{isSelectedRow ? 'yes' : 'no'}</Badge>
                        )}
                      </Td>
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

      </>)}

      {subTab === 'history' && (
      <Box paddingTop={4}>
        <Flex gap={2} alignItems="center" justifyContent="space-between">
          <Typography variant="delta">Previous Runs</Typography>
          {history.length > 0 && (
            <Button variant="tertiary" onClick={handleClearHistory} disabled={historyBusy}>
              Clear History
            </Button>
          )}
        </Flex>
        <Typography variant="pi" textColor="neutral600">
          Paused, cancelled, and completed runs are preserved here. Restart a run from scratch
          using the same chunk selection, or load its selection into the Run Transfer tab to tweak.
        </Typography>

        {history.length > 0 && (
          <Flex gap={2} wrap="wrap" marginTop={3} marginBottom={2} alignItems="flex-end">
            <Box style={{ flex: '1 1 180px', minWidth: 150 }}>
              <TextInput
                placeholder="Search direction or status…"
                value={historySearch}
                onChange={(e) => setHistorySearch(e.target.value)}
                label="Search"
                size="S"
              />
            </Box>
            {historySearch && (
              <Button variant="tertiary" size="S" onClick={() => setHistorySearch('')}>Clear</Button>
            )}
          </Flex>
        )}

        <Box paddingTop={2}>
          {history.length === 0 ? (
            <Typography variant="pi" textColor="neutral500">No previous runs yet.</Typography>
          ) : (
            <Table>
              <Thead>
                <Tr>
                  <SortableTh field="startedAt" onSort={handleHistorySort} sortF={historySortField} sortD={historySortDir}>When</SortableTh>
                  <SortableTh field="direction" onSort={handleHistorySort} sortF={historySortField} sortD={historySortDir}>Direction</SortableTh>
                  <SortableTh field="status" onSort={handleHistorySort} sortF={historySortField} sortD={historySortDir}>Status</SortableTh>
                  <Th><Typography variant="sigma">Chunks</Typography></Th>
                  <Th><Typography variant="sigma">Actions</Typography></Th>
                </Tr>
              </Thead>
              <Tbody>
                {displayedHistory.length === 0 ? (
                  <Tr>
                    <Td colSpan={5}>
                      <Typography textColor="neutral500">No runs match the search.</Typography>
                    </Td>
                  </Tr>
                ) : displayedHistory.map((h) => {
                  const selCount = (h.chunks || []).filter((c) => c.selected !== false).length;
                  const doneCount = (h.chunks || []).filter(
                    (c) => c.status === 'success' || c.status === 'partial'
                  ).length;
                  const remaining = Math.max(selCount - doneCount, 0);
                  const when = h.startedAt || h.createdAt;
                  const isResumable = ['paused', 'cancelled', 'error'].includes(h.status) && remaining > 0;
                  const isExpanded = expandedHistoryId === h.id;
                  const aggPushed = (h.chunks || []).reduce((s, c) => s + (c.pushed || 0), 0);
                  const aggPulled = (h.chunks || []).reduce((s, c) => s + (c.pulled || 0), 0);
                  const aggErrors = (h.chunks || []).reduce((s, c) => s + (c.errors || 0), 0);
                  return (
                    <React.Fragment key={h.id}>
                    <Tr>
                      <Td>
                        <Typography variant="pi">
                          {when ? new Date(when).toLocaleString() : '—'}
                        </Typography>
                      </Td>
                      <Td><Badge>{h.direction}</Badge></Td>
                      <Td>
                        <Badge
                          backgroundColor={
                            h.status === 'success' ? 'success100'
                            : h.status === 'partial' ? 'warning100'
                            : h.status === 'paused' ? 'warning100'
                            : h.status === 'cancelled' || h.status === 'error' ? 'danger100'
                            : 'neutral100'
                          }
                        >
                          {h.status}
                        </Badge>
                      </Td>
                      <Td>
                        <Typography variant="pi">
                          {doneCount}/{selCount} done · {h.total} total
                        </Typography>
                      </Td>
                      <Td>
                        <Flex gap={2} wrap="wrap">
                          <Button
                            size="S"
                            variant="tertiary"
                            onClick={() => setExpandedHistoryId(isExpanded ? null : h.id)}
                          >
                            {isExpanded ? 'Hide Details' : 'View Details'}
                          </Button>
                          <Button
                            size="S"
                            variant="secondary"
                            onClick={() => handleLoadFromHistory(h)}
                            disabled={historyBusy || isActive}
                          >
                            Load Selection
                          </Button>
                          {isResumable && (
                            <Button
                              size="S"
                              onClick={() => handleResumeFromHistory(h.id)}
                              disabled={historyBusy || isActive}
                            >
                              Resume
                            </Button>
                          )}
                          <Button
                            size="S"
                            variant={isResumable ? 'secondary' : 'default'}
                            onClick={() => handleRestartFromHistory(h.id)}
                            disabled={historyBusy || isActive}
                          >
                            {isResumable ? 'Restart from Scratch' : 'Start Again'}
                          </Button>
                        </Flex>
                      </Td>
                    </Tr>
                    {isExpanded && (
                      <Tr>
                        <Td colSpan={5}>
                          <Box background="neutral100" padding={3}>
                            <Flex gap={4} wrap="wrap" paddingBottom={2}>
                              <Typography variant="pi">
                                <strong>Totals:</strong> pushed {aggPushed} · pulled {aggPulled} · errors {aggErrors}
                              </Typography>
                              <Typography variant="pi">
                                <strong>Conflict:</strong> {h.conflictStrategy || 'latest'}
                              </Typography>
                              <Typography variant="pi">
                                <strong>Deletions:</strong> {h.syncDeletions ? 'yes' : 'no'}
                              </Typography>
                              {h.completedAt && (
                                <Typography variant="pi">
                                  <strong>Ended:</strong> {new Date(h.completedAt).toLocaleString()}
                                </Typography>
                              )}
                            </Flex>
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
                                {(h.chunks || []).map((c) => {
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
                                      <Td><Typography variant="pi">{c.index + 1}</Typography></Td>
                                      <Td><Badge>{c.kind}</Badge></Td>
                                      <Td><Typography variant="pi">{c.label}</Typography></Td>
                                      <Td>
                                        <Badge>{c.selected === false ? 'not selected' : c.status}</Badge>
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
                        </Td>
                      </Tr>
                    )}
                    </React.Fragment>
                  );
                })}
              </Tbody>
            </Table>
          )}
        </Box>
      </Box>
      )}
    </Box>
  );
};

export { BulkTransferTab };
export default BulkTransferTab;
