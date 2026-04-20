import { useState } from 'react';
import { Routes, Route } from 'react-router-dom';
import { Page } from '@strapi/strapi/admin';
import { Box, Flex, Typography, Button, Main } from '@strapi/design-system';
import { ConfigTab } from '../../components/ConfigTab';
import { ContentTypesTab } from '../../components/ContentTypesTab';
import { SyncTab } from '../../components/SyncTab';
import { LogsTab } from '../../components/LogsTab';
import { HelpTab } from '../../components/HelpTab';
import { SyncProfilesTab } from '../../components/SyncProfilesTab';
import { MediaTab } from '../../components/MediaTab';

const TABS = [
    { key: 'config', label: 'Configuration' },
    { key: 'content-types', label: 'Content Types' },
    { key: 'sync-profiles', label: 'Sync Profiles' },
    { key: 'sync', label: 'Sync' },
    { key: 'media', label: 'Media' },
    { key: 'logs', label: 'Logs' },
    { key: 'help', label: 'Help' },
];

const HomePage = () => {
    const [activeTab, setActiveTab] = useState('config');

    return (
        <Main>
            <Box padding={8} background="neutral100">
                <Typography variant="alpha" tag="h1">
                    Content Sync Pro Plugin - Reliable Data Synchronization for Strapi Environments
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
                {activeTab === 'sync-profiles' && <SyncProfilesTab />}
                {activeTab === 'sync' && <SyncTab />}
                {activeTab === 'media' && <MediaTab />}
                {activeTab === 'logs' && <LogsTab />}
                {activeTab === 'help' && <HelpTab />}

                <Box paddingTop={8} borderColor="neutral200" borderStyle="solid" borderWidth="1px 0 0 0">
                    <Box paddingTop={4}>
                        <Typography variant="sigma" textColor="neutral600">
                            Need help with this plugin? Feel free to reach out or explore the resources below.
                        </Typography>
                        <Box paddingTop={2}>
                            <Typography variant="pi" textColor="neutral500">
                                Contact: {' Eja Arain '}
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
                                    href="https://github.com/eharain/strapi-content-sync-pro"
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
                        <Box paddingTop={2}>
                            <Typography variant="pi" textColor="neutral500">
                                This plugin is a core component of {' '}
                                <Typography
                                    variant="pi"
                                    textColor="primary600"
                                    tag="a"
                                    href="https://github.com/eharain/Rutba-ERP/"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                >
                                    Rutba ERP
                                </Typography>
                                , powering reliable data synchronization across multi-environment installations.
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
