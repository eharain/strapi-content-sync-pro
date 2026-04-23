import { useState, useEffect, useCallback } from 'react';
import {
  Box,
  Flex,
  Typography,
  Button,
  SingleSelect,
  SingleSelectOption,
  TextInput,
  Table,
  Thead,
  Tbody,
  Tr,
  Td,
  Th,
} from '@strapi/design-system';
import { CaretUp, CaretDown } from '@strapi/icons';
import { useFetchClient } from '@strapi/strapi/admin';

const PLUGIN_ID = 'strapi-content-sync-pro';

const LogsTab = () => {
  const { get } = useFetchClient();

  const [logs, setLogs] = useState([]);
  const [meta, setMeta] = useState(null);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState('');
  const [sortField, setSortField] = useState('');
  const [sortDir, setSortDir] = useState('asc');
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

  const handleSort = (field) => {
    if (sortField === field) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  };

  const displayedLogs = (() => {
    let result = [...logs];
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      result = result.filter(
        (l) =>
          (l.action || '').toLowerCase().includes(q) ||
          (l.contentType || '').toLowerCase().includes(q) ||
          (l.message || '').toLowerCase().includes(q)
      );
    }
    if (sortField) {
      result.sort((a, b) => {
        const aVal = a[sortField] ?? '';
        const bVal = b[sortField] ?? '';
        if (typeof aVal === 'string') {
          return sortDir === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
        }
        return sortDir === 'asc' ? aVal - bVal : bVal - aVal;
      });
    }
    return result;
  })();

  const SortableTh = ({ field, children }) => (
    <Th onClick={() => handleSort(field)} style={{ cursor: 'pointer', userSelect: 'none' }}>
      <Flex alignItems="center" gap={1}>
        <Typography variant="sigma">{children}</Typography>
        {sortField === field && (sortDir === 'asc' ? <CaretUp /> : <CaretDown />)}
      </Flex>
    </Th>
  );

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

      <Box paddingTop={3} paddingBottom={2}>
        <TextInput
          placeholder="Search action, content type, message…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          label="Search"
          size="S"
          style={{ maxWidth: 340 }}
        />
      </Box>

      <Box paddingTop={2}>
        <Table>
          <Thead>
            <Tr>
              <SortableTh field="createdAt">Time</SortableTh>
              <SortableTh field="action">Action</SortableTh>
              <SortableTh field="contentType">Content Type</SortableTh>
              <SortableTh field="status">Status</SortableTh>
              <Th><Typography variant="sigma">Message</Typography></Th>
            </Tr>
          </Thead>
          <Tbody>
            {displayedLogs.map((log, i) => (
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
            {displayedLogs.length === 0 && (
              <Tr>
                <Td colSpan={5}>
                  <Typography textColor="neutral500">
                    {loading ? 'Loading…' : search ? 'No logs match the search.' : 'No logs found'}
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
