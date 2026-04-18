import { useState } from 'react';
import { Box, Typography, Button, Alert } from '@strapi/design-system';
import { useFetchClient } from '@strapi/strapi/admin';

const PLUGIN_ID = 'strapi-to-strapi-data-sync';

const SyncTab = () => {
  const { post } = useFetchClient();

  const [syncing, setSyncing] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const handleSync = async () => {
    setSyncing(true);
    setResult(null);
    setError(null);
    try {
      const { data } = await post(`/${PLUGIN_ID}/sync-now`);
      setResult(data.data);
    } catch (err) {
      setError(err.message || 'Sync failed');
    } finally {
      setSyncing(false);
    }
  };

  return (
    <Box>
      <Typography variant="beta" tag="h2">Manual Sync</Typography>

      <Box paddingTop={4}>
        <Button onClick={handleSync} loading={syncing} disabled={syncing}>
          {syncing ? 'Syncing…' : 'Sync Now'}
        </Button>
      </Box>

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

          <Box paddingTop={2}>
            {result.results &&
              result.results.map((r, i) => (
                <Box key={i} padding={3} background="neutral0" marginTop={2} hasRadius>
                  <Typography variant="delta">{r.uid}</Typography>
                  {r.error ? (
                    <Typography textColor="danger500">Error: {r.error}</Typography>
                  ) : (
                    <Typography>
                      Pushed: {r.pushed} | Pulled: {r.pulled} | Errors: {r.errors}
                    </Typography>
                  )}
                </Box>
              ))}
          </Box>
        </Box>
      )}
    </Box>
  );
};

export { SyncTab };
export default SyncTab;
