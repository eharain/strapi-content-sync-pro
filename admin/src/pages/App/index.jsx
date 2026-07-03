import { Routes, Route, Navigate } from 'react-router-dom';
import { Page } from '@strapi/strapi/admin';
import { Layout } from '../../components/Layout';
import { HomeHub } from '../../components/HomeHub';
import { ConfigTab } from '../../components/ConfigTab';
import { ContentTypesTab } from '../../components/ContentTypesTab';
import { SyncTab } from '../../components/SyncTab';
import { LogsTab } from '../../components/LogsTab';
import { StatsTab } from '../../components/StatsTab';
import { HelpTab } from '../../components/HelpTab';
import { SyncProfilesTab } from '../../components/SyncProfilesTab';
import { MediaTab } from '../../components/MediaTab';
import BulkTransferTab from '../../components/BulkTransferTab';
import { SetupWizard } from '../../components/SetupWizard';

// Nested, URL-reflected routing over a two-tier IA. The Layout renders the
// persistent header, grouped primary navigation, per-section secondary nav,
// breadcrumbs, and an <Outlet/>. Every screen below is a genuine, shareable URL.
const App = () => {
    return (
        <Routes>
            <Route element={<Layout />}>
                <Route index element={<HomeHub />} />

                {/* Guided first-run */}
                <Route path="setup" element={<SetupWizard />} />
                <Route path="setup/:step" element={<SetupWizard />} />

                {/* Sync section */}
                <Route path="sync" element={<SyncTab />} />
                <Route path="sync/bulk" element={<BulkTransferTab />} />

                {/* Configure section */}
                <Route path="configure" element={<Navigate to="connection" replace />} />
                <Route path="configure/connection" element={<ConfigTab only={['connection']} />} />
                <Route path="configure/content-types" element={<ContentTypesTab />} />
                <Route path="configure/profiles" element={<SyncProfilesTab />} />
                <Route path="configure/profiles/:profileId" element={<SyncProfilesTab />} />
                <Route path="configure/advanced" element={<ConfigTab only={['enforcement', 'alerts']} />} />

                {/* Media section */}
                <Route path="media" element={<MediaTab />} />
                <Route path="media/:profileId" element={<MediaTab />} />

                {/* History section */}
                <Route path="history" element={<Navigate to="stats" replace />} />
                <Route path="history/stats" element={<StatsTab />} />
                <Route path="history/logs" element={<LogsTab />} />

                {/* Help */}
                <Route path="help" element={<HelpTab />} />

                {/* Legacy path redirects (old flat tabs) */}
                <Route path="config" element={<Navigate to="configure/connection" replace />} />
                <Route path="configuration" element={<Navigate to="configure/connection" replace />} />
                <Route path="content-types" element={<Navigate to="configure/content-types" replace />} />
                <Route path="sync-profiles" element={<Navigate to="configure/profiles" replace />} />
                <Route path="bulk-transfer" element={<Navigate to="sync/bulk" replace />} />
                <Route path="stats" element={<Navigate to="history/stats" replace />} />
                <Route path="logs" element={<Navigate to="history/logs" replace />} />

                <Route path="*" element={<Page.Error />} />
            </Route>
        </Routes>
    );
};

export { App };
export default App;
