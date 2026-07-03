import pluginId from './pluginId';

// Base path where Strapi mounts this plugin's admin app.
export const BASE_PATH = `/plugins/${pluginId}`;

// Build an absolute admin URL for a route path (relative to the plugin base).
// resolvePath('') -> BASE_PATH ; resolvePath('sync') -> BASE_PATH/sync
export const resolvePath = (p) => (p ? `${BASE_PATH}/${p}` : BASE_PATH);

// Two-tier information architecture and single source of truth for routing,
// primary navigation, secondary (in-section) navigation, and breadcrumbs.
//
// Each top-level destination may declare `children` — rendered as a secondary
// nav inside that section, giving depth to the URL (e.g. /history/logs) without
// crowding the primary nav.
//
//   path       : route path relative to BASE_PATH ('' is the Home index)
//   matchKey   : first URL segment that marks this destination active
//   end        : exact-match only (Home + section index children)
export const NAV = [
    {
        key: 'home',
        path: '',
        label: 'Home',
        group: 'Start',
        end: true,
        description: 'Overview, connection status, and what to do next.',
    },
    {
        key: 'setup',
        path: 'setup',
        matchKey: 'setup',
        label: 'Setup',
        group: 'Start',
        description: 'Guided first-run: connect, choose scope, run your first sync.',
    },
    {
        key: 'sync',
        path: 'sync',
        matchKey: 'sync',
        label: 'Sync',
        group: 'Run',
        description: 'Run profile-based sync, or do a one-click bulk transfer.',
        children: [
            { key: 'sync-run', path: 'sync', label: 'Run profiles', end: true },
            { key: 'sync-bulk', path: 'sync/bulk', label: 'Bulk transfer' },
        ],
    },
    {
        key: 'configure',
        path: 'configure/connection',
        matchKey: 'configure',
        label: 'Configure',
        group: 'Set up',
        description: 'Connection, scope, and sync profiles.',
        children: [
            { key: 'cfg-connection', path: 'configure/connection', label: 'Connection' },
            { key: 'cfg-content-types', path: 'configure/content-types', label: 'Content types' },
            { key: 'cfg-profiles', path: 'configure/profiles', label: 'Sync profiles' },
            { key: 'cfg-advanced', path: 'configure/advanced', label: 'Advanced' },
        ],
    },
    {
        key: 'media',
        path: 'media',
        matchKey: 'media',
        label: 'Media',
        group: 'Run',
        description: 'Media sync profiles with live status and controls.',
    },
    {
        key: 'history',
        path: 'history/stats',
        matchKey: 'history',
        label: 'History',
        group: 'Monitor',
        description: 'Local vs remote stats, run reports, and detailed logs.',
        children: [
            { key: 'hist-stats', path: 'history/stats', label: 'Stats' },
            { key: 'hist-logs', path: 'history/logs', label: 'Logs' },
        ],
    },
    {
        key: 'help',
        path: 'help',
        matchKey: 'help',
        label: 'Help',
        group: 'Monitor',
        description: 'Documentation and step-by-step guidance.',
    },
];

// Ordered groups for the primary navigation and Home hub cards.
export const GROUP_ORDER = ['Start', 'Run', 'Set up', 'Monitor'];

export const groupedNav = () =>
    GROUP_ORDER.map((title) => ({
        title,
        items: NAV.filter((n) => n.group === title),
    })).filter((g) => g.items.length > 0);

// Find the active top-level destination for a given first URL segment.
export const findTopBySegment = (segment) =>
    NAV.find((n) => (n.matchKey || (n.path === '' ? '' : n.path)) === segment);

// Human-readable labels for deeper, dynamic segments that aren't nav items.
const SEGMENT_LABELS = {
    setup: 'Setup',
    sync: 'Sync',
    bulk: 'Bulk transfer',
    configure: 'Configure',
    connection: 'Connection',
    'content-types': 'Content types',
    profiles: 'Sync profiles',
    advanced: 'Advanced',
    media: 'Media',
    history: 'History',
    stats: 'Stats',
    logs: 'Logs',
    help: 'Help',
    run: 'Run',
    connect: 'Connect',
    scope: 'Scope',
};

const labelForSegment = (seg) =>
    SEGMENT_LABELS[seg] || (seg.length > 12 ? `${seg.slice(0, 8)}…` : seg);

// Turn a location pathname into a breadcrumb trail:
// [{ label, to }] where the last entry is the current page (no link).
export const buildBreadcrumbs = (pathname) => {
    const rel = pathname.startsWith(BASE_PATH)
        ? pathname.slice(BASE_PATH.length)
        : pathname;
    const segments = rel.split('/').filter(Boolean);

    const crumbs = [{ label: 'Home', to: BASE_PATH }];
    let acc = BASE_PATH;
    segments.forEach((seg) => {
        acc += `/${seg}`;
        crumbs.push({ label: labelForSegment(seg), to: acc });
    });
    return crumbs;
};
