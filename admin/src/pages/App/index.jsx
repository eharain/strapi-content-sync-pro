import { useState } from 'react';
import { Routes, Route } from 'react-router-dom';
import { Page } from '@strapi/strapi/admin';
import { Box, Flex, Typography, Button, Main } from '@strapi/design-system';
import { ConfigTab } from '../../components/ConfigTab';
import { ContentTypesTab } from '../../components/ContentTypesTab';
import { SyncTab } from '../../components/SyncTab';
import { LogsTab } from '../../components/LogsTab';

const TABS = [
  { key: 'config', label: 'Configuration' },
  { key: 'content-types', label: 'Content Types' },
  { key: 'sync', label: 'Sync' },
  { key: 'logs', label: 'Logs' },
];

const HomePage = () => {
  const [activeTab, setActiveTab] = useState('config');

  return (
    <Main>
      <Box padding={8} background="neutral100">
        <Typography variant="alpha" tag="h1">
          Strapi-to-Strapi Data Sync
        </Typography>

        <Box paddingTop={4} paddingBottom={6}>
          <Flex gap={2}>
            {TABS.map((tab) => (
              <Button
                key={tab.key}
                variant={activeTab === tab.key ? 'default' : 'tertiary'}
                onClick={() => setActiveTab(tab.key)}
              >
                {tab.label}
              </Button>
            ))}
          </Flex>
        </Box>

        {activeTab === 'config' && <ConfigTab />}
        {activeTab === 'content-types' && <ContentTypesTab />}
        {activeTab === 'sync' && <SyncTab />}
        {activeTab === 'logs' && <LogsTab />}

        <Box paddingTop={8} borderColor="neutral200" borderStyle="solid" borderWidth="1px 0 0 0">
          <Box paddingTop={4}>
            <Typography variant="sigma" textColor="neutral600">
              Need help with this plugin?
            </Typography>
            <Box paddingTop={2}>
              <Typography variant="pi" textColor="neutral500">
                Contact:{' '}
                <Typography
                  variant="pi"
                  textColor="primary600"
                  tag="a"
                  href="mailto:eharain@yahoo.com"
                >
                  eharain@yahoo.com
                </Typography>
                {' · '}
                <Typography
                  variant="pi"
                  textColor="primary600"
                  tag="a"
                  href="https://github.com/eharain/strapi-to-strapi-data-sync"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  GitHub
                </Typography>
                {' · '}
                <Typography
                  variant="pi"
                  textColor="primary600"
                  tag="a"
                  href="https://www.linkedin.com/in/ejazarain/"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  LinkedIn
                </Typography>
              </Typography>
            </Box>
          </Box>
        </Box>
      </Box>
    </Main>
  );
};

const App = () => {
  return (
    <Routes>
      <Route index element={<HomePage />} />
      <Route path="*" element={<Page.Error />} />
    </Routes>
  );
};

export { App };
export default App;
