import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Box, Flex, Typography, Button, Badge, Loader } from '@strapi/design-system';
import { ArrowRight } from '@strapi/icons';
import { useFetchClient } from '@strapi/strapi/admin';
import { groupedNav, resolvePath } from '../nav';

const PLUGIN_ID = 'strapi-content-sync-pro';

// Cards on the hub are self-guided entry points. We hide "Home" itself from the
// grid since the user is already here.
const CARD_SECTIONS = groupedNav()
    .map((s) => ({ ...s, items: s.items.filter((it) => it.key !== 'home') }))
    .filter((s) => s.items.length > 0);

const ConnectionStatus = ({ config }) => {
    const configured = Boolean(config?.baseUrl && config?.hasApiToken !== false);
    const mode = config?.syncMode === 'single' ? 'Single-side' : 'Paired';

    return (
        <Flex gap={3} wrap="wrap" alignItems="center">
            <Badge active={configured}>{configured ? 'Connected' : 'Not configured'}</Badge>
            {config?.baseUrl ? (
                <Typography variant="omega" textColor="neutral700">
                    {mode} · {config.baseUrl}
                </Typography>
            ) : (
                <Typography variant="omega" textColor="neutral600">
                    No remote server configured yet.
                </Typography>
            )}
        </Flex>
    );
};

const HomeHub = () => {
    const navigate = useNavigate();
    const { get } = useFetchClient();
    const [config, setConfig] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let active = true;
        get(`/${PLUGIN_ID}/config`)
            .then((res) => {
                if (active) setConfig(res.data?.data || {});
            })
            .catch(() => {
                if (active) setConfig({});
            })
            .finally(() => {
                if (active) setLoading(false);
            });
        return () => {
            active = false;
        };
    }, []);

    const configured = Boolean(config?.baseUrl);

    return (
        <Box>
            {/* Hero: current status + primary next step */}
            <Box
                padding={6}
                background="neutral0"
                hasRadius
                shadow="filterShadow"
                marginBottom={6}
            >
                <Flex justifyContent="space-between" alignItems="flex-start" gap={4} wrap="wrap">
                    <Box>
                        <Typography variant="beta" tag="h2">
                            {configured ? 'Your sync is set up' : 'Let’s connect your first server'}
                        </Typography>
                        <Box paddingTop={2} paddingBottom={3} maxWidth="46rem">
                            <Typography variant="omega" textColor="neutral600">
                                {configured
                                    ? 'Run a sync, schedule periodic runs, or review recent activity below.'
                                    : 'The guided setup walks you through connecting a remote server, choosing what to sync, and running your first sync — in three steps.'}
                            </Typography>
                        </Box>
                        {loading ? (
                            <Loader small>Checking status…</Loader>
                        ) : (
                            <ConnectionStatus config={config} />
                        )}
                    </Box>
                    <Flex direction="column" gap={2} alignItems="stretch">
                        <Button
                            size="L"
                            endIcon={<ArrowRight />}
                            onClick={() => navigate(resolvePath(configured ? 'sync' : 'setup'))}
                        >
                            {configured ? 'Go to Sync' : 'Start guided setup'}
                        </Button>
                        {!configured && (
                            <Button
                                size="L"
                                variant="tertiary"
                                onClick={() => navigate(resolvePath('configuration'))}
                            >
                                Configure manually
                            </Button>
                        )}
                    </Flex>
                </Flex>
            </Box>

            {/* Grouped destination cards */}
            {CARD_SECTIONS.map((section) => (
                <Box key={section.title} marginBottom={6}>
                    <Box paddingBottom={3}>
                        <Typography variant="sigma" textColor="neutral500">
                            {section.title}
                        </Typography>
                    </Box>
                    <Flex gap={4} wrap="wrap" alignItems="stretch">
                        {section.items.map((item) => (
                            <Box
                                key={item.key}
                                tag="button"
                                onClick={() => navigate(resolvePath(item.path))}
                                padding={5}
                                background="neutral0"
                                hasRadius
                                shadow="filterShadow"
                                width="20rem"
                                style={{ textAlign: 'left', cursor: 'pointer', border: 'none' }}
                            >
                                <Flex justifyContent="space-between" alignItems="center">
                                    <Typography variant="delta" tag="h3">
                                        {item.label}
                                    </Typography>
                                    <ArrowRight width="0.9rem" height="0.9rem" fill="neutral500" />
                                </Flex>
                                <Box paddingTop={2}>
                                    <Typography variant="pi" textColor="neutral600">
                                        {item.description}
                                    </Typography>
                                </Box>
                            </Box>
                        ))}
                    </Flex>
                </Box>
            ))}
        </Box>
    );
};

export { HomeHub };
export default HomeHub;
