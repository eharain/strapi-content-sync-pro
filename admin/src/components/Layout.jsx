import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { Box, Flex, Typography, Divider } from '@strapi/design-system';
import { ChevronRight } from '@strapi/icons';
import {
    groupedNav,
    resolvePath,
    buildBreadcrumbs,
    findTopBySegment,
    BASE_PATH,
} from '../nav';

// First URL segment after the plugin base — identifies the active top-level
// destination (''; 'sync'; 'configure'; …).
const firstSegment = (pathname) => {
    const rel = pathname.startsWith(BASE_PATH) ? pathname.slice(BASE_PATH.length) : pathname;
    return rel.split('/').filter(Boolean)[0] || '';
};

// A primary destination. Active state is driven by the URL segment (not by the
// link's own href) so "Configure" stays lit across all /configure/* children.
const PrimaryNavItem = ({ item, isActive }) => (
    <Link to={resolvePath(item.path)} style={{ textDecoration: 'none' }}>
        <Box
            paddingLeft={3}
            paddingRight={3}
            paddingTop={2}
            paddingBottom={2}
            hasRadius
            background={isActive ? 'primary100' : 'transparent'}
        >
            <Typography
                variant="omega"
                fontWeight={isActive ? 'bold' : 'regular'}
                textColor={isActive ? 'primary700' : 'neutral700'}
            >
                {item.label}
            </Typography>
        </Box>
    </Link>
);

// Secondary (in-section) navigation. Rendered only when the active section
// declares children — gives the URL real depth (/history/logs) without
// crowding the primary bar.
const SecondaryNav = ({ children }) => (
    <Flex gap={1} wrap="wrap">
        {children.map((child) => (
            <NavLink
                key={child.key}
                to={resolvePath(child.path)}
                end={child.end}
                style={{ textDecoration: 'none' }}
            >
                {({ isActive }) => (
                    <Box
                        paddingLeft={3}
                        paddingRight={3}
                        paddingTop={2}
                        paddingBottom={2}
                        hasRadius
                        background={isActive ? 'neutral150' : 'transparent'}
                    >
                        <Typography
                            variant="pi"
                            fontWeight={isActive ? 'bold' : 'regular'}
                            textColor={isActive ? 'neutral800' : 'neutral600'}
                        >
                            {child.label}
                        </Typography>
                    </Box>
                )}
            </NavLink>
        ))}
    </Flex>
);

const Breadcrumbs = ({ pathname }) => {
    const crumbs = buildBreadcrumbs(pathname);
    if (crumbs.length <= 1) return null;

    return (
        <Flex gap={1} alignItems="center" wrap="wrap">
            {crumbs.map((crumb, i) => {
                const isLast = i === crumbs.length - 1;
                return (
                    <Flex key={crumb.to} gap={1} alignItems="center">
                        {isLast ? (
                            <Typography variant="pi" textColor="neutral800" fontWeight="bold">
                                {crumb.label}
                            </Typography>
                        ) : (
                            <Link to={crumb.to} style={{ textDecoration: 'none' }}>
                                <Typography variant="pi" textColor="neutral600">
                                    {crumb.label}
                                </Typography>
                            </Link>
                        )}
                        {!isLast && (
                            <Box tag="span" aria-hidden paddingLeft={1} paddingRight={1}>
                                <ChevronRight width="0.6rem" height="0.6rem" fill="neutral400" />
                            </Box>
                        )}
                    </Flex>
                );
            })}
        </Flex>
    );
};

const Layout = () => {
    const { pathname } = useLocation();
    const seg = firstSegment(pathname);
    const activeTop = findTopBySegment(seg);
    const secondary = activeTop?.children;

    return (
        <Box background="neutral100" style={{ minHeight: '100%' }}>
            {/* Header band */}
            <Box paddingLeft={8} paddingRight={8} paddingTop={7} paddingBottom={5} background="neutral0">
                <Typography variant="alpha" tag="h1">
                    Content Sync Pro
                </Typography>
                <Box paddingTop={2} maxWidth="60rem">
                    <Typography variant="epsilon" textColor="neutral600" fontWeight="regular">
                        Copy, migrate, and keep content, media, users, and relations in sync across
                        environments — one-click bulk transfers, profile-driven bi-directional sync,
                        scheduling, live hooks, and alerts.
                    </Typography>
                </Box>

                {/* Grouped primary navigation */}
                <Box paddingTop={5}>
                    <Flex gap={6} wrap="wrap" alignItems="flex-start">
                        {groupedNav().map((group) => (
                            <Flex key={group.title} direction="column" alignItems="flex-start" gap={1}>
                                <Box paddingLeft={3}>
                                    <Typography variant="sigma" textColor="neutral500">
                                        {group.title}
                                    </Typography>
                                </Box>
                                <Flex gap={1} wrap="wrap">
                                    {group.items.map((item) => (
                                        <PrimaryNavItem
                                            key={item.key}
                                            item={item}
                                            isActive={
                                                item.path === ''
                                                    ? seg === ''
                                                    : (item.matchKey || item.path) === seg
                                            }
                                        />
                                    ))}
                                </Flex>
                            </Flex>
                        ))}
                    </Flex>
                </Box>
            </Box>

            <Divider />

            {/* Secondary nav (when the active section has children) */}
            {secondary && (
                <Box paddingLeft={8} paddingRight={8} paddingTop={4} background="neutral0">
                    <SecondaryNav children={secondary} />
                    <Box paddingTop={4}>
                        <Divider />
                    </Box>
                </Box>
            )}

            {/* Breadcrumbs */}
            <Box paddingLeft={8} paddingRight={8} paddingTop={4}>
                <Breadcrumbs pathname={pathname} />
            </Box>

            {/* Routed content */}
            <Box paddingLeft={8} paddingRight={8} paddingTop={5} paddingBottom={8}>
                <Outlet />
            </Box>

            {/* Footer */}
            <Divider />
            <Box paddingLeft={8} paddingRight={8} paddingTop={5} paddingBottom={7}>
                <Typography variant="pi" textColor="neutral500">
                    Content Sync Pro · Contact{' '}
                    <Typography variant="pi" textColor="primary600" tag="a" href="mailto:eharain@yahoo.com">
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
                        href="https://github.com/eharain/Rutba-ERP/"
                        target="_blank"
                        rel="noopener noreferrer"
                    >
                        Rutba ERP
                    </Typography>
                </Typography>
            </Box>
        </Box>
    );
};

export { Layout };
export default Layout;
