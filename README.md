# Content Sync Pro Plugin for Strapi

<p align="center">
  <img src="https://raw.githubusercontent.com/eharain/strapi-content-sync-pro/master/docs/logo-horizontal.svg" alt="Content Sync Pro" width="720" />
</p>

A powerful Strapi v5 plugin to copy, migrate, and live-sync content, media, and data between multiple Strapi environments.

[![npm version](https://badge.fury.io/js/strapi-content-sync-pro.svg)](https://www.npmjs.com/package/strapi-content-sync-pro)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Video

Plugin intro: https://youtu.be/hr3dD6dLgLQ

<a href="https://youtu.be/hr3dD6dLgLQ" target="_blank" rel="noopener noreferrer">
  <img src="https://raw.githubusercontent.com/eharain/strapi-content-sync-pro/master/docs/Screenshot%202026-04-20%20160506.png" alt="Content Sync Pro — watch the intro video" width="100%" />
</a>

## Screenshots

<details>
  <summary>View screenshots</summary>

  <br />

  <table>
    <tr>
      <td width="33%"><img src="https://raw.githubusercontent.com/eharain/strapi-content-sync-pro/master/docs/Screenshot%202026-04-20%20160506.png" alt="Content Sync Pro - screenshot 1" width="100%" /></td>
      <td width="33%"><img src="https://raw.githubusercontent.com/eharain/strapi-content-sync-pro/master/docs/Screenshot%202026-04-20%20160558.png" alt="Content Sync Pro - screenshot 2" width="100%" /></td>
      <td width="33%"><img src="https://raw.githubusercontent.com/eharain/strapi-content-sync-pro/master/docs/Screenshot%202026-04-20%20175903.png" alt="Content Sync Pro - screenshot 3" width="100%" /></td>
    </tr>
    <tr>
      <td width="33%"><img src="https://raw.githubusercontent.com/eharain/strapi-content-sync-pro/master/docs/Screenshot%202026-04-20%20175931.png" alt="Content Sync Pro - screenshot 4" width="100%" /></td>
      <td width="33%"><img src="https://raw.githubusercontent.com/eharain/strapi-content-sync-pro/master/docs/Screenshot%202026-04-20%20180001.png" alt="Content Sync Pro - screenshot 5" width="100%" /></td>
      <td width="33%"><img src="https://raw.githubusercontent.com/eharain/strapi-content-sync-pro/master/docs/Screenshot%202026-04-20%20180041.png" alt="Content Sync Pro - screenshot 6" width="100%" /></td>
    </tr>
    <tr>
      <td width="33%"><img src="https://raw.githubusercontent.com/eharain/strapi-content-sync-pro/master/docs/Screenshot%202026-04-20%20180116.png" alt="Content Sync Pro - screenshot 7" width="100%" /></td>
      <td width="33%"><img src="https://raw.githubusercontent.com/eharain/strapi-content-sync-pro/master/docs/Screenshot%202026-04-20%20180135.png" alt="Content Sync Pro - screenshot 8" width="100%" /></td>
      <td width="33%"><img src="https://raw.githubusercontent.com/eharain/strapi-content-sync-pro/master/docs/Screenshot%202026-04-20%20180202.png" alt="Content Sync Pro - screenshot 9" width="100%" /></td>
    </tr>
    <tr>
      <td width="33%"><img src="https://raw.githubusercontent.com/eharain/strapi-content-sync-pro/master/docs/Screenshot%202026-04-20%20180228.png" alt="Content Sync Pro - screenshot 10" width="100%" /></td>
      <td width="33%"><img src="https://raw.githubusercontent.com/eharain/strapi-content-sync-pro/master/docs/Screenshot%202026-04-20%20180251.png" alt="Content Sync Pro - screenshot 11" width="100%" /></td>
      <td width="33%"><img src="https://raw.githubusercontent.com/eharain/strapi-content-sync-pro/master/docs/Screenshot%202026-04-20%20180301.png" alt="Content Sync Pro - screenshot 12" width="100%" /></td>
    </tr>
  </table>
</details>

## Features

- **Deployment Modes** - Paired mode (plugin on both servers) or Single-side mode (plugin only on local server).
- **Bi-directional Content Sync** - Push, pull, or sync both ways (Local wins, Remote wins, or Latest wins) in paired mode.
- **Media Sync** - Full media synchronization via HTTP (URL-based) or host-level file copy (`rsync`). Includes MIME type filtering and concurrency controls.
- **Sync Profiles** - Define WHAT to sync with field-level control (Advanced mode) or preset modes.
- **Execution Modes** - On-demand, Scheduled (interval, timeout, cron, or external scheduler), Live (real-time), with per-profile execution controls.
- **Pagination & Large Dataset Support** - Built-in pagination ensures stable memory usage even when syncing thousands of records.
- **Dependency Analytics** - Automatically detects and syncs related entities and components in the correct order.
- **Enforcement Checks** - Pre-sync schema compatibility validation, version checks, and server time drift checks.
- **Alerts & Logging** - Detailed sync logs. Receive success/failure alerts via Email (using Strapi's email provider) or Webhooks.
- **Stats & Run Reports** - Local/remote counts and newest timestamps per content type, with before/after snapshots for each sync run.
- **Bulk Transfer** - Dedicated top-level tab for one-click full pull or full push across selectable scopes (content, media, Strapi users, admin users). Expands into per-content-type and per-media-profile chunks with page-level progress, selectable chunks, optional deletion sync, and auto-continue or manual chunk-by-chunk stepping.
- **Pause / Resume / Cancel & Persisted History** - Bulk Transfer jobs can be paused after the current page (cursor, page number, and counters preserved), cancelled without losing progress, and resumed later from the exact saved state. Every run is stored in a persistent history so you can inspect per-chunk results and **restart** or **resume** any previous run — even after a Strapi restart.
- **Retention Controls** - Manual clear and automatic retention limits for logs and run reports.
- **Secure Communication** - API token authentication combined with HMAC-SHA256 request signing using a shared secret.

## Prerequisites

- Strapi v5.0.0 or higher
- Node.js 20.0.0 or higher

## Installation

```bash
npm install strapi-content-sync-pro
```

Or with yarn:

```bash
yarn add strapi-content-sync-pro
```

## Configuration

### 1. Enable the plugin

Add to your `config/plugins.js` (or `config/plugins.ts`):

```javascript
module.exports = {
  'strapi-content-sync-pro': {
    enabled: true,
  },
};
```

### 2. Rebuild Strapi

```bash
npm run build
npm run develop
```

### 3. Configure via Admin UI

1. Navigate to **Content Sync Pro Plugin** in the admin sidebar
2. Go to **Configuration** tab
3. Enter your remote server details:
   - **Base URL**: The remote Strapi instance URL (e.g., `https://api.example.com`)
   - **API Token**: Generate from remote Strapi's Settings ? API Tokens
   - **Instance ID**: Unique identifier for this instance
   - **Shared Secret**: Same secret on both instances for HMAC signing

## Quick Start

### Step 1: Choose Deployment Mode and Configure Connection
In **Configuration**, choose one mode:
- **Paired**: install and enable plugin on both local and remote servers.
- **Single-side**: install plugin only on local server (remote plugin routes not required).

Then configure Base URL, API Token, Instance ID, and Shared Secret.

### Step 2: Enable Content Types
In the **Content Types** tab, toggle on the content types you want to sync. Default profiles are auto-generated.

### Step 3: Align Sync Settings on Both Servers
In **Content Types**, enable matching content types on both servers.
In **Sync Profiles**, set compatible direction/conflict strategy.
Then in **Sync**, configure execution mode and global page size.

### Step 4: Run Sync
In the **Sync** tab, click **Sync All Active Profiles** or run individual profiles.

## Sync Profiles

Sync Profiles define **what** to sync and **how** conflicts are resolved.

### Simple Mode (Presets)
- **Full Push** - Push all data to remote, local wins
- **Full Pull** - Pull all data from remote, remote wins  
- **Bidirectional** - Two-way sync, latest wins

### Advanced Mode
Configure individual field policies:
- **Both** - Field syncs both directions
- **Push** - Field only pushes to remote
- **Pull** - Field only pulls from remote
- **Exclude** - Field is never synced

## Deployment Modes

### Paired mode
- Plugin installed on both local and remote servers.
- Supports push, pull, and bidirectional profiles.
- Supports on-demand, scheduled, and live execution modes.
- Connection test validates remote plugin endpoints.

### Single-side mode
- Plugin installed on local server only.
- Pull-only profiles are enforced.
- Live execution is disabled (use on-demand or scheduled).
- Connection test validates remote reachability and API token access without requiring remote plugin routes.

## Execution Modes

Configure **when** sync runs in the Sync tab:

| Mode | Description |
|------|-------------|
| **On Demand** | Manual trigger only |
| **Scheduled** | Interval, Timeout, Cron expression, or External scheduler |
| **Live** | Real-time sync on content changes via lifecycle hooks |

### Scheduled Sync Types

| Type | Description |
|------|-------------|
| **Interval** (`setInterval`) | Fires every N minutes. Simple but can overlap. |
| **Timeout** (chained `setTimeout`) | Waits for the previous run to finish. No overlap. |
| **Cron** (wall-clock) | Standard cron expression via `strapi.cron`. Recommended for production. |
| **External** | No in-process timer. Use system cron, Kubernetes CronJob, GitHub Actions, etc. |

## Media Sync

Full media synchronization between Strapi instances:

- **URL Strategy** (HTTP) — Works with any upload provider (local, S3, Cloudinary). Downloads and re-uploads via the Upload API.
- **rsync Strategy** — Host-level file copy using the `rsync` binary. Fastest for local-provider setups with SSH access.
- **Profile-based** — Create media sync profiles with direction, conflict strategy, MIME filters, filename patterns, and execution settings.
- **DB + File Sync** — Syncs both the `plugin::upload.file` database rows and the actual file bytes.
- **Morph Link Remapping** — Syncs `files_related_morphs` links by mapping file + related entities through documentId, then remapping to local numeric ids before insert.

## Enforcement

Pre-sync validation (Configuration → Enforcement):

- **Schema Match** - Verify content type schemas match (strict/compatible/none)
- **Version Check** - Verify Strapi versions (exact/minor/major/none)
- **DateTime Sync** - Verify server clocks are synchronized

## Alerts

Get notified of sync events (Configuration → Alerts):

- **Strapi Logs** - Logs to sync log and server console
- **Email** - Requires Strapi email plugin configured
- **Webhook** - POST to any HTTP endpoint

## API Endpoints

### Admin Routes (authenticated)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/strapi-content-sync-pro/config` | Get connection config |
| `POST` | `/strapi-content-sync-pro/config` | Update connection config |
| `POST` | `/strapi-content-sync-pro/sync-now` | Trigger manual sync |
| `GET` | `/strapi-content-sync-pro/sync-profiles` | List sync profiles |
| `GET` | `/strapi-content-sync-pro/logs` | View sync logs |

### Public Routes (HMAC signed)

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/strapi-content-sync-pro/receive` | Receive data from remote |

## Security

- **API Tokens**: Use Strapi's built-in API token system
- **HMAC-SHA256**: All inter-instance requests are signed
- **Masked Secrets**: Sensitive data is masked in API responses

## Example: E-commerce Sync

Sync products from a central catalog to multiple storefronts:

1. **Central Catalog** (source):
   - Create "Full Push" profile for `api::product.product`
   - Set execution mode to "Live"

2. **Storefront** (target):
   - Create "Full Pull" profile for `api::product.product`
   - Set execution mode to "Scheduled" (every 5 minutes)

## Stats & Data Management

The **Stats** tab is split into two sub-tabs:

**Current Snapshot** — live local vs remote state per content type:
- Local vs remote record count
- Media files and media morph stats (local, plus remote where available)
- Newest record timestamp on each side and which side is newest (local, remote, equal)
- Search by UID, filter by type (content / media / media morph) or newest side, and paginate large result sets

**Run Reports** — before/after snapshots captured for each sync run:
- Filter by status (all / success / failed) and paginate server-side
- Expand any report to see the before and after row tables

A top action row (shared by both sub-tabs) provides:
- **Refresh Stats**, **Clear Logs**, **Clear Stats Reports**
- **Max Logs** / **Max Reports** retention limits with **Save & Apply Retention** (also enforced automatically after each sync run)

## Troubleshooting

### Common Issues

| Error | Solution |
|-------|----------|
| "Remote server not configured" | Add Base URL and API Token in Configuration |
| "401 Unauthorized / 403 Forbidden" | Regenerate API token and verify required permissions for synced content types (and Upload permissions for media) |
| "HMAC verification failed" | Ensure shared secret matches on both instances in paired mode |
| "Content type endpoint not found" | In paired mode, ensure matching content-type definitions and enabled API routes on both instances |
| "Live mode not available" | Switch to paired mode, or use on-demand/scheduled in single-side mode |
| "Schema mismatch" | Sync content type schemas or set enforcement to "compatible" |

### Viewing Logs

Check the **Logs** tab for detailed sync history including:
- Timestamp and duration
- Content type and record ID
- Direction (push/pull)
- Status and error messages

## Security & Privacy

- **No usage tracking.** This plugin does not collect, transmit, or store any analytics or telemetry data.
- **Credential handling.** The optional "Generate Token" feature lets you authenticate to **your own** remote Strapi server to create an API token. Credentials are sent directly from your browser to your server via the plugin's backend proxy, used once, and **never stored** on disk, in the database, or in memory after the request completes.
- **API Tokens** are encrypted at rest using Strapi's built-in store.
- **HMAC-SHA256** signatures protect all inter-instance requests from tampering.
- **Masked secrets** — API tokens and shared secrets are masked (`••••••••`) in all API responses.

## Contributing

Contributions are welcome! Please open an issue or submit a pull request.

## License

MIT License - see [LICENSE](LICENSE) for details.

## Author

**Ejaz Husain Arain**
- GitHub: [@eharain](https://github.com/eharain)
- Email: eharain@yahoo.com
