import { Box, Typography, Tabs, Divider } from '@strapi/design-system';

const INTRO_VIDEO_URL = 'https://www.youtube.com/watch?v=hr3dD6dLgLQ';
const INTRO_VIDEO_THUMBNAIL = 'https://img.youtube.com/vi/hr3dD6dLgLQ/hqdefault.jpg';

const HelpSection = ({ title, children }) => (
  <Box paddingBottom={6}>
    <Typography variant="delta" tag="h3" paddingBottom={2}>{title}</Typography>
    {children}
  </Box>
);

const DocLink = ({ href, children }) => (
  <Typography
    variant="omega"
    textColor="primary600"
    tag="a"
    href={href}
    target="_blank"
    rel="noopener noreferrer"
    style={{ textDecoration: 'none' }}
  >
    {children} →
  </Typography>
);

const CodeBlock = ({ children }) => (
  <Box background="neutral150" padding={3} hasRadius marginTop={2} marginBottom={2}>
    <Typography variant="pi" tag="pre" style={{ fontFamily: 'monospace', whiteSpace: 'pre-wrap' }}>
      {children}
    </Typography>
  </Box>
);

export const HelpTab = () => {
  return (
    <Box background="neutral0" padding={6} shadow="filterShadow" hasRadius>
      <Box paddingBottom={4}>
        <Typography variant="beta" tag="h2">Plugin Documentation</Typography>
        <Typography variant="omega" textColor="neutral600">
          End-to-end guide for configuring, securing, and operating Content Sync Pro across Strapi environments.
        </Typography>
      </Box>

      <Tabs.Root defaultValue="overview">
        <Tabs.List>
          <Tabs.Trigger value="overview">Overview</Tabs.Trigger>
          <Tabs.Trigger value="configuration">Configuration</Tabs.Trigger>
          <Tabs.Trigger value="content-types">Content Types</Tabs.Trigger>
          <Tabs.Trigger value="sync-profiles">Sync Profiles</Tabs.Trigger>
          <Tabs.Trigger value="execution">Sync Execution</Tabs.Trigger>
          <Tabs.Trigger value="media">Media</Tabs.Trigger>
          <Tabs.Trigger value="stats">Stats</Tabs.Trigger>
          <Tabs.Trigger value="enforcement">Enforcement</Tabs.Trigger>
          <Tabs.Trigger value="alerts">Alerts</Tabs.Trigger>
          <Tabs.Trigger value="troubleshooting">Troubleshooting</Tabs.Trigger>
        </Tabs.List>

        {/* Overview Tab */}
        <Tabs.Content value="overview">
          <Box paddingTop={4}>
            <HelpSection title="Video walkthrough">
              <Typography variant="omega" paddingBottom={3}>
                Watch the help video to get started:
              </Typography>

              <Box
                background="neutral100"
                hasRadius
                padding={3}
                style={{ maxWidth: '960px' }}
              >
                <a href={INTRO_VIDEO_URL} target="_blank" rel="noopener noreferrer" style={{ display: 'block', textDecoration: 'none' }}>
                  <Box style={{ position: 'relative', paddingTop: '56.25%', overflow: 'hidden', borderRadius: '4px' }}>
                    <img
                      src={INTRO_VIDEO_THUMBNAIL}
                      alt="Content Sync Pro — plugin intro"
                      style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        width: '100%',
                        height: '100%',
                        objectFit: 'cover',
                      }}
                    />
                    <Box
                      style={{
                        position: 'absolute',
                        top: '50%',
                        left: '50%',
                        transform: 'translate(-50%, -50%)',
                        width: '68px',
                        height: '48px',
                        backgroundColor: 'rgba(255,0,0,0.85)',
                        borderRadius: '12px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="white">
                        <polygon points="8,5 20,12 8,19" />
                      </svg>
                    </Box>
                  </Box>
                </a>
                <Box paddingTop={2}>
                  <Typography variant="pi" textColor="neutral500">
                    ▶ Watch the help video on{' '}
                    <DocLink href={INTRO_VIDEO_URL}>YouTube</DocLink>
                  </Typography>
                </Box>
              </Box>
            </HelpSection>

            <HelpSection title="What is Content Sync Pro?">
              <Typography variant="omega">
                This plugin enables data synchronization between two Strapi v5 instances. It provides a complete
                solution for keeping content in sync across development, staging, and production environments.
              </Typography>
              <Typography variant="omega" paddingTop={2}>
                <strong>Key Features:</strong>
              </Typography>
              <ul style={{ paddingLeft: '20px', marginTop: '8px', lineHeight: '1.8' }}>
                <li><Typography variant="omega">Bi-directional sync (push, pull, or both)</Typography></li>
                <li><Typography variant="omega">Sync Profiles for defining WHAT to sync</Typography></li>
                <li><Typography variant="omega">Execution modes: On-demand, Scheduled, Live, or External scheduler</Typography></li>
                <li><Typography variant="omega">Field-level sync policies (Advanced mode)</Typography></li>
                <li><Typography variant="omega">Conflict resolution strategies (Latest, Local, Remote wins)</Typography></li>
                <li><Typography variant="omega">Pagination support for large datasets with bounded memory usage</Typography></li>
                <li><Typography variant="omega">Dependency resolution - sync related entities automatically</Typography></li>
                <li><Typography variant="omega">Enforcement checks - schema, version, and time validation</Typography></li>
                <li><Typography variant="omega">Configurable alerts via email, webhook, or Strapi logs</Typography></li>
                <li><Typography variant="omega">Secure communication via API tokens and HMAC signatures</Typography></li>
              </ul>
            </HelpSection>

            <HelpSection title="Architecture Overview">
              <Typography variant="omega">
                The plugin separates concerns into distinct components:
              </Typography>
              <ul style={{ paddingLeft: '20px', marginTop: '8px', lineHeight: '1.8' }}>
                <li><Typography variant="omega"><strong>Sync Profiles</strong> - Define WHAT to sync (direction, conflict strategy, field policies)</Typography></li>
                <li><Typography variant="omega"><strong>Sync Execution</strong> - Define WHEN to sync (on-demand, scheduled, live) and dependency handling</Typography></li>
                <li><Typography variant="omega"><strong>Enforcement</strong> - Pre-sync validation (schema match, version check, time sync)</Typography></li>
                <li><Typography variant="omega"><strong>Alerts</strong> - Notifications for sync success/failure</Typography></li>
              </ul>
            </HelpSection>

            <HelpSection title="Quick Start">
              <ol style={{ paddingLeft: '20px', lineHeight: '2' }}>
                <li><Typography variant="omega"><strong>Configuration Tab</strong> - Set up remote server URL, API token, instance ID, and shared secret</Typography></li>
                <li><Typography variant="omega"><strong>Content Types Tab</strong> - Enable content types for sync (auto-generates default profiles)</Typography></li>
                <li><Typography variant="omega"><strong>Sync Profiles Tab</strong> - Customize sync behavior or use defaults</Typography></li>
                <li><Typography variant="omega"><strong>Sync Execution Tab</strong> - Configure execution settings, page size, and run sync operations</Typography></li>
              </ol>
            </HelpSection>

            <Box paddingTop={2}>
              <DocLink href="https://docs.strapi.io/dev-docs/plugins">
                Strapi Plugin Development Guide
              </DocLink>
            </Box>
          </Box>
        </Tabs.Content>

        {/* Configuration Tab */}
        <Tabs.Content value="configuration">
          <Box paddingTop={4}>
            <HelpSection title="Connection Settings">
              <Typography variant="omega" paddingBottom={2}>
                Configure the connection to the remote Strapi instance in the <strong>Connection</strong> sub-tab.
              </Typography>
              <Typography variant="omega" paddingBottom={2}>
                <strong>Deployment modes:</strong> Use <strong>Paired</strong> mode when the plugin is installed on both servers,
                or <strong>Single-side</strong> mode when the plugin is installed only on local server.
              </Typography>
              <Typography variant="omega" paddingBottom={2}>
                In paired mode, connection test validates remote plugin reachability and token access. In single-side mode,
                test validates remote reachability and content API token access without requiring remote plugin endpoints.
              </Typography>

              <Box background="neutral100" padding={4} hasRadius marginBottom={4}>
                <Typography variant="sigma" textColor="neutral800">Base URL</Typography>
                <Typography variant="omega" paddingTop={1}>
                  The full URL of the remote Strapi instance. Examples:
                </Typography>
                <CodeBlock>https://api.example.com
http://localhost:1337</CodeBlock>
                <Typography variant="pi" textColor="warning600">
                  Do not include trailing slashes or API paths.
                </Typography>
              </Box>

              <Box background="neutral100" padding={4} hasRadius marginBottom={4}>
                <Typography variant="sigma" textColor="neutral800">API Token</Typography>
                <Typography variant="omega" paddingTop={1}>
                  The API token for authenticating with the remote server. This token must have
                  appropriate permissions for the content types you want to sync.
                </Typography>
              </Box>

              <Box background="neutral100" padding={4} hasRadius marginBottom={4}>
                <Typography variant="sigma" textColor="neutral800">Instance ID</Typography>
                <Typography variant="omega" paddingTop={1}>
                  A unique identifier for this Strapi instance. Used to track sync state and prevent loops.
                  Example: <code>production-server-1</code> or <code>dev-local</code>
                </Typography>
              </Box>

              <Box background="neutral100" padding={4} hasRadius marginBottom={4}>
                <Typography variant="sigma" textColor="neutral800">Shared Secret (HMAC)</Typography>
                <Typography variant="omega" paddingTop={1}>
                  A shared secret key used to cryptographically sign requests between instances.
                  Both instances must use the exact same secret.
                </Typography>
                <Typography variant="pi" textColor="warning600" paddingTop={2}>
                  Use a strong, random string (32+ characters recommended). You can generate one with:
                </Typography>
                <CodeBlock>node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"</CodeBlock>
              </Box>
            </HelpSection>

            <HelpSection title="How to Generate API Tokens">
              <ol style={{ paddingLeft: '20px', lineHeight: '2' }}>
                <li><Typography variant="omega">Log in to your <strong>remote</strong> Strapi Admin Panel</Typography></li>
                <li><Typography variant="omega">Go to <strong>Settings</strong> → <strong>Global Settings</strong> → <strong>API Tokens</strong></Typography></li>
                <li><Typography variant="omega">Click <strong>Create new API Token</strong></Typography></li>
                <li><Typography variant="omega">Set <strong>Name</strong>: "Data Sync Token"</Typography></li>
                <li><Typography variant="omega">Set <strong>Token duration</strong>: <strong>Unlimited</strong> (recommended for sync)</Typography></li>
                <li>
                  <Typography variant="omega">Set <strong>Token type</strong>:</Typography>
                  <ul style={{ paddingLeft: '20px', marginTop: '4px' }}>
                    <li><Typography variant="omega"><em>Full Access</em> - required for push/pull operations</Typography></li>
                    <li><Typography variant="omega"><em>Custom</em> - select specific content types if needed</Typography></li>
                  </ul>
                </li>
                <li><Typography variant="omega">Click <strong>Save</strong> and <strong>copy the token immediately</strong> (it won't be shown again)</Typography></li>
              </ol>
            </HelpSection>

            <Box paddingTop={2}>
              <DocLink href="https://docs.strapi.io/user-docs/settings/api-tokens">
                Strapi API Tokens Documentation
              </DocLink>
            </Box>
          </Box>
        </Tabs.Content>

        {/* Content Types Tab */}
        <Tabs.Content value="content-types">
          <Box paddingTop={4}>
            <HelpSection title="Enabling Content Types">
              <Typography variant="omega">
                The Content Types tab is where you enable or disable content types for synchronization.
                This is a simple on/off toggle - all sync behavior configuration happens in Sync Profiles.
              </Typography>
              <Typography variant="omega" paddingTop={2}>
                Only <code>api::*</code> content types are shown (your custom content types).
                Plugin and admin content types are excluded for safety.
              </Typography>
            </HelpSection>

            <HelpSection title="Auto-Generated Profiles">
              <Typography variant="omega">
                When you enable a content type, three default profiles are automatically created:
              </Typography>
              <ul style={{ paddingLeft: '20px', marginTop: '8px', lineHeight: '1.8' }}>
                <li><Typography variant="omega"><strong>Full Push</strong> - Push all data to remote (local wins)</Typography></li>
                <li><Typography variant="omega"><strong>Full Pull</strong> - Pull all data from remote (remote wins)</Typography></li>
                <li><Typography variant="omega"><strong>Bidirectional</strong> - Two-way sync (latest wins) - <em>active by default</em></Typography></li>
              </ul>
              <Box paddingTop={2}>
                <Typography variant="omega">
                  You can customize these profiles or create new ones in the <strong>Sync Profiles</strong> tab.
                </Typography>
              </Box>
            </HelpSection>

            <HelpSection title="Content Type Status Display">
              <Typography variant="omega">
                Each content type card shows:
              </Typography>
              <ul style={{ paddingLeft: '20px', marginTop: '8px', lineHeight: '1.8' }}>
                <li><Typography variant="omega">Number of sync profiles configured</Typography></li>
                <li><Typography variant="omega">Currently active profile name</Typography></li>
                <li><Typography variant="omega">Enable/disable toggle switch</Typography></li>
              </ul>
            </HelpSection>

            <Box paddingTop={2}>
              <DocLink href="https://docs.strapi.io/dev-docs/backend-customization/models">
                Strapi Content Types Documentation
              </DocLink>
            </Box>
          </Box>
        </Tabs.Content>

        {/* Sync Profiles Tab */}
        <Tabs.Content value="sync-profiles">
          <Box paddingTop={4}>
            <HelpSection title="What are Sync Profiles?">
              <Typography variant="omega">
                Sync Profiles define <strong>WHAT</strong> to sync and <strong>HOW</strong> conflicts are resolved.
                They do NOT control when sync runs - that's configured in the Sync tab (Execution).
              </Typography>
              <Typography variant="omega" paddingTop={2}>
                In <strong>Single-side</strong> mode, profiles are automatically restricted to <strong>Pull Only</strong>.
              </Typography>
              <Typography variant="omega" paddingTop={2}>
                Each profile specifies:
              </Typography>
              <ul style={{ paddingLeft: '20px', marginTop: '8px', lineHeight: '1.8' }}>
                <li><Typography variant="omega"><strong>Direction</strong> - Push, Pull, or Bidirectional</Typography></li>
                <li><Typography variant="omega"><strong>Conflict Strategy</strong> - Latest wins, Local wins, or Remote wins</Typography></li>
                <li><Typography variant="omega"><strong>Field Policies</strong> (Advanced) - Per-field direction control</Typography></li>
              </ul>
            </HelpSection>

            <HelpSection title="Simple vs Advanced Mode">
              <Box background="neutral100" padding={4} hasRadius marginBottom={4}>
                <Typography variant="sigma" textColor="neutral800">Simple Mode</Typography>
                <Typography variant="omega" paddingTop={1}>
                  Choose from preset configurations. All fields sync with the same direction.
                  Best for straightforward sync scenarios.
                </Typography>
                <Typography variant="omega" paddingTop={2}>
                  <strong>Available Presets:</strong>
                </Typography>
                <ul style={{ paddingLeft: '20px', marginTop: '4px' }}>
                  <li><Typography variant="omega">Full Push - Push all, local wins</Typography></li>
                  <li><Typography variant="omega">Full Pull - Pull all, remote wins</Typography></li>
                  <li><Typography variant="omega">Bidirectional - Both ways, latest wins</Typography></li>
                </ul>
              </Box>

              <Box background="neutral100" padding={4} hasRadius marginBottom={4}>
                <Typography variant="sigma" textColor="neutral800">Advanced Mode</Typography>
                <Typography variant="omega" paddingTop={1}>
                  Configure individual field-level policies. Each field can have its own direction:
                </Typography>
                <ul style={{ paddingLeft: '20px', marginTop: '8px' }}>
                  <li><Typography variant="omega"><strong>Both</strong> - Field syncs in both directions</Typography></li>
                  <li><Typography variant="omega"><strong>Push</strong> - Field only pushes to remote</Typography></li>
                  <li><Typography variant="omega"><strong>Pull</strong> - Field only pulls from remote</Typography></li>
                  <li><Typography variant="omega"><strong>Exclude</strong> - Field is never synced</Typography></li>
                </ul>
              </Box>
            </HelpSection>

            <HelpSection title="Profile Settings Explained">
              <Box background="neutral100" padding={4} hasRadius marginBottom={4}>
                <Typography variant="sigma" textColor="neutral800">Sync Direction</Typography>
                <ul style={{ paddingLeft: '20px', marginTop: '8px' }}>
                  <li><Typography variant="omega"><strong>Push Only</strong> - Send local changes to remote, never receive</Typography></li>
                  <li><Typography variant="omega"><strong>Pull Only</strong> - Receive remote changes locally, never send</Typography></li>
                  <li><Typography variant="omega"><strong>Bidirectional</strong> - Two-way sync (changes flow both ways)</Typography></li>
                </ul>
              </Box>

              <Box background="neutral100" padding={4} hasRadius marginBottom={4}>
                <Typography variant="sigma" textColor="neutral800">Conflict Strategy</Typography>
                <Typography variant="omega" paddingTop={1}>
                  Determines what happens when the same record is modified on both sides:
                </Typography>
                <ul style={{ paddingLeft: '20px', marginTop: '8px' }}>
                  <li><Typography variant="omega"><strong>Latest Wins</strong> - The most recently updated version is kept (based on updatedAt)</Typography></li>
                  <li><Typography variant="omega"><strong>Local Wins</strong> - Local version always takes priority</Typography></li>
                  <li><Typography variant="omega"><strong>Remote Wins</strong> - Remote version always takes priority</Typography></li>
                </ul>
              </Box>
            </HelpSection>

            <HelpSection title="Use Case Examples">
              <Box background="neutral100" padding={4} hasRadius marginBottom={4}>
                <Typography variant="sigma" textColor="neutral800">Example 1: Content Approval Workflow</Typography>
                <Typography variant="omega" paddingTop={1}>
                  Content created locally, pushed for approval. Only <code>approval_status</code> and
                  <code>approved_by</code> fields are pulled back.
                </Typography>
                <Typography variant="pi" textColor="primary600" paddingTop={2}>
                  → Use Advanced mode: All fields Push, approval fields Pull
                </Typography>
              </Box>

              <Box background="neutral100" padding={4} hasRadius marginBottom={4}>
                <Typography variant="sigma" textColor="neutral800">Example 2: E-commerce Orders</Typography>
                <Typography variant="omega" paddingTop={1}>
                  Orders pulled from e-commerce platform, only <code>shipping_status</code> and
                  <code>tracking_number</code> pushed back to update customers.
                </Typography>
                <Typography variant="pi" textColor="primary600" paddingTop={2}>
                  → Use Advanced mode: All fields Pull, shipping fields Push
                </Typography>
              </Box>

              <Box background="neutral100" padding={4} hasRadius marginBottom={4}>
                <Typography variant="sigma" textColor="neutral800">Example 3: Full Backup Sync</Typography>
                <Typography variant="omega" paddingTop={1}>
                  Production data mirrored to backup server for disaster recovery.
                </Typography>
                <Typography variant="pi" textColor="primary600" paddingTop={2}>
                  → Use Simple mode: Full Push preset
                </Typography>
              </Box>
            </HelpSection>

            <HelpSection title="Active Profiles">
              <Typography variant="omega">
                Only <strong>one profile can be active</strong> per content type at any time.
                The active profile determines the sync behavior when that content type is synced.
              </Typography>
              <Typography variant="omega" paddingTop={2}>
                To change the active profile, click the <strong>Activate</strong> button on any inactive profile.
                This will deactivate the currently active profile automatically.
              </Typography>
            </HelpSection>
          </Box>
        </Tabs.Content>

        {/* Sync Execution Tab */}
        <Tabs.Content value="execution">
          <Box paddingTop={4}>
            <HelpSection title="Execution Modes">
              <Typography variant="omega">
                Execution modes determine <strong>WHEN</strong> sync operations run. Configure these in the
                <strong> Sync</strong> tab by clicking the settings icon on each profile.
              </Typography>

              <Box background="neutral100" padding={4} hasRadius marginBottom={4}>
                <Typography variant="sigma" textColor="neutral800">On Demand (Manual)</Typography>
                <Typography variant="omega" paddingTop={1}>
                  Sync only runs when you manually trigger it by clicking "Run Now" or "Sync All".
                  Best for controlled deployments and testing.
                </Typography>
              </Box>

              <Box background="neutral100" padding={4} hasRadius marginBottom={4}>
                <Typography variant="sigma" textColor="neutral800">Scheduled</Typography>
                <Typography variant="omega" paddingTop={1}>
                  Sync runs automatically on a schedule. You can pick one of four{' '}
                  <strong>schedule types</strong>, each with different reliability tradeoffs:
                </Typography>
                <ul style={{ paddingLeft: '20px', marginTop: '8px', lineHeight: '1.8' }}>
                  <li><Typography variant="omega"><strong>Interval (setInterval)</strong> — Fires every N minutes. Simple and lightweight. Can overlap if a run takes longer than the interval, and drifts slightly over time. Good for small, frequent syncs.</Typography></li>
                  <li><Typography variant="omega"><strong>Timeout (chained setTimeout)</strong> — Waits for the previous run to finish before scheduling the next. Cannot overlap. Recommended when individual syncs can take a long time.</Typography></li>
                  <li><Typography variant="omega"><strong>Cron (wall-clock)</strong> — Uses Strapi's built-in <code>strapi.cron</code> (node-schedule) with a standard cron expression (e.g. <code>0 */2 * * *</code>). Recommended for production and larger datasets because runs are tied to wall-clock time rather than process uptime.</Typography></li>
                  <li><Typography variant="omega"><strong>External scheduler</strong> — The plugin runs <em>no</em> in-process timer. An external system (system cron, Windows Task Scheduler, Kubernetes CronJob, cloud scheduler, CI) calls the execute endpoint on a schedule. Most reliable for very large datasets or multi-node / HA deployments where you cannot rely on a single Node process.</Typography></li>
                </ul>
                <Typography variant="pi" textColor="neutral600" paddingTop={2}>
                  Tip: If your sync regularly takes longer than a few minutes or must survive restarts predictably, prefer <strong>Cron</strong> or <strong>External</strong> over Interval/Timeout.
                </Typography>
              </Box>

              <Box background="neutral100" padding={4} hasRadius marginBottom={4}>
                <Typography variant="sigma" textColor="neutral800">External Scheduled Jobs (how-to)</Typography>
                <Typography variant="omega" paddingTop={1}>
                  Select schedule type <strong>External</strong> on a profile, then configure any scheduler you already trust to POST to the execute endpoint:
                </Typography>
                <Box background="neutral0" padding={3} hasRadius marginTop={2} marginBottom={2}>
                  <Typography variant="pi" style={{ fontFamily: 'monospace' }}>
                    POST {'{BASE_URL}'}/api/strapi-content-sync-pro/sync-execution/execute/{'{profileId}'}<br />
                    Authorization: Bearer {'{STRAPI_API_TOKEN}'}<br />
                    Content-Type: application/json
                  </Typography>
                </Box>
                <Typography variant="omega" paddingTop={1}><strong>Linux cron</strong> (every hour):</Typography>
                <Box background="neutral0" padding={3} hasRadius marginTop={1} marginBottom={2}>
                  <Typography variant="pi" style={{ fontFamily: 'monospace' }}>
                    0 * * * * curl -fsS -X POST -H "Authorization: Bearer $TOKEN" https://cms.example.com/api/strapi-content-sync-pro/sync-execution/execute/PROFILE_ID
                  </Typography>
                </Box>
                <Typography variant="omega" paddingTop={1}><strong>Windows Task Scheduler</strong> (PowerShell):</Typography>
                <Box background="neutral0" padding={3} hasRadius marginTop={1} marginBottom={2}>
                  <Typography variant="pi" style={{ fontFamily: 'monospace' }}>
                    {"$a = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument '-Command \"Invoke-RestMethod -Method Post -Uri https://cms.example.com/api/strapi-content-sync-pro/sync-execution/execute/PROFILE_ID -Headers @{Authorization=''Bearer ''+$env:SYNC_TOKEN}\"'"}<br />
                    {'$t = New-ScheduledTaskTrigger -Daily -At 2am'}<br />
                    {'Register-ScheduledTask -TaskName "StrapiDataSync" -Action $a -Trigger $t'}
                  </Typography>
                </Box>
                <Typography variant="omega" paddingTop={1}><strong>systemd timer</strong> (unit + timer):</Typography>
                <Box background="neutral0" padding={3} hasRadius marginTop={1} marginBottom={2}>
                  <Typography variant="pi" style={{ fontFamily: 'monospace' }}>
                    # /etc/systemd/system/strapi-sync.service<br />
                    [Service]<br />
                    Type=oneshot<br />
                    ExecStart=/usr/bin/curl -fsS -X POST -H "Authorization: Bearer %i" https://cms.example.com/api/strapi-content-sync-pro/sync-execution/execute/PROFILE_ID<br /><br />
                    # /etc/systemd/system/strapi-sync.timer<br />
                    [Timer]<br />
                    OnCalendar=hourly<br />
                    Unit=strapi-sync.service<br />
                    [Install]<br />
                    WantedBy=timers.target
                  </Typography>
                </Box>
                <Typography variant="omega" paddingTop={1}><strong>Kubernetes CronJob</strong>:</Typography>
                <Box background="neutral0" padding={3} hasRadius marginTop={1} marginBottom={2}>
                  <Typography variant="pi" style={{ fontFamily: 'monospace' }}>
                    apiVersion: batch/v1<br />
                    kind: CronJob<br />
                    metadata: {'{'} name: strapi-data-sync {'}'}<br />
                    spec:<br />
                    &nbsp;&nbsp;schedule: "0 * * * *"<br />
                    &nbsp;&nbsp;jobTemplate:<br />
                    &nbsp;&nbsp;&nbsp;&nbsp;spec:<br />
                    &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;template:<br />
                    &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;spec:<br />
                    &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;restartPolicy: OnFailure<br />
                    &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;containers:<br />
                    &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;- name: sync<br />
                    &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;image: curlimages/curl:latest<br />
                    &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;args: ["-fsS","-X","POST","-H","Authorization: Bearer $(TOKEN)","https://cms.example.com/api/strapi-content-sync-pro/sync-execution/execute/PROFILE_ID"]
                  </Typography>
                </Box>
                <Typography variant="omega" paddingTop={1}><strong>GitHub Actions</strong> (scheduled workflow):</Typography>
                <Box background="neutral0" padding={3} hasRadius marginTop={1} marginBottom={2}>
                  <Typography variant="pi" style={{ fontFamily: 'monospace' }}>
                    on:<br />
                    &nbsp;&nbsp;schedule:<br />
                    &nbsp;&nbsp;&nbsp;&nbsp;- cron: "0 * * * *"<br />
                    jobs:<br />
                    &nbsp;&nbsp;sync:<br />
                    &nbsp;&nbsp;&nbsp;&nbsp;runs-on: ubuntu-latest<br />
                    &nbsp;&nbsp;&nbsp;&nbsp;steps:<br />
                    {'      - run: curl -fsS -X POST -H "Authorization: Bearer ${{ secrets.SYNC_TOKEN }}" https://cms.example.com/api/strapi-content-sync-pro/sync-execution/execute/PROFILE_ID'}
                  </Typography>
                </Box>
                <Typography variant="pi" textColor="neutral600" paddingTop={2}>
                  The API token must have permission to access the plugin's content-api routes. Generate it in Strapi under <strong>Settings → API Tokens</strong>, or via the Connection tab's "Login &amp; Create Token" helper.
                </Typography>
              </Box>

              <Box background="neutral100" padding={4} hasRadius marginBottom={4}>
                <Typography variant="sigma" textColor="neutral800">Live (Real-time)</Typography>
                <Typography variant="omega" paddingTop={1}>
                  Sync triggers immediately when content changes (create, update, delete).
                  Uses lifecycle hooks to detect changes.
                </Typography>
                <Typography variant="pi" textColor="warning600" paddingTop={2}>
                  Note: Increases server load. Use for critical content only. Live mode is available in paired mode and disabled in single-side mode.
                </Typography>
              </Box>
            </HelpSection>

            <HelpSection title="Dependency Syncing">
              <Typography variant="omega">
                When enabled, the system automatically syncs related entities along with the main content.
              </Typography>
              <ul style={{ paddingLeft: '20px', marginTop: '8px', lineHeight: '1.8' }}>
                <li><Typography variant="omega"><strong>Relations</strong> - Related content types (oneToOne, oneToMany, etc.)</Typography></li>
                <li><Typography variant="omega"><strong>Components</strong> - Embedded component data</Typography></li>
                <li><Typography variant="omega"><strong>Dynamic Zones</strong> - Dynamic zone component data</Typography></li>
              </ul>
              <Typography variant="omega" paddingTop={2}>
                <strong>Dependency Depth:</strong> Controls how many levels of relations to follow (1-5).
                Higher depth = more complete sync, but slower and more data transferred.
              </Typography>
            </HelpSection>

            <HelpSection title="Running Sync Operations">
              <Typography variant="omega">
                The Sync tab provides two ways to trigger sync:
              </Typography>
              <ul style={{ paddingLeft: '20px', marginTop: '8px', lineHeight: '1.8' }}>
                <li><Typography variant="omega"><strong>Sync All Active Profiles</strong> - Runs all active profiles for all enabled content types</Typography></li>
                <li><Typography variant="omega"><strong>Run Now</strong> (per profile) - Runs a specific profile immediately</Typography></li>
              </ul>
            </HelpSection>

            <HelpSection title="Execution Status">
              <Typography variant="omega">
                The Status tab in Sync shows the current state of all profiles:
              </Typography>
              <ul style={{ paddingLeft: '20px', marginTop: '8px', lineHeight: '1.8' }}>
                <li><Typography variant="omega"><strong>Execution Mode</strong> - Current mode (On Demand, Scheduled, Live)</Typography></li>
                <li><Typography variant="omega"><strong>Enabled</strong> - Whether automatic execution is enabled</Typography></li>
                <li><Typography variant="omega"><strong>Last Run</strong> - When sync last executed</Typography></li>
                <li><Typography variant="omega"><strong>Next Run</strong> - When scheduled sync will run next</Typography></li>
                <li><Typography variant="omega"><strong>Status</strong> - Running or Idle</Typography></li>
              </ul>
            </HelpSection>
          </Box>
        </Tabs.Content>

        {/* Media Tab */}
        <Tabs.Content value="media">
          <Box paddingTop={4}>
            <HelpSection title="Pagination for Large Datasets">
              <Typography variant="omega">
                Content-type sync is paginated end-to-end. The global <strong>Page size</strong>
                (<code>syncPageSize</code>, default 100) controls how many records the local Document Service and
                the remote REST API return per request. Both sides fetch in the same page-size chunks
                and records are processed in bounded memory, so syncing millions of entries does not
                spike memory.
              </Typography>
              <Typography variant="omega" paddingTop={2}>
                Tune it from the <strong>Sync</strong> tab's global execution settings. Larger pages
                are faster but use more memory per chunk; smaller pages are safer on constrained hosts.
              </Typography>
            </HelpSection>

            <HelpSection title="Media Sync Profiles">
              <Typography variant="omega">
                Media sync now uses the same <strong>profile-based model</strong> as content-type sync.
                Each media profile defines:
              </Typography>
              <ul style={{ paddingLeft: '20px', marginTop: '8px', lineHeight: '1.8' }}>
                <li><Typography variant="omega"><strong>Strategy</strong> - URL (HTTP), rsync (file copy), or Disabled</Typography></li>
                <li><Typography variant="omega"><strong>Direction</strong> - Push, Pull, or Both</Typography></li>
                <li><Typography variant="omega"><strong>Conflict Strategy</strong> - Latest Wins, Local Wins, or Remote Wins</Typography></li>
                <li><Typography variant="omega"><strong>Sync Scope</strong> - DB rows (metadata), file bytes, or both</Typography></li>
                <li><Typography variant="omega"><strong>File Type Filters</strong> - Include/exclude by MIME type and filename patterns</Typography></li>
                <li><Typography variant="omega"><strong>Execution Settings</strong> - On Demand, Scheduled (interval/timeout/cron/external), or Live</Typography></li>
              </ul>
              <Typography variant="omega" paddingTop={2}>
                Only <strong>one media profile can be active</strong> at a time. The active profile is used
                when running "Sync All Active" or when scheduled/live execution triggers.
              </Typography>
            </HelpSection>

            <HelpSection title="Default Profiles & File Types">
              <Typography variant="omega">
                Three default profiles are auto-generated on first use:
              </Typography>
              <ul style={{ paddingLeft: '20px', marginTop: '8px', lineHeight: '1.8' }}>
                <li><Typography variant="omega"><strong>Full Push (Media)</strong> - Push all, local wins</Typography></li>
                <li><Typography variant="omega"><strong>Full Pull (Media)</strong> - Pull all, remote wins</Typography></li>
                <li><Typography variant="omega"><strong>Bidirectional (Media)</strong> - Both ways, latest wins (active by default)</Typography></li>
              </ul>
              <Typography variant="omega" paddingTop={2}>
                All default profiles include common file types:
              </Typography>
              <ul style={{ paddingLeft: '20px', marginTop: '8px', lineHeight: '1.8' }}>
                <li><Typography variant="omega"><strong>Images</strong> - All image/* MIME types</Typography></li>
                <li><Typography variant="omega"><strong>Videos</strong> - MP4, WebM, AVI, QuickTime (MOV), Matroska (MKV), OGG, 3GPP</Typography></li>
                <li><Typography variant="omega"><strong>Documents</strong> - PDF, Word (DOC/DOCX), Excel (XLS/XLSX), PowerPoint (PPT/PPTX), OpenDocument (ODT/ODS), CSV, Plain Text</Typography></li>
              </ul>
              <Typography variant="pi" textColor="neutral600" paddingTop={2}>
                You can customize MIME filters per profile to include or exclude specific file types.
              </Typography>
            </HelpSection>

            <HelpSection title="Sync Scope: DB Rows vs File Bytes">
              <Typography variant="omega">
                Each profile can sync two distinct aspects of media:
              </Typography>
              <Box background="neutral100" padding={4} hasRadius marginTop={2} marginBottom={2}>
                <Typography variant="sigma" textColor="neutral800">DB Rows (Metadata)</Typography>
                <Typography variant="omega" paddingTop={1}>
                  Syncs the <code>plugin::upload.file</code> table data: name, caption, alternative text,
                  MIME type, size, dimensions, formats, folder path, etc. This ensures both instances
                  have matching upload records even if file bytes are managed separately.
                </Typography>
              </Box>
              <Box background="neutral100" padding={4} hasRadius marginBottom={2}>
                <Typography variant="sigma" textColor="neutral800">File Bytes (Assets)</Typography>
                <Typography variant="omega" paddingTop={1}>
                  Syncs the actual media files via the chosen strategy (URL download/upload or rsync).
                  Enable this when both instances need the physical files, not just database references.
                </Typography>
              </Box>
              <Typography variant="pi" textColor="warning600">
                For complete media synchronization, enable <strong>both</strong> DB rows and file bytes.
                If you only need metadata references (e.g., both sides use the same S3 bucket), you can
                sync DB rows only.
              </Typography>
            </HelpSection>

            <HelpSection title="URL strategy (HTTP)">
              <Typography variant="omega">
                Works with any upload provider on either side (local, S3, Cloudinary, ...). The plugin
                lists files via the remote <code>/api/upload/files</code> endpoint, downloads bytes via
                the file's URL, and re-uploads them with <code>POST /api/upload</code> using the
                configured API token. Files are deduped by <code>hash + name</code>, and optionally
                skipped when <code>size</code> and <code>hash</code> match.
              </Typography>
              <Box background="neutral0" padding={3} hasRadius marginTop={2}>
                <Typography variant="pi" style={{ fontFamily: 'monospace' }}>
                  Required remote API token permissions: <strong>Upload: find, findOne, upload</strong>.
                </Typography>
              </Box>
              <Typography variant="pi" textColor="neutral600" paddingTop={2}>
                Best for: small/medium libraries, cross-provider setups, environments without SSH.
              </Typography>
            </HelpSection>

            <HelpSection title="rsync strategy (file-level copy)">
              <Typography variant="omega">
                The plugin spawns the <code>rsync</code> binary on the host running Strapi. Both sides
                must use the local upload provider and the paths must be reachable (SSH target or a
                locally-mounted share). The plugin does NOT manage SSH keys; configure them on the host.
              </Typography>
              <Box background="neutral0" padding={3} hasRadius marginTop={2} marginBottom={2}>
                <Typography variant="pi" style={{ fontFamily: 'monospace' }}>
                  Local media path:  ./public/uploads<br />
                  Remote media path: deploy@cms.example.com:/srv/strapi/public/uploads<br />
                  rsync args:        -avz --delete-after<br />
                  Example (push):    rsync -avz --delete-after ./public/uploads/ deploy@cms.example.com:/srv/strapi/public/uploads
                </Typography>
              </Box>
              <Typography variant="pi" textColor="warning600" paddingTop={2}>
                <strong>Note:</strong> rsync only copies file bytes. Enable <strong>DB rows sync</strong> on
                the profile as well if the destination needs matching <code>plugin::upload.file</code> records.
              </Typography>
            </HelpSection>

            <HelpSection title="Media Execution Settings">
              <Typography variant="omega">
                Each media profile has its own execution settings, identical to content-type profiles:
              </Typography>
              <ul style={{ paddingLeft: '20px', marginTop: '8px', lineHeight: '1.8' }}>
                <li><Typography variant="omega"><strong>On Demand</strong> - Manual trigger via "Run" button or API</Typography></li>
                <li><Typography variant="omega"><strong>Scheduled</strong> - Interval, Timeout, Cron, or External scheduler</Typography></li>
                <li><Typography variant="omega"><strong>Live</strong> - Triggers on upload file changes (create/update/delete)</Typography></li>
              </ul>
              <Typography variant="omega" paddingTop={2}>
                For per-profile execution: <code>POST /api/strapi-content-sync-pro/media-sync/profiles/:id/run</code>
              </Typography>
              <Typography variant="omega" paddingTop={1}>
                For all active profiles: <code>POST /api/strapi-content-sync-pro/media-sync/run-active</code>
              </Typography>
            </HelpSection>

            <HelpSection title="Dry run & testing">
              <Typography variant="omega">
                Toggle <strong>Dry run</strong> on a profile to list what would change without transferring any
                bytes (rsync passes <code>--dry-run</code>; URL strategy skips the actual
                upload/download). Use <strong>Test connection</strong> to quickly verify the remote
                token (URL) or the rsync binary (rsync) before a real run.
              </Typography>
            </HelpSection>
          </Box>
        </Tabs.Content>

        {/* Stats Tab */}
        <Tabs.Content value="stats">
          <Box paddingTop={4}>
            <HelpSection title="Database Stats Overview">
              <Typography variant="omega">
                The Stats tab compares local and remote data state per content type. It shows record counts,
                newest timestamps, and which side currently has the newest data.
              </Typography>
            </HelpSection>

            <HelpSection title="Run Reports (Before vs After)">
              <Typography variant="omega">
                Before every sync run, the plugin captures a pre-run snapshot. After the run completes,
                it captures a post-run snapshot and stores both in a report. This helps you review sync impact
                and trends over time.
              </Typography>
            </HelpSection>

            <HelpSection title="Retention & Cleanup Controls">
              <Typography variant="omega">
                To control storage growth, use manual clear actions for logs and reports, and configure
                automatic retention limits (maximum log entries and report entries). Older data is pruned
                when limits are exceeded.
              </Typography>
            </HelpSection>
          </Box>
        </Tabs.Content>

        {/* Enforcement Tab */}
        <Tabs.Content value="enforcement">
          <Box paddingTop={4}>
            <HelpSection title="Pre-Sync Validation">
              <Typography variant="omega">
                Enforcement checks run before each sync operation to ensure compatibility between instances.
                Configure these in <strong>Configuration → Enforcement</strong>.
              </Typography>
            </HelpSection>

            <HelpSection title="Schema Match">
              <Typography variant="omega">
                Verifies that content type schemas are compatible between local and remote instances.
              </Typography>
              <ul style={{ paddingLeft: '20px', marginTop: '8px', lineHeight: '1.8' }}>
                <li><Typography variant="omega"><strong>Strict</strong> - Schemas must match exactly (same fields, same types)</Typography></li>
                <li><Typography variant="omega"><strong>Compatible</strong> - Extra fields allowed, but common fields must match types</Typography></li>
                <li><Typography variant="omega"><strong>None</strong> - Skip schema checking entirely</Typography></li>
              </ul>
              <Typography variant="pi" textColor="warning600" paddingTop={2}>
                Recommended: Use "Strict" during development, "Compatible" in production if schemas may drift.
              </Typography>
            </HelpSection>

            <HelpSection title="Version Check">
              <Typography variant="omega">
                Ensures Strapi versions are compatible between instances.
              </Typography>
              <ul style={{ paddingLeft: '20px', marginTop: '8px', lineHeight: '1.8' }}>
                <li><Typography variant="omega"><strong>Exact</strong> - Versions must match exactly (e.g., both 5.0.0)</Typography></li>
                <li><Typography variant="omega"><strong>Minor</strong> - Major version must match (e.g., 5.0.0 and 5.1.0 are OK)</Typography></li>
                <li><Typography variant="omega"><strong>Major</strong> - Any version allowed (not recommended)</Typography></li>
                <li><Typography variant="omega"><strong>None</strong> - Skip version checking</Typography></li>
              </ul>
            </HelpSection>

            <HelpSection title="DateTime Sync">
              <Typography variant="omega">
                Verifies that server clocks are synchronized. Important for "Latest Wins" conflict resolution.
              </Typography>
              <Typography variant="omega" paddingTop={2}>
                <strong>Max Time Drift:</strong> Maximum allowed difference in milliseconds (default: 60000ms = 1 minute).
              </Typography>
              <Typography variant="pi" textColor="neutral600" paddingTop={2}>
                If servers are in different time zones, ensure they use NTP for clock synchronization.
              </Typography>
            </HelpSection>

            <HelpSection title="Block on Failure">
              <Typography variant="omega">
                When enabled, sync operations are blocked if any enforcement check fails.
                When disabled, warnings are logged but sync proceeds anyway.
              </Typography>
            </HelpSection>
          </Box>
        </Tabs.Content>

        {/* Alerts Tab */}
        <Tabs.Content value="alerts">
          <Box paddingTop={4}>
            <HelpSection title="Alert Channels">
              <Typography variant="omega">
                Configure notifications for sync success and failure events in <strong>Configuration → Alerts</strong>.
              </Typography>
            </HelpSection>

            <HelpSection title="Strapi Notifications">
              <Typography variant="omega">
                Logs sync events to the plugin's sync log, visible in the <strong>Logs</strong> tab.
                Also logs to the Strapi server console.
              </Typography>
              <Typography variant="omega" paddingTop={2}>
                This is the simplest notification method and is enabled by default.
              </Typography>
            </HelpSection>

            <HelpSection title="Email Notifications">
              <Typography variant="omega">
                Send email alerts using Strapi's built-in email plugin. This plugin leverages whatever
                email provider you have configured in your Strapi instance.
              </Typography>

              <Box background="neutral100" padding={4} hasRadius marginTop={4} marginBottom={4}>
                <Typography variant="sigma" textColor="neutral800">Supported Email Providers</Typography>
                <Typography variant="omega" paddingTop={1}>
                  Strapi supports several email providers. Install and configure one of:
                </Typography>
                <ul style={{ paddingLeft: '20px', marginTop: '8px' }}>
                  <li><Typography variant="omega"><strong>@strapi/provider-email-sendgrid</strong> - SendGrid (recommended for production)</Typography></li>
                  <li><Typography variant="omega"><strong>@strapi/provider-email-mailgun</strong> - Mailgun</Typography></li>
                  <li><Typography variant="omega"><strong>@strapi/provider-email-amazon-ses</strong> - Amazon SES</Typography></li>
                  <li><Typography variant="omega"><strong>@strapi/provider-email-nodemailer</strong> - Any SMTP server (Gmail, custom, etc.)</Typography></li>
                </ul>
              </Box>

              <Box background="warning100" padding={4} hasRadius marginBottom={4}>
                <Typography variant="sigma" textColor="warning700">Setup Instructions</Typography>
                <Typography variant="omega" paddingTop={1}>
                  To enable email alerts:
                </Typography>
                <ol style={{ paddingLeft: '20px', marginTop: '8px' }}>
                  <li><Typography variant="omega">Install a provider: <code>npm install @strapi/provider-email-sendgrid</code></Typography></li>
                  <li><Typography variant="omega">Configure in <code>config/plugins.js</code></Typography></li>
                  <li><Typography variant="omega">Add your API key or credentials</Typography></li>
                  <li><Typography variant="omega">Restart Strapi</Typography></li>
                </ol>
                <Typography variant="pi" paddingTop={2}>
                  See: <a href="https://docs.strapi.io/dev-docs/providers" target="_blank" rel="noopener noreferrer">Strapi Email Providers Documentation</a>
                </Typography>
              </Box>

              <Typography variant="omega">
                <strong>Recipients:</strong> Enter comma-separated email addresses to receive alerts.
                The sender address uses your email plugin's default, or you can override it.
              </Typography>
            </HelpSection>

            <HelpSection title="Webhook Notifications">
              <Typography variant="omega">
                Send alerts to any HTTP endpoint (Slack, Discord, custom systems, etc.).
              </Typography>
              <Typography variant="omega" paddingTop={2}>
                The webhook receives a POST request with JSON body:
              </Typography>
              <CodeBlock>{`{
  "event": "sync_success" | "sync_failure",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "data": {
    "profile": "Full Push",
    "contentType": "api::article.article",
    "duration": 5000,
    "error": "Error message (only on failure)"
  }
}`}</CodeBlock>
            </HelpSection>

            <HelpSection title="Alert Triggers">
              <Typography variant="omega">
                Each channel can be configured to trigger on:
              </Typography>
              <ul style={{ paddingLeft: '20px', marginTop: '8px', lineHeight: '1.8' }}>
                <li><Typography variant="omega"><strong>On Success</strong> - Alert when sync completes successfully</Typography></li>
                <li><Typography variant="omega"><strong>On Failure</strong> - Alert when sync fails with an error</Typography></li>
              </ul>
              <Typography variant="pi" textColor="neutral600" paddingTop={2}>
                Tip: Enable "On Failure" for all channels, but only enable "On Success" where needed to avoid alert fatigue.
              </Typography>
            </HelpSection>

            <HelpSection title="Testing Alerts">
              <Typography variant="omega">
                Use the <strong>Test</strong> button next to each channel to send a test notification.
                This helps verify your configuration before relying on it for real alerts.
              </Typography>
            </HelpSection>
          </Box>
        </Tabs.Content>

        {/* Troubleshooting Tab */}
        <Tabs.Content value="troubleshooting">
          <Box paddingTop={4}>
            <HelpSection title="Common Issues">
              <Box background="danger100" padding={4} hasRadius marginBottom={4}>
                <Typography variant="sigma" textColor="danger700">Remote server not configured</Typography>
                <Typography variant="omega" paddingTop={1}>
                  Go to Configuration → Connection and enter the Base URL and API Token for the remote server.
                </Typography>
              </Box>

              <Box background="danger100" padding={4} hasRadius marginBottom={4}>
                <Typography variant="sigma" textColor="danger700">No content types configured for sync</Typography>
                <Typography variant="omega" paddingTop={1}>
                  Go to Content Types tab and enable at least one content type for synchronization.
                </Typography>
              </Box>

              <Box background="danger100" padding={4} hasRadius marginBottom={4}>
                <Typography variant="sigma" textColor="danger700">401 Unauthorized / 403 Forbidden</Typography>
                <Typography variant="omega" paddingTop={1}>
                  The API token is invalid, expired, or missing required permissions. Generate a new token on the remote
                  server and ensure it can access the synced content types (and Upload permissions for media sync).
                </Typography>
              </Box>

              <Box background="danger100" padding={4} hasRadius marginBottom={4}>
                <Typography variant="sigma" textColor="danger700">HMAC signature verification failed</Typography>
                <Typography variant="omega" paddingTop={1}>
                  The shared secret does not match between instances. Ensure both instances have exactly
                  the same value in Configuration → Connection → Shared Secret.
                </Typography>
              </Box>

              <Box background="danger100" padding={4} hasRadius marginBottom={4}>
                <Typography variant="sigma" textColor="danger700">Content type endpoint not found on remote</Typography>
                <Typography variant="omega" paddingTop={1}>
                  The content type exists locally but the remote REST endpoint is missing or named differently.
                  Ensure both instances have matching content type definitions and API routes are enabled.
                </Typography>
              </Box>

              <Box background="danger100" padding={4} hasRadius marginBottom={4}>
                <Typography variant="sigma" textColor="danger700">Schema mismatch error</Typography>
                <Typography variant="omega" paddingTop={1}>
                  Content type schemas don't match between instances. Either update schemas to match,
                  or change Enforcement → Schema Match to "Compatible" or "None".
                </Typography>
              </Box>

              <Box background="danger100" padding={4} hasRadius marginBottom={4}>
                <Typography variant="sigma" textColor="danger700">Email test failed - SMTP not configured</Typography>
                <Typography variant="omega" paddingTop={1}>
                  Complete all SMTP fields in Configuration → Alerts → Email including host, username,
                  password, and from address.
                </Typography>
              </Box>

              <Box background="danger100" padding={4} hasRadius marginBottom={4}>
                <Typography variant="sigma" textColor="danger700">Time sync check failed</Typography>
                <Typography variant="omega" paddingTop={1}>
                  Server clocks are too far apart. Sync server times using NTP, or increase the
                  Max Time Drift in Enforcement settings.
                </Typography>
              </Box>
            </HelpSection>

            <HelpSection title="Best Practices">
              <ul style={{ paddingLeft: '20px', lineHeight: '2' }}>
                <li><Typography variant="omega">Use <strong>Unlimited</strong> token duration to avoid sync failures from expired tokens</Typography></li>
                <li><Typography variant="omega">Start with a single content type to test sync before enabling more</Typography></li>
                <li><Typography variant="omega">Use <strong>On Demand</strong> mode initially to validate configuration</Typography></li>
                <li><Typography variant="omega">Monitor the <strong>Logs</strong> tab regularly for errors</Typography></li>
                <li><Typography variant="omega">Keep content type schemas identical on both instances</Typography></li>
                <li><Typography variant="omega">Use strong, unique shared secrets (32+ random characters)</Typography></li>
                <li><Typography variant="omega">Configure email alerts for failures at minimum</Typography></li>
                <li><Typography variant="omega">Test with non-critical content types first</Typography></li>
                <li><Typography variant="omega">Use <strong>Latest Wins</strong> conflict strategy unless you have a specific need</Typography></li>
              </ul>
            </HelpSection>

            <HelpSection title="Viewing Logs">
              <Typography variant="omega">
                The <strong>Logs</strong> tab shows a detailed history of all sync operations:
              </Typography>
              <ul style={{ paddingLeft: '20px', marginTop: '8px', lineHeight: '1.8' }}>
                <li><Typography variant="omega">Timestamp of each operation</Typography></li>
                <li><Typography variant="omega">Content type and record identifier</Typography></li>
                <li><Typography variant="omega">Direction (push/pull/system)</Typography></li>
                <li><Typography variant="omega">Status (success/error)</Typography></li>
                <li><Typography variant="omega">Error messages for failed operations</Typography></li>
              </ul>
            </HelpSection>

            <Box paddingTop={4}>
              <Typography variant="delta" tag="h3">External Resources</Typography>
              <Box paddingTop={2}>
                <DocLink href="https://docs.strapi.io/dev-docs/api/rest">
                  Strapi REST API Documentation
                </DocLink>
              </Box>
              <Box paddingTop={2}>
                <DocLink href="https://docs.strapi.io/dev-docs/backend-customization/middlewares">
                  Strapi Middlewares Documentation
                </DocLink>
              </Box>
              <Box paddingTop={2}>
                <DocLink href="https://docs.strapi.io/user-docs/settings/api-tokens">
                  API Tokens Guide
                </DocLink>
              </Box>
              <Box paddingTop={2}>
                <DocLink href="https://github.com/eharain/strapi-plugins-strapi-content-sync-pro/issues">
                  Report an Issue on GitHub
                </DocLink>
              </Box>
            </Box>
          </Box>
        </Tabs.Content>
      </Tabs.Root>
    </Box>
  );
};
