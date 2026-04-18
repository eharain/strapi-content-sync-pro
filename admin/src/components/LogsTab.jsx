import { useState, useEffect, useCallback } from 'react';
import {
  Box,
  Flex,
  Typography,
  Button,
  SingleSelect,
  SingleSelectOption,
  Table,
  Thead,
  Tbody,
  Tr,
  Td,
  Th,
} from '@strapi/design-system';
import { useFetchClient } from '@strapi/strapi/admin';

const PLUGIN_ID = 'strapi-to-strapi-data-sync';

const LogsTab = () => {
  const { get } = useFetchClient();

  const [logs, setLogs] = useState([]);
  const [meta, setMeta] = useState(null);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState('');
  const [loading, setLoading] = useState(true);

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: '25' });
      if (statusFilter) params.set('status', statusFilter);

      const { data } = await get(`/${PLUGIN_ID}/logs?${params}`);
      setLogs(data.data || []);
      setMeta(data.meta || null);
    } catch (err) {
      console.error('Failed to fetch logs', err);
    } finally {
      setLoading(false);
    }
  }, [page, statusFilter]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  return (
    <Box>
      <Flex justifyContent="space-between" alignItems="center">
        <Typography variant="beta" tag="h2">Sync Logs</Typography>
        <Flex gap={2} alignItems="center">
          <SingleSelect
            placeholder="Filter by status"
            value={statusFilter}
            onChange={(value) => { setStatusFilter(value); setPage(1); }}
            onClear={() => { setStatusFilter(''); setPage(1); }}
          >
            <SingleSelectOption value="success">Success</SingleSelectOption>
            <SingleSelectOption value="error">Error</SingleSelectOption>
            <SingleSelectOption value="partial">Partial</SingleSelectOption>
          </SingleSelect>
          <Button variant="tertiary" onClick={fetchLogs}>Refresh</Button>
        </Flex>
      </Flex>

      <Box paddingTop={4}>
        <Table>
          <Thead>
            <Tr>
              <Th><Typography variant="sigma">Time</Typography></Th>
              <Th><Typography variant="sigma">Action</Typography></Th>
              <Th><Typography variant="sigma">Content Type</Typography></Th>
              <Th><Typography variant="sigma">Status</Typography></Th>
              <Th><Typography variant="sigma">Message</Typography></Th>
            </Tr>
          </Thead>
          <Tbody>
            {logs.map((log, i) => (
              <Tr key={log.id || i}>
                <Td><Typography>{new Date(log.createdAt).toLocaleString()}</Typography></Td>
                <Td><Typography>{log.action}</Typography></Td>
                <Td><Typography>{log.contentType}</Typography></Td>
                <Td>
                  <Typography
                    textColor={
                      log.status === 'error' ? 'danger500'
                        : log.status === 'success' ? 'success500'
                          : 'warning500'
                    }
                  >
                    {log.status}
                  </Typography>
                </Td>
                <Td><Typography>{log.message}</Typography></Td>
              </Tr>
            ))}
            {logs.length === 0 && (
              <Tr>
                <Td colSpan={5}>
                  <Typography textColor="neutral500">
                    {loading ? 'Loading…' : 'No logs found'}
                  </Typography>
                </Td>
              </Tr>
            )}
          </Tbody>
        </Table>
      </Box>

      {meta && meta.pagination && (
        <Box paddingTop={4}>
          <Flex justifyContent="center" gap={2}>
            <Button variant="tertiary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              Previous
            </Button>
            <Typography>
              Page {page} of {meta.pagination.pageCount || 1}
            </Typography>
            <Button
              variant="tertiary"
              disabled={page >= (meta.pagination.pageCount || 1)}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </Button>
          </Flex>
        </Box>
      )}
    </Box>
  );
};

export { LogsTab };
export default LogsTab;
