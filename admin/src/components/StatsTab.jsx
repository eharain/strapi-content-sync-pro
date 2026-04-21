import { useEffect, useMemo, useState } from 'react';
import {
  Box,
  Typography,
  Flex,
  Button,
  Table,
  Thead,
  Tbody,
  Tr,
  Th,
  Td,
  Alert,
  NumberInput,
  Field,
  Searchbar,
  SingleSelect,
  SingleSelectOption,
  Tabs,
} from '@strapi/design-system';
import { useFetchClient } from '@strapi/strapi/admin';

const PLUGIN_ID = 'strapi-content-sync-pro';
const SNAPSHOT_PAGE_SIZES = [10, 25, 50, 100];
const REPORTS_PAGE_SIZES = [5, 10, 20, 50];
const REPORT_ROW_PAGE_SIZE = 25;

const StatsTab = () => {
  const { get, post, put } = useFetchClient();
  const [snapshot, setSnapshot] = useState(null);
  const [reports, setReports] = useState([]);
  const [reportMeta, setReportMeta] = useState(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState(null);
  const [retention, setRetention] = useState({ maxLogEntries: 2000, maxReportEntries: 200 });

  // Snapshot filters / pagination
  const [snapshotSearch, setSnapshotSearch] = useState('');
  const [snapshotTypeFilter, setSnapshotTypeFilter] = useState('all'); // all | content | media | media_morph
  const [snapshotSideFilter, setSnapshotSideFilter] = useState('all'); // all | local | remote | equal
  const [snapshotPage, setSnapshotPage] = useState(1);
  const [snapshotPageSize, setSnapshotPageSize] = useState(25);

  // Reports filters / pagination
  const [reportsPage, setReportsPage] = useState(1);
  const [reportsPageSize, setReportsPageSize] = useState(10);
  const [reportsStatusFilter, setReportsStatusFilter] = useState('all'); // all | success | failed
  const [expandedReport, setExpandedReport] = useState(null);

  const loadData = async () => {
    setLoading(true);
    try {
      const [snapshotRes, reportsRes, globalRes] = await Promise.all([
        get(`/${PLUGIN_ID}/stats/snapshot`),
        get(`/${PLUGIN_ID}/stats/reports?page=${reportsPage}&pageSize=${reportsPageSize}`),
        get(`/${PLUGIN_ID}/sync-execution/global-settings`),
      ]);
      setSnapshot(snapshotRes?.data?.data || null);
      setReports(reportsRes?.data?.data || []);
      setReportMeta(reportsRes?.data?.meta || null);
      const g = globalRes?.data?.data || {};
      setRetention({
        maxLogEntries: g.maxLogEntries || 2000,
        maxReportEntries: g.maxReportEntries || 200,
      });
    } catch (err) {
      setMessage({ type: 'danger', text: err?.response?.data?.error?.message || err.message || 'Failed to load stats' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reportsPage, reportsPageSize]);

  // Filter + paginate snapshot rows client-side
  const filteredSnapshotRows = useMemo(() => {
    const rows = snapshot?.rows || [];
    const q = snapshotSearch.trim().toLowerCase();
    return rows.filter((row) => {
      if (snapshotTypeFilter !== 'all') {
        const t = row.type || 'content';
        if (t !== snapshotTypeFilter) return false;
      }
      if (snapshotSideFilter !== 'all') {
        const side = (row.newestSide || '').toLowerCase();
        if (side !== snapshotSideFilter) return false;
      }
      if (q && !String(row.uid || '').toLowerCase().includes(q)) return false;
      return true;
    });
  }, [snapshot, snapshotSearch, snapshotTypeFilter, snapshotSideFilter]);

  const snapshotTotalPages = Math.max(1, Math.ceil(filteredSnapshotRows.length / snapshotPageSize));
  const pagedSnapshotRows = useMemo(() => {
    const start = (snapshotPage - 1) * snapshotPageSize;
    return filteredSnapshotRows.slice(start, start + snapshotPageSize);
  }, [filteredSnapshotRows, snapshotPage, snapshotPageSize]);

  useEffect(() => {
    if (snapshotPage > snapshotTotalPages) setSnapshotPage(1);
  }, [snapshotTotalPages, snapshotPage]);

  const filteredReports = useMemo(() => {
    if (reportsStatusFilter === 'all') return reports;
    return reports.filter((r) => (r.status || '').toLowerCase() === reportsStatusFilter);
  }, [reports, reportsStatusFilter]);

  const handleClearLogs = async () => {
    try {
      await post(`/${PLUGIN_ID}/logs/clear`);
      setMessage({ type: 'success', text: 'Logs cleared successfully' });
      await loadData();
    } catch (err) {
      setMessage({ type: 'danger', text: err?.response?.data?.error?.message || err.message || 'Failed to clear logs' });
    }
  };

  const handleClearReports = async () => {
    try {
      await post(`/${PLUGIN_ID}/stats/reports/clear`);
      setMessage({ type: 'success', text: 'Stats reports cleared successfully' });
      await loadData();
    } catch (err) {
      setMessage({ type: 'danger', text: err?.response?.data?.error?.message || err.message || 'Failed to clear reports' });
    }
  };

  const handleSaveRetention = async () => {
    try {
      await put(`/${PLUGIN_ID}/sync-execution/global-settings`, {
        maxLogEntries: Number(retention.maxLogEntries),
        maxReportEntries: Number(retention.maxReportEntries),
      });
      await post(`/${PLUGIN_ID}/stats/retention/run`, {
        maxLogs: Number(retention.maxLogEntries),
        maxReports: Number(retention.maxReportEntries),
      });
      setMessage({ type: 'success', text: 'Retention saved and applied' });
      await loadData();
    } catch (err) {
      setMessage({ type: 'danger', text: err?.response?.data?.error?.message || err.message || 'Failed to save retention' });
    }
  };

  const renderRows = (rows = []) => rows.map((row) => (
    <Tr key={`${row.uid}-${row.type || 'content'}`}>
      <Td>
        <Typography>{row.uid}</Typography>
        {row.type && row.type !== 'content' && (
          <Typography variant="pi" textColor="neutral500">{row.type}</Typography>
        )}
      </Td>
      <Td><Typography>{row.localCount ?? '—'}</Typography></Td>
      <Td><Typography>{row.remoteCount ?? '—'}</Typography></Td>
      <Td><Typography>{row.localNewestUpdatedAt ? new Date(row.localNewestUpdatedAt).toLocaleString() : '—'}</Typography></Td>
      <Td><Typography>{row.remoteNewestUpdatedAt ? new Date(row.remoteNewestUpdatedAt).toLocaleString() : '—'}</Typography></Td>
      <Td><Typography>{row.newestSide || '—'}</Typography></Td>
    </Tr>
  ));

  if (loading) return <Typography>Loading…</Typography>;

  return (
    <Box>
      <Typography variant="beta" tag="h2">Data Stats & Reports</Typography>
      <Typography variant="omega" textColor="neutral600">
        Review local vs remote counts and newest timestamps, with before/after snapshots per sync run.
      </Typography>

      {message && (
        <Box paddingTop={4}>
          <Alert variant={message.type} closeLabel="Close" onClose={() => setMessage(null)}>
            {message.text}
          </Alert>
        </Box>
      )}

      <Box paddingTop={4}>
        <Flex justifyContent="space-between" alignItems="flex-end" gap={4} wrap="wrap">
          <Flex gap={2}>
            <Button variant="secondary" onClick={loadData}>Refresh Stats</Button>
            <Button variant="danger-light" onClick={handleClearLogs}>Clear Logs</Button>
            <Button variant="danger-light" onClick={handleClearReports}>Clear Stats Reports</Button>
          </Flex>
          <Flex gap={2} alignItems="flex-end" wrap="wrap">
            <Box style={{ width: 140 }}>
              <Field.Root>
                <Field.Label>Max Logs</Field.Label>
                <NumberInput
                  value={retention.maxLogEntries}
                  onValueChange={(v) => setRetention((p) => ({ ...p, maxLogEntries: v }))}
                  min={100}
                />
              </Field.Root>
            </Box>
            <Box style={{ width: 140 }}>
              <Field.Root>
                <Field.Label>Max Reports</Field.Label>
                <NumberInput
                  value={retention.maxReportEntries}
                  onValueChange={(v) => setRetention((p) => ({ ...p, maxReportEntries: v }))}
                  min={10}
                />
              </Field.Root>
            </Box>
            <Button onClick={handleSaveRetention}>Save & Apply Retention</Button>
          </Flex>
        </Flex>
      </Box>

      <Box paddingTop={4}>
        <Tabs.Root defaultValue="snapshot">
          <Tabs.List>
            <Tabs.Trigger value="snapshot">Current Snapshot</Tabs.Trigger>
            <Tabs.Trigger value="reports">Run Reports</Tabs.Trigger>
          </Tabs.List>

          <Tabs.Content value="snapshot">
            <Box paddingTop={4}>
              <Flex justifyContent="flex-end" alignItems="flex-end" gap={4} wrap="wrap">
                <Flex gap={2} alignItems="flex-end" wrap="wrap">
            <Box style={{ width: 260 }}>
              <Searchbar
                name="snapshotSearch"
                onClear={() => setSnapshotSearch('')}
                value={snapshotSearch}
                onChange={(e) => { setSnapshotSearch(e.target.value); setSnapshotPage(1); }}
                clearLabel="Clear search"
                placeholder="Filter by UID…"
              >
                Search
              </Searchbar>
            </Box>
            <Box style={{ width: 160 }}>
              <Field.Root>
                <Field.Label>Type</Field.Label>
                <SingleSelect
                  value={snapshotTypeFilter}
                  onChange={(v) => { setSnapshotTypeFilter(v); setSnapshotPage(1); }}
                >
                  <SingleSelectOption value="all">All</SingleSelectOption>
                  <SingleSelectOption value="content">Content</SingleSelectOption>
                  <SingleSelectOption value="media">Media</SingleSelectOption>
                  <SingleSelectOption value="media_morph">Media Morph</SingleSelectOption>
                </SingleSelect>
              </Field.Root>
            </Box>
            <Box style={{ width: 160 }}>
              <Field.Root>
                <Field.Label>Newest side</Field.Label>
                <SingleSelect
                  value={snapshotSideFilter}
                  onChange={(v) => { setSnapshotSideFilter(v); setSnapshotPage(1); }}
                >
                  <SingleSelectOption value="all">All</SingleSelectOption>
                  <SingleSelectOption value="local">Local</SingleSelectOption>
                  <SingleSelectOption value="remote">Remote</SingleSelectOption>
                  <SingleSelectOption value="equal">Equal</SingleSelectOption>
                </SingleSelect>
              </Field.Root>
            </Box>
            <Box style={{ width: 120 }}>
              <Field.Root>
                <Field.Label>Page size</Field.Label>
                <SingleSelect
                  value={String(snapshotPageSize)}
                  onChange={(v) => { setSnapshotPageSize(Number(v)); setSnapshotPage(1); }}
                >
                  {SNAPSHOT_PAGE_SIZES.map((n) => (
                    <SingleSelectOption key={n} value={String(n)}>{n}</SingleSelectOption>
                  ))}
                </SingleSelect>
              </Field.Root>
            </Box>
          </Flex>
        </Flex>

        <Table>
          <Thead>
            <Tr>
              <Th><Typography variant="sigma">Content Type</Typography></Th>
              <Th><Typography variant="sigma">Local Count</Typography></Th>
              <Th><Typography variant="sigma">Remote Count</Typography></Th>
              <Th><Typography variant="sigma">Local Newest</Typography></Th>
              <Th><Typography variant="sigma">Remote Newest</Typography></Th>
              <Th><Typography variant="sigma">Newest Side</Typography></Th>
            </Tr>
          </Thead>
          <Tbody>
            {renderRows(pagedSnapshotRows)}
            {pagedSnapshotRows.length === 0 && (
              <Tr><Td colSpan={6}><Typography textColor="neutral500">No stats match the current filters.</Typography></Td></Tr>
            )}
          </Tbody>
        </Table>

        <Flex justifyContent="space-between" alignItems="center" paddingTop={2}>
          <Typography variant="pi" textColor="neutral500">
            Showing {pagedSnapshotRows.length} of {filteredSnapshotRows.length} rows
            {snapshot?.rows ? ` (total ${snapshot.rows.length})` : ''}
          </Typography>
          <Flex gap={2} alignItems="center">
            <Button variant="tertiary" disabled={snapshotPage <= 1} onClick={() => setSnapshotPage((p) => Math.max(1, p - 1))}>Previous</Button>
            <Typography variant="pi">Page {snapshotPage} / {snapshotTotalPages}</Typography>
            <Button variant="tertiary" disabled={snapshotPage >= snapshotTotalPages} onClick={() => setSnapshotPage((p) => Math.min(snapshotTotalPages, p + 1))}>Next</Button>
          </Flex>
        </Flex>
            </Box>
          </Tabs.Content>

          <Tabs.Content value="reports">
            <Box paddingTop={4}>
        <Flex justifyContent="space-between" alignItems="flex-end" gap={4} wrap="wrap">
          <Box>
            <Typography variant="delta">Run Reports (Before vs After)</Typography>
            <Typography variant="pi" textColor="neutral500" paddingTop={1}>
              Showing {reports.length} on this page • {reportMeta?.pagination?.total || 0} total reports
            </Typography>
          </Box>
          <Flex gap={2} alignItems="flex-end" wrap="wrap">
            <Box style={{ width: 160 }}>
              <Field.Root>
                <Field.Label>Status</Field.Label>
                <SingleSelect
                  value={reportsStatusFilter}
                  onChange={(v) => setReportsStatusFilter(v)}
                >
                  <SingleSelectOption value="all">All</SingleSelectOption>
                  <SingleSelectOption value="success">Success</SingleSelectOption>
                  <SingleSelectOption value="failed">Failed</SingleSelectOption>
                </SingleSelect>
              </Field.Root>
            </Box>
            <Box style={{ width: 120 }}>
              <Field.Root>
                <Field.Label>Page size</Field.Label>
                <SingleSelect
                  value={String(reportsPageSize)}
                  onChange={(v) => { setReportsPageSize(Number(v)); setReportsPage(1); }}
                >
                  {REPORTS_PAGE_SIZES.map((n) => (
                    <SingleSelectOption key={n} value={String(n)}>{n}</SingleSelectOption>
                  ))}
                </SingleSelect>
              </Field.Root>
            </Box>
          </Flex>
        </Flex>

        {filteredReports.length === 0 && (
          <Box paddingTop={3}>
            <Typography textColor="neutral500">No reports match the current filter.</Typography>
          </Box>
        )}

        {filteredReports.map((r, idx) => {
          const reportKey = r.documentId || r.id || idx;
          const isOpen = expandedReport === reportKey;
          const beforeRows = r.beforeStats?.rows || [];
          const afterRows = r.afterStats?.rows || [];
          return (
            <Box key={reportKey} background="neutral100" hasRadius padding={4} marginTop={3}>
              <Flex justifyContent="space-between" alignItems="center" wrap="wrap" gap={2}>
                <Box>
                  <Typography variant="omega" fontWeight="bold">
                    {r.runType || 'sync'} • {r.status || 'unknown'} • {r.startedAt ? new Date(r.startedAt).toLocaleString() : 'N/A'}
                  </Typography>
                  <Typography variant="pi" textColor="neutral600" paddingTop={1}>
                    Trigger: {r.trigger || 'manual'} • Before rows: {beforeRows.length} • After rows: {afterRows.length}
                  </Typography>
                </Box>
                <Button
                  variant="tertiary"
                  onClick={() => setExpandedReport(isOpen ? null : reportKey)}
                >
                  {isOpen ? 'Hide details' : 'Show details'}
                </Button>
              </Flex>

              {isOpen && (
                <>
                  <Box paddingTop={3}>
                    <Typography variant="sigma">Before (first {Math.min(beforeRows.length, REPORT_ROW_PAGE_SIZE)} of {beforeRows.length})</Typography>
                    <Table>
                      <Thead>
                        <Tr>
                          <Th><Typography variant="sigma">Content Type</Typography></Th>
                          <Th><Typography variant="sigma">Local Count</Typography></Th>
                          <Th><Typography variant="sigma">Remote Count</Typography></Th>
                          <Th><Typography variant="sigma">Newest Side</Typography></Th>
                        </Tr>
                      </Thead>
                      <Tbody>
                        {beforeRows.slice(0, REPORT_ROW_PAGE_SIZE).map((row) => (
                          <Tr key={`before-${reportKey}-${row.uid}-${row.type || 'content'}`}>
                            <Td>
                              <Typography>{row.uid}</Typography>
                              {row.type && row.type !== 'content' && (
                                <Typography variant="pi" textColor="neutral500">{row.type}</Typography>
                              )}
                            </Td>
                            <Td><Typography>{row.localCount ?? '—'}</Typography></Td>
                            <Td><Typography>{row.remoteCount ?? '—'}</Typography></Td>
                            <Td><Typography>{row.newestSide || '—'}</Typography></Td>
                          </Tr>
                        ))}
                      </Tbody>
                    </Table>
                  </Box>

                  <Box paddingTop={3}>
                    <Typography variant="sigma">After (first {Math.min(afterRows.length, REPORT_ROW_PAGE_SIZE)} of {afterRows.length})</Typography>
                    <Table>
                      <Thead>
                        <Tr>
                          <Th><Typography variant="sigma">Content Type</Typography></Th>
                          <Th><Typography variant="sigma">Local Count</Typography></Th>
                          <Th><Typography variant="sigma">Remote Count</Typography></Th>
                          <Th><Typography variant="sigma">Newest Side</Typography></Th>
                        </Tr>
                      </Thead>
                      <Tbody>
                        {afterRows.slice(0, REPORT_ROW_PAGE_SIZE).map((row) => (
                          <Tr key={`after-${reportKey}-${row.uid}-${row.type || 'content'}`}>
                            <Td>
                              <Typography>{row.uid}</Typography>
                              {row.type && row.type !== 'content' && (
                                <Typography variant="pi" textColor="neutral500">{row.type}</Typography>
                              )}
                            </Td>
                            <Td><Typography>{row.localCount ?? '—'}</Typography></Td>
                            <Td><Typography>{row.remoteCount ?? '—'}</Typography></Td>
                            <Td><Typography>{row.newestSide || '—'}</Typography></Td>
                          </Tr>
                        ))}
                      </Tbody>
                    </Table>
                  </Box>
                </>
              )}
            </Box>
          );
        })}

        {(reportMeta?.pagination?.pageCount || 1) > 1 && (
          <Flex justifyContent="flex-end" alignItems="center" gap={2} paddingTop={3}>
            <Button variant="tertiary" disabled={reportsPage <= 1} onClick={() => setReportsPage((p) => Math.max(1, p - 1))}>Previous</Button>
            <Typography variant="pi">Page {reportsPage} / {reportMeta?.pagination?.pageCount || 1}</Typography>
            <Button
              variant="tertiary"
              disabled={reportsPage >= (reportMeta?.pagination?.pageCount || 1)}
              onClick={() => setReportsPage((p) => p + 1)}
            >
              Next
            </Button>
          </Flex>
        )}
            </Box>
          </Tabs.Content>
        </Tabs.Root>
      </Box>
    </Box>
  );
};

export { StatsTab };
export default StatsTab;
