import { useState, useEffect } from 'react';
import {
    Box,
    Flex,
    Typography,
    TextInput,
    Button,
    Alert,
    Field,
    Tabs,
    SingleSelect,
    SingleSelectOption,
    Switch,
    NumberInput,
    TextButton,
    Badge,
    Loader,
    Modal,
} from '@strapi/design-system';
import { useFetchClient } from '@strapi/strapi/admin';

const PLUGIN_ID = 'strapi-content-sync-pro';

const ConfigTab = () => {
    const { get, post, put } = useFetchClient();

    // Connection config
    const [config, setConfig] = useState({
        baseUrl: '',
        apiToken: '',
        instanceId: '',
        sharedSecret: '',
    });

    // Login modal state
    const [showLoginModal, setShowLoginModal] = useState(false);
    const [credentials, setCredentials] = useState({
        email: '',
        password: '',
    });
    const [loginState, setLoginState] = useState({
        loading: false,
        success: false,
        error: null,
    });

    // Connection test state
    const [connectionTest, setConnectionTest] = useState({
        testing: false,
        result: null,
    });

    // Enforcement settings
    const [enforcement, setEnforcement] = useState({
        enforceSchemaMatch: true,
        schemaMatchMode: 'strict',
        enforceVersionCheck: true,
        allowedVersionDrift: 'minor',
        enforceDateTimeSync: true,
        maxTimeDriftMs: 60000,
        validateBeforeSync: true,
        blockOnFailure: true,
    });

    // Diagnostic state
    const [diagnostics, setDiagnostics] = useState({
        running: null, // 'schema' | 'version' | 'time' | 'all'
        results: {},
    });

    // Alert settings
    const [alerts, setAlerts] = useState({
        enabled: true,
        emailPluginConfigured: false,
        channels: {
            strapiNotification: { enabled: true, onSuccess: false, onFailure: true },
            email: {
                enabled: false,
                onSuccess: false,
                onFailure: true,
                recipients: [],
                from: '',
            },
            webhook: { enabled: false, onSuccess: true, onFailure: true, url: '' },
        },
    });

    const [emailRecipients, setEmailRecipients] = useState('');

    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState(null);

    useEffect(() => {
        fetchAllConfig();
    }, []);

    const fetchAllConfig = async () => {
        try {
            const [configRes, enforcementRes, alertsRes] = await Promise.all([
                get(`/${PLUGIN_ID}/config`),
                get(`/${PLUGIN_ID}/enforcement/settings`),
                get(`/${PLUGIN_ID}/alerts/settings`),
            ]);
            if (configRes.data.data) {
                setConfig((prev) => ({ ...prev, ...configRes.data.data }));
            }
            if (enforcementRes.data.data) {
                setEnforcement((prev) => ({ ...prev, ...enforcementRes.data.data }));
            }
            if (alertsRes.data.data) {
                setAlerts((prev) => ({ ...prev, ...alertsRes.data.data }));
                if (alertsRes.data.data.channels?.email?.recipients) {
                    setEmailRecipients(alertsRes.data.data.channels.email.recipients.join(', '));
                }
            }
        } catch (err) {
            console.error('Failed to fetch config', err);
            setMessage({ type: 'danger', text: err?.response?.data?.error?.message || err.message || 'Failed to load configuration' });
        } finally {
            setLoading(false);
        }
    };

    const handleSaveConnection = async () => {
        setSaving(true);
        setMessage(null);
        try {
            const payload = {};
            if (config.baseUrl) payload.baseUrl = config.baseUrl;
            if (config.apiToken && config.apiToken !== '••••••••') payload.apiToken = config.apiToken;
            if (config.instanceId) payload.instanceId = config.instanceId;
            if (config.sharedSecret && config.sharedSecret !== '••••••••') payload.sharedSecret = config.sharedSecret;

            await post(`/${PLUGIN_ID}/config`, payload);
            setMessage({ type: 'success', text: 'Connection configuration saved' });
        } catch (err) {
            setMessage({ type: 'danger', text: err?.response?.data?.error?.message || err.message || 'Failed to save configuration' });
        } finally {
            setSaving(false);
        }
    };

    // Login with credentials to remote server and get/create API token
    const handleLoginWithCredentials = async () => {
        if (!config.baseUrl || !credentials.email || !credentials.password) {
            setLoginState({ loading: false, success: false, error: 'Please fill in all fields' });
            return;
        }

        setLoginState({ loading: true, success: false, error: null });

        try {
            // Call our backend to proxy the login request
            const response = await post(`/${PLUGIN_ID}/config/remote-login`, {
                baseUrl: config.baseUrl,
                email: credentials.email,
                password: credentials.password,
            });

            // The backend saves the token, so we need to refresh config
            const configRes = await get(`/${PLUGIN_ID}/config`);
            if (configRes.data.data) {
                setConfig((prev) => ({ ...prev, ...configRes.data.data }));
            }

            // Clear credentials (they should not be stored)
            setCredentials({ email: '', password: '' });

            setLoginState({ loading: false, success: true, error: null });
            setMessage({ type: 'success', text: 'API token created successfully!' });

            // Close modal after short delay to show success
            setTimeout(() => {
                setShowLoginModal(false);
                setLoginState({ loading: false, success: false, error: null });
            }, 1500);
        } catch (err) {
            const errorMessage = err.response?.data?.error?.message || err.message || 'Authentication failed';
            setLoginState({ loading: false, success: false, error: errorMessage });
        }
    };

    // Test connection to remote server
    const handleTestConnection = async () => {
        setConnectionTest({ testing: true, result: null });
        try {
            const response = await get(`/${PLUGIN_ID}/config/test`);
            const data = response.data.data;
            setConnectionTest({
                testing: false,
                result: {
                    success: data.success,
                    latency: data.latency,
                    message: data.message,
                    stage: data.stage,
                    remoteInfo: data.remoteInfo,
                    timestamp: new Date().toISOString(),
                },
            });
        } catch (err) {
            setConnectionTest({
                testing: false,
                result: {
                    success: false,
                    message: err.response?.data?.error?.message || err.message || 'Connection failed',
                    error: err.response?.status || 'Network Error',
                    timestamp: new Date().toISOString(),
                },
            });
        }
    };

    // Run individual diagnostic check
    const handleRunDiagnostic = async (type) => {
        setDiagnostics(prev => ({ ...prev, running: type }));
        try {
            const response = await get(`/${PLUGIN_ID}/enforcement/check/${type}`);
            setDiagnostics(prev => ({
                ...prev,
                running: null,
                results: {
                    ...prev.results,
                    [type]: {
                        ...response.data.data,
                        timestamp: new Date().toISOString(),
                    },
                },
            }));
        } catch (err) {
            setDiagnostics(prev => ({
                ...prev,
                running: null,
                results: {
                    ...prev.results,
                    [type]: {
                        passed: false,
                        error: err.response?.data?.error?.message || err.message || 'Check failed',
                        timestamp: new Date().toISOString(),
                    },
                },
            }));
        }
    };

    // Run all diagnostic checks
    const handleRunAllDiagnostics = async () => {
        setDiagnostics({ running: 'all', results: {} });

        const checks = ['schema', 'version', 'time'];
        const results = {};

        for (const check of checks) {
            try {
                const response = await get(`/${PLUGIN_ID}/enforcement/check/${check}`);
                results[check] = {
                    ...response.data.data,
                    timestamp: new Date().toISOString(),
                };
            } catch (err) {
                results[check] = {
                    passed: false,
                    error: err.response?.data?.error?.message || err.message || 'Check failed',
                    timestamp: new Date().toISOString(),
                };
            }
        }

        setDiagnostics({ running: null, results });
    };

    // Clear diagnostic results
    const handleClearDiagnostics = () => {
        setDiagnostics({ running: null, results: {} });
    };

    const handleSaveEnforcement = async () => {
        setSaving(true);
        setMessage(null);
        try {
            await put(`/${PLUGIN_ID}/enforcement/settings`, enforcement);
            setMessage({ type: 'success', text: 'Enforcement settings saved' });
        } catch (err) {
            setMessage({ type: 'danger', text: err.response?.data?.error?.message || 'Failed to save enforcement settings' });
        } finally {
            setSaving(false);
        }
    };

    const handleSaveAlerts = async () => {
        setSaving(true);
        setMessage(null);
        try {
            const alertPayload = {
                ...alerts,
                channels: {
                    ...alerts.channels,
                    email: {
                        ...alerts.channels.email,
                        recipients: emailRecipients.split(',').map(e => e.trim()).filter(e => e),
                    },
                },
            };
            await put(`/${PLUGIN_ID}/alerts/settings`, alertPayload);
            setMessage({ type: 'success', text: 'Alert settings saved' });
        } catch (err) {
            setMessage({ type: 'danger', text: err.response?.data?.error?.message || 'Failed to save alert settings' });
        } finally {
            setSaving(false);
        }
    };

    const handleTestAlert = async (channel) => {
        try {
            await post(`/${PLUGIN_ID}/alerts/test/${channel}`);
            setMessage({ type: 'success', text: `Test alert sent to ${channel}` });
        } catch (err) {
            setMessage({ type: 'danger', text: err.response?.data?.error?.message || 'Failed to send test alert' });
        }
    };

    if (loading) return <Typography>Loading…</Typography>;

    return (
        <Box>
            <Typography variant="beta" tag="h2">Configuration</Typography>
            <Box paddingTop={2} paddingBottom={4}>
                <Typography variant="omega" textColor="neutral600">
                    Configure connection, enforcement policies, and alert notifications.
                </Typography>
            </Box>

            {message && (
                <Box paddingBottom={4}>
                    <Alert variant={message.type} closeLabel="Close" onClose={() => setMessage(null)}>
                        {message.text}
                    </Alert>
                </Box>
            )}

            <Tabs.Root defaultValue="connection">
                <Tabs.List>
                    <Tabs.Trigger value="connection">Connection</Tabs.Trigger>
                    <Tabs.Trigger value="enforcement">Enforcement</Tabs.Trigger>
                    <Tabs.Trigger value="alerts">Alerts</Tabs.Trigger>
                </Tabs.List>

                <Box paddingTop={4}>
                    {/* Connection Tab */}
                    <Tabs.Content value="connection">
                        <Box>
                            <Flex gap={6}>
                                {/* LEFT COLUMN: Remote Server */}
                                <Box flex="1">
                                    <Typography variant="delta" paddingBottom={4}>Remote Server</Typography>

                                    <Flex direction="column" gap={4}>
                                        <Field.Root>
                                            <Field.Label>Server URL</Field.Label>
                                            <TextInput
                                                placeholder="https://my-other-strapi.com"
                                                value={config.baseUrl}
                                                onChange={(e) => setConfig((p) => ({ ...p, baseUrl: e.target.value }))}
                                            />
                                            <Field.Hint>URL of the Strapi server to sync with</Field.Hint>
                                        </Field.Root>

                                        <Field.Root>
                                            <Field.Label>API Token</Field.Label>
                                            <Flex gap={2}>
                                                <Box flex="1">
                                                    <TextInput
                                                        type="password"
                                                        placeholder="Paste API token or generate one"
                                                        value={config.apiToken}
                                                        onChange={(e) => setConfig((p) => ({ ...p, apiToken: e.target.value }))}
                                                    />
                                                </Box>

                                            </Flex>
                                            <Field.Hint>Full Access token from the remote server</Field.Hint>
                                        </Field.Root>
                                        <Field.Root>
                                            <Button
                                                variant="secondary"
                                                onClick={() => setShowLoginModal(true)}
                                                disabled={!config.baseUrl}
                                            >
                                                {config.apiToken ? 'Regenerate' : 'Generate'}
                                            </Button>
                                        </Field.Root>
                                    </Flex>
                                </Box>

                                {/* RIGHT COLUMN: Local Settings */}
                                <Box flex="1">
                                    <Typography variant="delta" paddingBottom={4}>Local Settings</Typography>

                                    <Flex direction="column" gap={4}>
                                        <Field.Root>
                                            <Field.Label>Instance Name</Field.Label>
                                            <TextInput
                                                placeholder="e.g., production, staging, local"
                                                value={config.instanceId}
                                                onChange={(e) => setConfig((p) => ({ ...p, instanceId: e.target.value }))}
                                            />
                                            <Field.Hint>Name to identify this server in logs</Field.Hint>
                                        </Field.Root>

                                        <Field.Root>
                                            <Field.Label>Shared Secret</Field.Label>
                                            <TextInput
                                                type="password"
                                                placeholder="Secret key for bi-directional sync"
                                                value={config.sharedSecret}
                                                onChange={(e) => setConfig((p) => ({ ...p, sharedSecret: e.target.value }))}
                                            />
                                            <Field.Hint>Must match on both servers</Field.Hint>
                                        </Field.Root>
                                    </Flex>
                                </Box>
                            </Flex>

                            {/* Connection Status */}
                            {connectionTest.result && (
                                <Box paddingTop={4}>
                                    <Alert
                                        variant={connectionTest.result.success ? 'success' : 'danger'}
                                        closeLabel="Close"
                                        onClose={() => setConnectionTest({ testing: false, result: null })}
                                        title={connectionTest.result.success ? 'Connection OK' : `Failed at: ${connectionTest.result.stage || 'unknown'}`}
                                    >
                                        <Box>
                                            <Typography variant="omega">
                                                {connectionTest.result.message}
                                                {connectionTest.result.latency != null && ` (${connectionTest.result.latency}ms)`}
                                            </Typography>
                                            {connectionTest.result.remoteInfo && (
                                                <Box paddingTop={2}>
                                                    <Typography variant="pi" textColor="neutral600">
                                                        Remote Strapi: {connectionTest.result.remoteInfo.strapiVersion || 'unknown'} •
                                                        Server time: {connectionTest.result.remoteInfo.serverTime || 'unknown'}
                                                    </Typography>
                                                </Box>
                                            )}
                                        </Box>
                                    </Alert>
                                </Box>
                            )}

                            {/* Action Buttons */}
                            <Flex gap={2} paddingTop={6}>
                                <Button
                                    onClick={handleSaveConnection}
                                    loading={saving}
                                    disabled={!config.baseUrl || !config.apiToken}
                                >
                                    Save
                                </Button>
                                <Button
                                    variant="secondary"
                                    onClick={handleTestConnection}
                                    loading={connectionTest.testing}
                                    disabled={!config.baseUrl || !config.apiToken}
                                >
                                    Test Connection
                                </Button>
                            </Flex>
                        </Box>

                        {/* Login Modal for Token Generation */}
                        {showLoginModal && (
                            <Modal.Root open={showLoginModal} onOpenChange={setShowLoginModal}>
                                <Modal.Content>
                                    <Modal.Header>
                                        <Modal.Title>Generate API Token</Modal.Title>
                                    </Modal.Header>
                                    <Modal.Body>
                                        <Typography variant="omega" textColor="neutral600" paddingBottom={2}>
                                            Log in to <strong>{config.baseUrl}</strong> to automatically create an API token.
                                        </Typography>
                                        <Typography variant="pi" textColor="neutral500" paddingBottom={4}>
                                            Your credentials are sent directly to your remote server, used once to create a token, and never stored on disk, in the database, or in memory.
                                        </Typography>

                                        <Flex direction="column" gap={4}>
                                            <Field.Root>
                                                <Field.Label>Admin Email</Field.Label>
                                                <TextInput
                                                    type="email"
                                                    placeholder="admin@example.com"
                                                    value={credentials.email}
                                                    onChange={(e) => setCredentials((p) => ({ ...p, email: e.target.value }))}
                                                />
                                            </Field.Root>

                                            <Field.Root>
                                                <Field.Label>Admin Password</Field.Label>
                                                <TextInput
                                                    type="password"
                                                    placeholder="Enter password"
                                                    value={credentials.password}
                                                    onChange={(e) => setCredentials((p) => ({ ...p, password: e.target.value }))}
                                                />
                                            </Field.Root>

                                            {loginState.error && (
                                                <Alert variant="danger" closeLabel="Close" onClose={() => setLoginState((p) => ({ ...p, error: null }))}>
                                                    {loginState.error}
                                                </Alert>
                                            )}

                                            {loginState.success && (
                                                <Alert variant="success">
                                                    Token created successfully!
                                                </Alert>
                                            )}
                                        </Flex>
                                    </Modal.Body>
                                    <Modal.Footer>
                                        <Modal.Close>
                                            <Button variant="tertiary">Cancel</Button>
                                        </Modal.Close>
                                        <Button
                                            onClick={handleLoginWithCredentials}
                                            loading={loginState.loading}
                                            disabled={!credentials.email || !credentials.password || loginState.success}
                                        >
                                            {loginState.loading ? 'Creating...' : 'Create Token'}
                                        </Button>
                                    </Modal.Footer>
                                </Modal.Content>
                            </Modal.Root>
                        )}
                    </Tabs.Content>

                    {/* Enforcement Tab */}
                    <Tabs.Content value="enforcement">
                        <Box>
                            <Flex gap={6}>
                                {/* LEFT COLUMN: Settings */}
                                <Box flex="1">
                                    <Flex justifyContent="space-between" alignItems="center" paddingBottom={4}>
                                        <Typography variant="delta">Enforcement Settings</Typography>
                                        <Button onClick={handleSaveEnforcement} loading={saving} size="S">
                                            Save
                                        </Button>
                                    </Flex>

                                    <Flex direction="column" gap={3}>
                                        {/* Schema Match Row */}
                                        <Box padding={3} background="neutral100" hasRadius>
                                            <Flex justifyContent="space-between" alignItems="center">
                                                <Box flex="1">
                                                    <Typography fontWeight="bold">Schema Match</Typography>
                                                    <Typography variant="pi" textColor="neutral500">Verify schemas are compatible</Typography>
                                                </Box>
                                                <Flex gap={2} alignItems="center">
                                                    {enforcement.enforceSchemaMatch && (
                                                        <SingleSelect
                                                            size="S"
                                                            value={enforcement.schemaMatchMode}
                                                            onChange={(value) => setEnforcement((p) => ({ ...p, schemaMatchMode: value }))}
                                                            style={{ width: '140px' }}
                                                        >
                                                            <SingleSelectOption value="strict">Strict</SingleSelectOption>
                                                            <SingleSelectOption value="compatible">Compatible</SingleSelectOption>
                                                        </SingleSelect>
                                                    )}
                                                    <Switch
                                                        checked={enforcement.enforceSchemaMatch}
                                                        onCheckedChange={(checked) => setEnforcement((p) => ({ ...p, enforceSchemaMatch: checked }))}
                                                    />
                                                    <Button
                                                        variant="tertiary"
                                                        size="S"
                                                        onClick={() => handleRunDiagnostic('schema')}
                                                        loading={diagnostics.running === 'schema'}
                                                    >
                                                        Check
                                                    </Button>
                                                </Flex>
                                            </Flex>
                                        </Box>

                                        {/* Version Check Row */}
                                        <Box padding={3} background="neutral100" hasRadius>
                                            <Flex justifyContent="space-between" alignItems="center">
                                                <Box flex="1">
                                                    <Typography fontWeight="bold">Version Check</Typography>
                                                    <Typography variant="pi" textColor="neutral500">Ensure Strapi versions match</Typography>
                                                </Box>
                                                <Flex gap={2} alignItems="center">
                                                    {enforcement.enforceVersionCheck && (
                                                        <SingleSelect
                                                            size="S"
                                                            value={enforcement.allowedVersionDrift}
                                                            onChange={(value) => setEnforcement((p) => ({ ...p, allowedVersionDrift: value }))}
                                                            style={{ width: '140px' }}
                                                        >
                                                            <SingleSelectOption value="exact">Exact</SingleSelectOption>
                                                            <SingleSelectOption value="minor">Minor</SingleSelectOption>
                                                            <SingleSelectOption value="major">Major</SingleSelectOption>
                                                        </SingleSelect>
                                                    )}
                                                    <Switch
                                                        checked={enforcement.enforceVersionCheck}
                                                        onCheckedChange={(checked) => setEnforcement((p) => ({ ...p, enforceVersionCheck: checked }))}
                                                    />
                                                    <Button
                                                        variant="tertiary"
                                                        size="S"
                                                        onClick={() => handleRunDiagnostic('version')}
                                                        loading={diagnostics.running === 'version'}
                                                    >
                                                        Check
                                                    </Button>
                                                </Flex>
                                            </Flex>
                                        </Box>

                                        {/* Time Sync Row */}
                                        <Box padding={3} background="neutral100" hasRadius>
                                            <Flex justifyContent="space-between" alignItems="center">
                                                <Box flex="1">
                                                    <Typography fontWeight="bold">Time Sync</Typography>
                                                    <Typography variant="pi" textColor="neutral500">Verify server clocks match</Typography>
                                                </Box>
                                                <Flex gap={2} alignItems="center">
                                                    {enforcement.enforceDateTimeSync && (
                                                        <Box style={{ width: '100px' }}>
                                                            <NumberInput
                                                                size="S"
                                                                value={enforcement.maxTimeDriftMs}
                                                                onValueChange={(value) => setEnforcement((p) => ({ ...p, maxTimeDriftMs: value }))}
                                                                min={1000}
                                                                max={86400000}
                                                            />
                                                        </Box>
                                                    )}
                                                    <Switch
                                                        checked={enforcement.enforceDateTimeSync}
                                                        onCheckedChange={(checked) => setEnforcement((p) => ({ ...p, enforceDateTimeSync: checked }))}
                                                    />
                                                    <Button
                                                        variant="tertiary"
                                                        size="S"
                                                        onClick={() => handleRunDiagnostic('time')}
                                                        loading={diagnostics.running === 'time'}
                                                    >
                                                        Check
                                                    </Button>
                                                </Flex>
                                            </Flex>
                                        </Box>

                                        {/* Block on Failure Row */}
                                        <Box padding={3} background="neutral100" hasRadius>
                                            <Flex justifyContent="space-between" alignItems="center">
                                                <Box flex="1">
                                                    <Typography fontWeight="bold">Block on Failure</Typography>
                                                    <Typography variant="pi" textColor="neutral500">Stop sync if checks fail</Typography>
                                                </Box>
                                                <Switch
                                                    checked={enforcement.blockOnFailure}
                                                    onCheckedChange={(checked) => setEnforcement((p) => ({ ...p, blockOnFailure: checked }))}
                                                />
                                            </Flex>
                                        </Box>

                                        {/* Run All Button */}
                                        <Box paddingTop={2}>
                                            <Button
                                                variant="secondary"
                                                onClick={handleRunAllDiagnostics}
                                                loading={diagnostics.running === 'all'}
                                                fullWidth
                                            >
                                                Run All Checks
                                            </Button>
                                        </Box>
                                    </Flex>
                                </Box>

                                {/* RIGHT COLUMN: Results */}
                                <Box flex="1">
                                    <Flex justifyContent="space-between" alignItems="center" paddingBottom={4}>
                                        <Typography variant="delta">Check Results</Typography>
                                        {Object.keys(diagnostics.results).length > 0 && (
                                            <Button variant="tertiary" size="S" onClick={handleClearDiagnostics}>
                                                Clear
                                            </Button>
                                        )}
                                    </Flex>

                                    {Object.keys(diagnostics.results).length === 0 ? (
                                        <Box padding={4} background="neutral100" hasRadius>
                                            <Typography textColor="neutral500" textAlign="center">
                                                No results yet. Click "Check" buttons to run diagnostics.
                                            </Typography>
                                        </Box>
                                    ) : (
                                        <Flex direction="column" gap={3}>
                                            {/* Schema Result */}
                                            {diagnostics.results.schema && (
                                                <Box padding={3} background={diagnostics.results.schema.passed ? 'success100' : 'danger100'} hasRadius>
                                                    <Flex justifyContent="space-between" alignItems="center" paddingBottom={2}>
                                                        <Typography fontWeight="bold">Schema Match</Typography>
                                                        <Badge active={diagnostics.results.schema.passed}>
                                                            {diagnostics.results.schema.passed ? '✓ Pass' : '✗ Fail'}
                                                        </Badge>
                                                    </Flex>
                                                    <Typography variant="pi" textColor={diagnostics.results.schema.passed ? 'success700' : 'danger700'}>
                                                        {diagnostics.results.schema.error ||
                                                            (diagnostics.results.schema.details?.mismatches?.length > 0
                                                                ? `${diagnostics.results.schema.details.mismatches.length} mismatch(es) found`
                                                                : 'All schemas compatible')}
                                                    </Typography>
                                                </Box>
                                            )}

                                            {/* Version Result */}
                                            {diagnostics.results.version && (
                                                <Box padding={3} background={diagnostics.results.version.passed ? 'success100' : 'danger100'} hasRadius>
                                                    <Flex justifyContent="space-between" alignItems="center" paddingBottom={2}>
                                                        <Typography fontWeight="bold">Version Check</Typography>
                                                        <Badge active={diagnostics.results.version.passed}>
                                                            {diagnostics.results.version.passed ? '✓ Pass' : '✗ Fail'}
                                                        </Badge>
                                                    </Flex>
                                                    <Typography variant="pi" textColor={diagnostics.results.version.passed ? 'success700' : 'danger700'}>
                                                        {diagnostics.results.version.error ||
                                                            `Local: ${diagnostics.results.version.details?.localVersion || 'N/A'} → Remote: ${diagnostics.results.version.details?.remoteVersion || 'N/A'}`}
                                                    </Typography>
                                                </Box>
                                            )}

                                            {/* Time Result */}
                                            {diagnostics.results.time && (
                                                <Box padding={3} background={diagnostics.results.time.passed ? 'success100' : 'danger100'} hasRadius>
                                                    <Flex justifyContent="space-between" alignItems="center" paddingBottom={2}>
                                                        <Typography fontWeight="bold">Time Sync</Typography>
                                                        <Badge active={diagnostics.results.time.passed}>
                                                            {diagnostics.results.time.passed ? '✓ Pass' : '✗ Fail'}
                                                        </Badge>
                                                    </Flex>
                                                    <Typography variant="pi" textColor={diagnostics.results.time.passed ? 'success700' : 'danger700'}>
                                                        {diagnostics.results.time.error ||
                                                            `Drift: ${diagnostics.results.time.details?.driftMs || 0}ms (max: ${enforcement.maxTimeDriftMs}ms)`}
                                                    </Typography>
                                                </Box>
                                            )}
                                        </Flex>
                                    )}
                                </Box>
                            </Flex>
                        </Box>
                    </Tabs.Content>

                    {/* Alerts Tab */}
                    <Tabs.Content value="alerts">
                        <Box>
                            <Typography variant="delta" paddingBottom={2}>Alert Notifications</Typography>
                            <Typography variant="omega" textColor="neutral600" paddingBottom={4}>
                                Configure notifications for sync success and failure events.
                            </Typography>

                            <Flex direction="column" gap={4}>
                                <Flex justifyContent="space-between" alignItems="center">
                                    <Typography fontWeight="bold">Enable Alerts</Typography>
                                    <Switch
                                        checked={alerts.enabled}
                                        onCheckedChange={(checked) => setAlerts((p) => ({ ...p, enabled: checked }))}
                                    />
                                </Flex>

                                {alerts.enabled && (
                                    <>
                                        {/* Strapi Notifications */}
                                        <Box padding={4} background="neutral0" hasRadius>
                                            <Flex justifyContent="space-between" alignItems="center">
                                                <Box>
                                                    <Typography fontWeight="bold">Strapi Notifications</Typography>
                                                    <Typography variant="pi" textColor="neutral500">
                                                        Log events to sync log (visible in admin)
                                                    </Typography>
                                                </Box>
                                                <Switch
                                                    checked={alerts.channels.strapiNotification.enabled}
                                                    onCheckedChange={(checked) => setAlerts((p) => ({
                                                        ...p,
                                                        channels: {
                                                            ...p.channels,
                                                            strapiNotification: { ...p.channels.strapiNotification, enabled: checked },
                                                        },
                                                    }))}
                                                />
                                            </Flex>
                                            {alerts.channels.strapiNotification.enabled && (
                                                <Flex gap={4} paddingTop={3}>
                                                    <Flex alignItems="center" gap={2}>
                                                        <Switch
                                                            checked={alerts.channels.strapiNotification.onSuccess}
                                                            onCheckedChange={(checked) => setAlerts((p) => ({
                                                                ...p,
                                                                channels: {
                                                                    ...p.channels,
                                                                    strapiNotification: { ...p.channels.strapiNotification, onSuccess: checked },
                                                                },
                                                            }))}
                                                        />
                                                        <Typography variant="pi">On Success</Typography>
                                                    </Flex>
                                                    <Flex alignItems="center" gap={2}>
                                                        <Switch
                                                            checked={alerts.channels.strapiNotification.onFailure}
                                                            onCheckedChange={(checked) => setAlerts((p) => ({
                                                                ...p,
                                                                channels: {
                                                                    ...p.channels,
                                                                    strapiNotification: { ...p.channels.strapiNotification, onFailure: checked },
                                                                },
                                                            }))}
                                                        />
                                                        <Typography variant="pi">On Failure</Typography>
                                                    </Flex>
                                                    <TextButton onClick={() => handleTestAlert('strapiNotification')}>
                                                        Test
                                                    </TextButton>
                                                </Flex>
                                            )}
                                        </Box>

                                        {/* Email */}
                                        <Box padding={4} background="neutral0" hasRadius>
                                            <Flex justifyContent="space-between" alignItems="center">
                                                <Box>
                                                    <Typography fontWeight="bold">Email Notifications</Typography>
                                                    <Typography variant="pi" textColor="neutral500">
                                                        Send email alerts using Strapi's email plugin
                                                    </Typography>
                                                </Box>
                                                <Switch
                                                    checked={alerts.channels.email.enabled}
                                                    onCheckedChange={(checked) => setAlerts((p) => ({
                                                        ...p,
                                                        channels: {
                                                            ...p.channels,
                                                            email: { ...p.channels.email, enabled: checked },
                                                        },
                                                    }))}
                                                />
                                            </Flex>
                                            {alerts.channels.email.enabled && (
                                                <Box paddingTop={3}>
                                                    {/* Email Plugin Status */}
                                                    {!alerts.emailPluginConfigured && (
                                                        <Alert
                                                            variant="warning"
                                                            title="Email Plugin Not Configured"
                                                            style={{ marginBottom: '16px' }}
                                                        >
                                                            <Typography variant="omega">
                                                                Strapi's email plugin is not configured. To enable email alerts, install and configure an email provider:
                                                            </Typography>
                                                            <ul style={{ paddingLeft: '20px', marginTop: '8px' }}>
                                                                <li><Typography variant="pi">@strapi/provider-email-sendgrid</Typography></li>
                                                                <li><Typography variant="pi">@strapi/provider-email-mailgun</Typography></li>
                                                                <li><Typography variant="pi">@strapi/provider-email-amazon-ses</Typography></li>
                                                                <li><Typography variant="pi">@strapi/provider-email-nodemailer</Typography></li>
                                                            </ul>
                                                            <Typography variant="pi" paddingTop={2}>
                                                                See: <a href="https://docs.strapi.io/dev-docs/providers" target="_blank" rel="noopener noreferrer">Strapi Email Providers Documentation</a>
                                                            </Typography>
                                                        </Alert>
                                                    )}
                                                    {alerts.emailPluginConfigured && (
                                                        <Alert variant="success" title="Email Plugin Configured" style={{ marginBottom: '16px' }}>
                                                            <Typography variant="omega">
                                                                Strapi's email plugin is configured and ready to send alerts.
                                                            </Typography>
                                                        </Alert>
                                                    )}

                                                    {/* Recipients */}
                                                    <Field.Root>
                                                        <Field.Label>Email Recipients (comma-separated)</Field.Label>
                                                        <TextInput
                                                            placeholder="admin@example.com, alerts@example.com"
                                                            value={emailRecipients}
                                                            onChange={(e) => setEmailRecipients(e.target.value)}
                                                        />
                                                        <Field.Hint>Enter email addresses to receive sync alerts</Field.Hint>
                                                    </Field.Root>

                                                    {/* Optional From Address */}
                                                    <Box paddingTop={3}>
                                                        <Field.Root>
                                                            <Field.Label>From Email Address (optional)</Field.Label>
                                                            <TextInput
                                                                placeholder="Leave empty to use default"
                                                                value={alerts.channels.email.from || ''}
                                                                onChange={(e) => setAlerts((p) => ({
                                                                    ...p,
                                                                    channels: {
                                                                        ...p.channels,
                                                                        email: { ...p.channels.email, from: e.target.value },
                                                                    },
                                                                }))}
                                                            />
                                                            <Field.Hint>Override the default sender address from Strapi email plugin</Field.Hint>
                                                        </Field.Root>
                                                    </Box>

                                                    {/* Triggers */}
                                                    <Box paddingTop={4}>
                                                        <Typography variant="delta" paddingBottom={2}>Alert Triggers</Typography>
                                                        <Flex gap={4}>
                                                            <Flex alignItems="center" gap={2}>
                                                                <Switch
                                                                    checked={alerts.channels.email.onSuccess}
                                                                    onCheckedChange={(checked) => setAlerts((p) => ({
                                                                        ...p,
                                                                        channels: {
                                                                            ...p.channels,
                                                                            email: { ...p.channels.email, onSuccess: checked },
                                                                        },
                                                                    }))}
                                                                />
                                                                <Typography variant="pi">On Success</Typography>
                                                            </Flex>
                                                            <Flex alignItems="center" gap={2}>
                                                                <Switch
                                                                    checked={alerts.channels.email.onFailure}
                                                                    onCheckedChange={(checked) => setAlerts((p) => ({
                                                                        ...p,
                                                                        channels: {
                                                                            ...p.channels,
                                                                            email: { ...p.channels.email, onFailure: checked },
                                                                        },
                                                                    }))}
                                                                />
                                                                <Typography variant="pi">On Failure</Typography>
                                                            </Flex>
                                                            <TextButton
                                                                onClick={() => handleTestAlert('email')}
                                                                disabled={!alerts.emailPluginConfigured}
                                                            >
                                                                Send Test Email
                                                            </TextButton>
                                                        </Flex>
                                                    </Box>
                                                </Box>
                                            )}
                                        </Box>

                                        {/* Webhook */}
                                        <Box padding={4} background="neutral0" hasRadius>
                                            <Flex justifyContent="space-between" alignItems="center">
                                                <Box>
                                                    <Typography fontWeight="bold">Webhook Notifications</Typography>
                                                    <Typography variant="pi" textColor="neutral500">
                                                        Send alerts to a custom webhook endpoint
                                                    </Typography>
                                                </Box>
                                                <Switch
                                                    checked={alerts.channels.webhook.enabled}
                                                    onCheckedChange={(checked) => setAlerts((p) => ({
                                                        ...p,
                                                        channels: {
                                                            ...p.channels,
                                                            webhook: { ...p.channels.webhook, enabled: checked },
                                                        },
                                                    }))}
                                                />
                                            </Flex>
                                            {alerts.channels.webhook.enabled && (
                                                <Box paddingTop={3}>
                                                    <Field.Root>
                                                        <Field.Label>Webhook URL</Field.Label>
                                                        <TextInput
                                                            placeholder="https://hooks.example.com/sync-alerts"
                                                            value={alerts.channels.webhook.url}
                                                            onChange={(e) => setAlerts((p) => ({
                                                                ...p,
                                                                channels: {
                                                                    ...p.channels,
                                                                    webhook: { ...p.channels.webhook, url: e.target.value },
                                                                },
                                                            }))}
                                                        />
                                                    </Field.Root>
                                                    <Flex gap={4} paddingTop={3}>
                                                        <Flex alignItems="center" gap={2}>
                                                            <Switch
                                                                checked={alerts.channels.webhook.onSuccess}
                                                                onCheckedChange={(checked) => setAlerts((p) => ({
                                                                    ...p,
                                                                    channels: {
                                                                        ...p.channels,
                                                                        webhook: { ...p.channels.webhook, onSuccess: checked },
                                                                    },
                                                                }))}
                                                            />
                                                            <Typography variant="pi">On Success</Typography>
                                                        </Flex>
                                                        <Flex alignItems="center" gap={2}>
                                                            <Switch
                                                                checked={alerts.channels.webhook.onFailure}
                                                                onCheckedChange={(checked) => setAlerts((p) => ({
                                                                    ...p,
                                                                    channels: {
                                                                        ...p.channels,
                                                                        webhook: { ...p.channels.webhook, onFailure: checked },
                                                                    },
                                                                }))}
                                                            />
                                                            <Typography variant="pi">On Failure</Typography>
                                                        </Flex>
                                                        <TextButton onClick={() => handleTestAlert('webhook')}>
                                                            Test
                                                        </TextButton>
                                                    </Flex>
                                                </Box>
                                            )}
                                        </Box>
                                    </>
                                )}

                                <Button onClick={handleSaveAlerts} loading={saving}>
                                    Save Alert Settings
                                </Button>
                            </Flex>
                        </Box>
                    </Tabs.Content>
                </Box>
            </Tabs.Root>
        </Box>
    );
};

export { ConfigTab };
export default ConfigTab;
