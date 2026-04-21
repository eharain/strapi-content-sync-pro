import { useEffect, useState } from 'react';
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
} from '@strapi/design-system';
import { useFetchClient } from '@strapi/strapi/admin';

const PLUGIN_ID = 'strapi-content-sync-pro';

const StatsTab = () => {
  const { get, post, put } = useFetchClient();
  const [snapshot, setSnapshot] = useState(null);
  const [reports, setReports] = useState([]);
  const [reportMeta, setReportMeta] = useState(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState(null);
  const [retention, setRetention] = useState({ maxLogEntries: 2000, maxReportEntries: 200 });

  const loadData = async () => {
    setLoading(true);
    try {
      const [snapshotRes, reportsRes, globalRes] = await Promise.all([
        get(`/${PLUGIN_ID}/stats/snapshot`),
        get(`/${PLUGIN_ID}/stats/reports?page=1&pageSize=20`),
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
  }, []);

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
    <Tr key={row.uid}>
      <Td><Typography>{row.uid}</Typography></Td>
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
        <Flex gap={2}>
          <Button variant="secondary" onClick={loadData}>Refresh Stats</Button>
          <Button variant="danger-light" onClick={handleClearLogs}>Clear Logs</Button>
          <Button variant="danger-light" onClick={handleClearReports}>Clear Stats Reports</Button>
        </Flex>
      </Box>

      <Box paddingTop={4}>
        <Typography variant="delta">Current Snapshot</Typography>
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
            {renderRows(snapshot?.rows || [])}
            {(!snapshot?.rows || snapshot.rows.length === 0) && (
              <Tr><Td colSpan={6}><Typography textColor="neutral500">No stats available.</Typography></Td></Tr>
            )}
          </Tbody>
        </Table>
      </Box>

      <Box paddingTop={6}>
        <Typography variant="delta">Retention Policy</Typography>
        <Flex gap={4} paddingTop={2}>
          <Box style={{ width: 240 }}>
            <Field.Root>
              <Field.Label>Max Logs</Field.Label>
              <NumberInput
                value={retention.maxLogEntries}
                onValueChange={(v) => setRetention((p) => ({ ...p, maxLogEntries: v }))}
                min={100}
              />
            </Field.Root>
          </Box>
          <Box style={{ width: 240 }}>
            <Field.Root>
              <Field.Label>Max Reports</Field.Label>
              <NumberInput
                value={retention.maxReportEntries}
                onValueChange={(v) => setRetention((p) => ({ ...p, maxReportEntries: v }))}
                min={10}
              />
            </Field.Root>
          </Box>
          <Box>
            <Button onClick={handleSaveRetention}>Save & Apply Retention</Button>
          </Box>
        </Flex>
      </Box>

      <Box paddingTop={6}>
        <Typography variant="delta">Run Reports (Before vs After)</Typography>
        <Typography variant="pi" textColor="neutral500" paddingTop={1}>
          Showing {reportMeta?.pagination?.total || 0} total reports.
        </Typography>

        {reports.map((r, idx) => (
          <Box key={r.documentId || idx} background="neutral100" hasRadius padding={4} marginTop={3}>
            <Typography variant="omega" fontWeight="bold">
              {r.runType || 'sync'} • {r.status || 'unknown'} • {r.startedAt ? new Date(r.startedAt).toLocaleString() : 'N/A'}
            </Typography>
            <Typography variant="pi" textColor="neutral600" paddingTop={1}>
              Trigger: {r.trigger || 'manual'}
            </Typography>

            <Box paddingTop={3}>
              <Typography variant="sigma">Before</Typography>
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
                  {(r.beforeStats?.rows || []).map((row) => (
                    <Tr key={`before-${r.documentId}-${row.uid}`}>
                      <Td><Typography>{row.uid}</Typography></Td>
                      <Td><Typography>{row.localCount ?? '—'}</Typography></Td>
                      <Td><Typography>{row.remoteCount ?? '—'}</Typography></Td>
                      <Td><Typography>{row.newestSide || '—'}</Typography></Td>
                    </Tr>
                  ))}
                </Tbody>
              </Table>
            </Box>

            <Box paddingTop={3}>
              <Typography variant="sigma">After</Typography>
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
                  {(r.afterStats?.rows || []).map((row) => (
                    <Tr key={`after-${r.documentId}-${row.uid}`}>
                      <Td><Typography>{row.uid}</Typography></Td>
                      <Td><Typography>{row.localCount ?? '—'}</Typography></Td>
                      <Td><Typography>{row.remoteCount ?? '—'}</Typography></Td>
                      <Td><Typography>{row.newestSide || '—'}</Typography></Td>
                    </Tr>
                  ))}
                </Tbody>
              </Table>
            </Box>
          </Box>
        ))}
      </Box>
    </Box>
  );
};

export { StatsTab };
export default StatsTab;
