# Content Sync Pro Plugin for Strapi

<p align="center">
  <img src="https://raw.githubusercontent.com/eharain/strapi-content-sync-pro/master/docs/logo-horizontal.svg" alt="Content Sync Pro" width="720" />
</p>

A powerful Strapi v5 plugin to copy, migrate, and live-sync content, media, and data between multiple Strapi environments.

[![npm version](https://badge.fury.io/js/strapi-content-sync-pro.svg)](https://www.npmjs.com/package/strapi-content-sync-pro)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Product page](https://img.shields.io/badge/Product%20page-tech--style.co-0b7285.svg)](https://tech-style.co/products.html#content-sync)

Product page: **[tech-style.co/products.html#content-sync](https://tech-style.co/products.html#content-sync)** · Contact: **[hello@tech-style.co](mailto:hello@tech-style.co)**

## Video

Plugin intro: https://youtu.be/hr3dD6dLgLQ

<a href="https://youtu.be/hr3dD6dLgLQ" target="_blank" rel="noopener noreferrer">
  <img src="https://raw.githubusercontent.com/eharain/strapi-content-sync-pro/master/docs/01-home-hub.png" alt="Content Sync Pro — watch the intro video" width="100%" />
</a>

## Screenshots

<details>
  <summary>View screenshots</summary>

  <br />

  <table>
    <tr>
      <td width="33%"><img src="https://raw.githubusercontent.com/eharain/strapi-content-sync-pro/master/docs/01-home-hub.png" alt="Home — connection status and every section at a glance" width="100%" /><br /><sub><b>Home</b> — connection status and every section at a glance</sub></td>
      <td width="33%"><img src="https://raw.githubusercontent.com/eharain/strapi-content-sync-pro/master/docs/02-setup-connect.png" alt="Guided setup — connect to the remote server" width="100%" /><br /><sub><b>Setup 1/3</b> — connect to the remote server</sub></td>
      <td width="33%"><img src="https://raw.githubusercontent.com/eharain/strapi-content-sync-pro/master/docs/03-setup-scope.png" alt="Guided setup — choose what to sync" width="100%" /><br /><sub><b>Setup 2/3</b> — choose what to sync</sub></td>
    </tr>
    <tr>
      <td width="33%"><img src="https://raw.githubusercontent.com/eharain/strapi-content-sync-pro/master/docs/04-setup-run.png" alt="Guided setup — run your first sync" width="100%" /><br /><sub><b>Setup 3/3</b> — run your first sync</sub></td>
      <td width="33%"><img src="https://raw.githubusercontent.com/eharain/strapi-content-sync-pro/master/docs/05-configure-connection.png" alt="Connection — remote URL, API token, deployment mode" width="100%" /><br /><sub><b>Connection</b> — remote URL, API token, deployment mode</sub></td>
      <td width="33%"><img src="https://raw.githubusercontent.com/eharain/strapi-content-sync-pro/master/docs/06-configure-content-types.png" alt="Content types — toggle what is in scope" width="100%" /><br /><sub><b>Content types</b> — toggle what is in scope</sub></td>
    </tr>
    <tr>
      <td width="33%"><img src="https://raw.githubusercontent.com/eharain/strapi-content-sync-pro/master/docs/07-configure-profiles.png" alt="Sync profiles — direction, conflict strategy, field policies" width="100%" /><br /><sub><b>Sync profiles</b> — direction, conflict strategy, field policies</sub></td>
      <td width="33%"><img src="https://raw.githubusercontent.com/eharain/strapi-content-sync-pro/master/docs/08-configure-advanced.png" alt="Advanced — enforcement policies and alerts" width="100%" /><br /><sub><b>Advanced</b> — enforcement policies and alerts</sub></td>
      <td width="33%"><img src="https://raw.githubusercontent.com/eharain/strapi-content-sync-pro/master/docs/09-sync-run-profiles.png" alt="Run profiles — ordering, dependencies, per-profile execution" width="100%" /><br /><sub><b>Run profiles</b> — ordering, dependencies, execution mode</sub></td>
    </tr>
    <tr>
      <td width="33%"><img src="https://raw.githubusercontent.com/eharain/strapi-content-sync-pro/master/docs/10-sync-bulk-transfer.png" alt="Bulk transfer — chunked one-click transfer with progress" width="100%" /><br /><sub><b>Bulk transfer</b> — chunked one-click transfer with progress</sub></td>
      <td width="33%"><img src="https://raw.githubusercontent.com/eharain/strapi-content-sync-pro/master/docs/11-media.png" alt="Media — media sync profiles with live status and controls" width="100%" /><br /><sub><b>Media</b> — media sync profiles, live status and controls</sub></td>
      <td width="33%"><img src="https://raw.githubusercontent.com/eharain/strapi-content-sync-pro/master/docs/12-history-stats.png" alt="Stats — local vs remote counts and run reports" width="100%" /><br /><sub><b>Stats</b> — local vs remote counts and run reports</sub></td>
    </tr>
    <tr>
      <td width="33%"><img src="https://raw.githubusercontent.com/eharain/strapi-content-sync-pro/master/docs/13-history-logs.png" alt="Logs — searchable, filterable per-action sync log" width="100%" /><br /><sub><b>Logs</b> — searchable, filterable per-action sync log</sub></td>
      <td width="33%"><img src="https://raw.githubusercontent.com/eharain/strapi-content-sync-pro/master/docs/14-help.png" alt="Help — step-by-step guidance inside the admin panel" width="100%" /><br /><sub><b>Help</b> — step-by-step guidance inside the admin panel</sub></td>
      <td width="33%"></td>
    </tr>
  </table>
</details>

## Admin UI Navigation

The plugin mounts at `/admin/plugins/strapi-content-sync-pro`. Navigation is
two-tier: a grouped primary bar, plus a secondary bar inside sections that have
one. Every screen is a real, shareable URL.

<p align="center">
  <img src="https://raw.githubusercontent.com/eharain/strapi-content-sync-pro/master/docs/01-home-hub.png" alt="Home hub with grouped navigation" width="100%" />
</p>

| Group | Destination | Path | What it's for |
|-------|-------------|------|---------------|
| Start | **Home** | `/` | Connection status and entry points to every section |
| Start | **Setup** | `/setup/connect`, `/setup/scope`, `/setup/run` | Guided first run: connect, choose scope, run your first sync |
| Run | **Sync** | `/sync` · `/sync/bulk` | Run profiles · Bulk transfer |
| Run | **Media** | `/media` | Media sync profiles, live status and controls |
| Set up | **Configure** | `/configure/connection` · `/configure/content-types` · `/configure/profiles` · `/configure/advanced` | Connection · Content types · Sync profiles · Enforcement and alerts |
| Monitor | **History** | `/history/stats` · `/history/logs` | Stats and run reports · Detailed logs |
| Monitor | **Help** | `/help` | Step-by-step guidance inside the admin panel |

Old flat paths (`/config`, `/content-types`, `/sync-profiles`, `/bulk-transfer`,
`/stats`, `/logs`) still resolve — they redirect to their new homes.

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
- **Bulk Transfer** - One-click full pull or full push across selectable scopes (content, media, Strapi users, admin users), under **Sync → Bulk transfer**. Expands into per-content-type and per-media-profile chunks with page-level progress, selectable chunks, optional deletion sync, and auto-continue or manual chunk-by-chunk stepping.
- **Pause / Resume / Cancel & Persisted History** - Bulk Transfer jobs can be paused after the current page (cursor, page number, and counters preserved), cancelled without losing progress, and resumed later from the exact saved state. Every run is stored in a persistent history so you can inspect per-chunk results and **restart** or **resume** any previous run — even after a Strapi restart.
- **Retention Controls** - Manual clear and automatic retention limits for logs and run reports.
- **Secure Communication** - API token authentication combined with HMAC-SHA256 request signing using a shared secret.
- **Guided Setup & In-App Help** - A three-step first-run wizard (connect → scope → run) and a Help section documenting every screen, both reachable from the Home hub.

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

1. Navigate to **Content Sync Pro** in the admin sidebar
2. Go to **Configure → Connection**
3. Enter your remote server details:
   - **Server URL**: The remote Strapi instance root (e.g., `https://api.example.com`) — not `/admin` or `/api`
   - **API Token**: Generate from the remote Strapi's Settings → API Tokens
   - **Instance Name**: Unique identifier for this instance
   - **Shared Secret**: Same secret on both instances for HMAC signing
   - **Sync Mode**: Paired or Single-side (see [Deployment Modes](#deployment-modes))

<p align="center">
  <img src="https://raw.githubusercontent.com/eharain/strapi-content-sync-pro/master/docs/05-configure-connection.png" alt="Configure → Connection" width="100%" />
</p>

## Quick Start

New installs can follow the guided **Setup** wizard, which walks the same three
steps below as deep-linkable URLs and hands off to the full screens afterwards.

### Step 1: Choose Deployment Mode and Configure Connection
In **Configure → Connection** (or **Setup → Connect**), choose one mode:
- **Paired**: install and enable plugin on both local and remote servers.
- **Single-side**: install plugin only on local server (remote plugin routes not required).

Then configure Server URL, API Token, Instance Name, and Shared Secret, and press
**Test Connection** before saving.

<p align="center">
  <img src="https://raw.githubusercontent.com/eharain/strapi-content-sync-pro/master/docs/02-setup-connect.png" alt="Setup step 1 — connect to the remote server" width="100%" />
</p>

### Step 2: Enable Content Types
In **Configure → Content types** (or **Setup → Choose scope**), toggle on the content types you want to sync. Default profiles (Full Push, Full Pull, Bidirectional) are auto-generated per type.

<p align="center">
  <img src="https://raw.githubusercontent.com/eharain/strapi-content-sync-pro/master/docs/06-configure-content-types.png" alt="Configure → Content types" width="100%" />
</p>

### Step 3: Align Sync Settings on Both Servers
In **Configure → Content types**, enable matching content types on both servers.
In **Configure → Sync profiles**, set compatible direction/conflict strategy and activate the profile you want to run.
Then in **Sync → Run profiles**, configure execution mode and global page size.

<p align="center">
  <img src="https://raw.githubusercontent.com/eharain/strapi-content-sync-pro/master/docs/07-configure-profiles.png" alt="Configure → Sync profiles" width="100%" />
</p>

### Step 4: Run Sync
In **Sync → Run profiles** (or **Setup → Run**), click **Sync All Active** or run individual profiles with **Run Now**. Profiles execute in the listed order, and the dependency badges show how many types each one depends on.

<p align="center">
  <img src="https://raw.githubusercontent.com/eharain/strapi-content-sync-pro/master/docs/09-sync-run-profiles.png" alt="Sync → Run profiles" width="100%" />
</p>

## Bulk Transfer

**Sync → Bulk transfer** is a one-click full pull or full push across selected
scopes, for first-time seeding and large migrations where per-profile runs are
too granular.

Pick a **Direction** and **Conflict Strategy**, tick the **Scope** (user-generated
content, media, Strapi users, admin users), then review the generated plan before
starting. The transfer expands into chunks — one content type or media profile
per chunk, split into entity and relation passes — which you can select
individually, step through manually, or let auto-continue. Runs can be paused
after the current page, cancelled, and resumed later from the exact saved cursor;
**Previous Runs** keeps a persistent history you can inspect, restart, or resume
even after a Strapi restart.

<p align="center">
  <img src="https://raw.githubusercontent.com/eharain/strapi-content-sync-pro/master/docs/10-sync-bulk-transfer.png" alt="Sync → Bulk transfer" width="100%" />
</p>

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
- Media links (entity → file) are derived from the remote's standard content REST
  API, so the API token needs `find` on every content type that owns media
  fields, not just on Upload.

## Execution Modes

Configure **when** sync runs in **Sync → Run profiles**, per profile via the gear icon:

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

Full media synchronization between Strapi instances, managed from the **Media**
tab:

<p align="center">
  <img src="https://raw.githubusercontent.com/eharain/strapi-content-sync-pro/master/docs/11-media.png" alt="Media sync profiles" width="100%" />
</p>

- **URL Strategy** (HTTP) — Works with any upload provider (local, S3, Cloudinary). Downloads and re-uploads via the Upload API.
- **rsync Strategy** — Host-level file copy using the `rsync` binary. Fastest for local-provider setups with SSH access.
- **Profile-based** — Create media sync profiles with direction, conflict strategy, MIME filters, filename patterns, and execution settings.
- **DB + File Sync** — Syncs both the `plugin::upload.file` database rows and the actual file bytes.
- **Entity → File Links** — Media links are written from the **owning** content type's media fields, in one direction, with set semantics: removing an image at the source removes it at the target. Files are matched by `documentId`, falling back to name + extension + size, because a URL-synced file is re-uploaded on the target and gets a fresh `documentId`. A field whose source list is non-empty but resolves to no local file is left untouched rather than cleared — that means the files have not been pulled yet, not that the link was removed.
  - In **paired** mode the links come from the peer's `media-sync/entity-media-links` endpoint (or `media-sync/morph-links` if the peer runs an older version).
  - In **single-side** mode the peer serves neither, so links are derived from its standard content REST API (`/api/<plural>?populate=<media fields>`). This requires the API token to have `find` on every content type that owns media fields.
- **Live Status + Pause/Resume/Stop** — The Media tab polls status every 2 s while a profile is running or paused and shows live phase and counters (`pushed`, `pulled`, `skipped`, `errors`). Long runs can be paused, resumed, or stopped cooperatively from the UI or via `POST /api/strapi-content-sync-pro/media-sync/profiles/:id/pause|resume|cancel` (URL strategy; rsync runs cannot be paused mid-process).

## Enforcement

Pre-sync validation (**Configure → Advanced → Enforcement**):

- **Schema Match** - Verify content type schemas match (strict/compatible/none)
- **Version Check** - Verify Strapi versions (exact/minor/major/none)
- **DateTime Sync** - Verify server clocks are synchronized

## Alerts

Get notified of sync events (**Configure → Advanced → Alerts**):

- **Strapi Logs** - Logs to sync log and server console
- **Email** - Requires Strapi email plugin configured
- **Webhook** - POST to any HTTP endpoint

<p align="center">
  <img src="https://raw.githubusercontent.com/eharain/strapi-content-sync-pro/master/docs/08-configure-advanced.png" alt="Configure → Advanced — enforcement and alerts" width="100%" />
</p>

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

**History → Stats** is split into two sub-tabs:

<p align="center">
  <img src="https://raw.githubusercontent.com/eharain/strapi-content-sync-pro/master/docs/12-history-stats.png" alt="History → Stats" width="100%" />
</p>

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
| "Remote server not configured" | Add Server URL and API Token in **Configure → Connection** |
| "401 Unauthorized / 403 Forbidden" | Regenerate API token and verify required permissions for synced content types (and Upload permissions for media) |
| "HMAC verification failed" | Ensure shared secret matches on both instances in paired mode |
| "Content type endpoint not found" | In paired mode, ensure matching content-type definitions and enabled API routes on both instances |
| "Live mode not available" | Switch to paired mode, or use on-demand/scheduled in single-side mode |
| "Schema mismatch" | Sync content type schemas or set enforcement to "compatible" |
| Files pull but stay unlinked (`mediaLinksApplied: 0`) | Grant the API token `find` on every content type that owns media fields — in single-side mode links are read from the remote's content REST API, not from a plugin route. Before 1.1.1 this failed unconditionally in single-side mode; upgrade. |
| "Remote morph-links fetch failed (404)" | The remote does not run this plugin. Fixed in 1.1.1, which falls back to the remote's content REST API. On older versions, install the plugin on both instances (paired mode). |

### Viewing Logs

Check **History → Logs** for detailed sync history including:
- Timestamp and duration
- Content type and record ID
- Direction (push/pull)
- Status and error messages

Search by action, content type or message, and filter by status to isolate a
failing run.

<p align="center">
  <img src="https://raw.githubusercontent.com/eharain/strapi-content-sync-pro/master/docs/13-history-logs.png" alt="History → Logs" width="100%" />
</p>

In-app documentation for every screen is available under **Help**.

<p align="center">
  <img src="https://raw.githubusercontent.com/eharain/strapi-content-sync-pro/master/docs/14-help.png" alt="Help tab" width="100%" />
</p>

## Security & Privacy

- **No usage tracking.** This plugin does not collect, transmit, or store any analytics or telemetry data.
- **Credential handling.** The optional "Generate Token" feature lets you authenticate to **your own** remote Strapi server to create an API token. Credentials are sent directly from your browser to your server via the plugin's backend proxy, used once, and **never stored** on disk, in the database, or in memory after the request completes.
- **API Tokens** are encrypted at rest using Strapi's built-in store.
- **HMAC-SHA256** signatures protect all inter-instance requests from tampering.
- **Masked secrets** — API tokens and shared secrets are masked (`••••••••`) in all API responses.

## Contributing

Contributions are welcome! Please open an issue or submit a pull request. 


## Support

- Product page: [tech-style.co/products.html#content-sync](https://tech-style.co/products.html#content-sync)
- Email: [hello@tech-style.co](mailto:hello@tech-style.co)
- Contact form: [tech-style.co/contact.html](https://tech-style.co/contact.html)
- Bugs & feature requests: [GitHub Issues](https://github.com/eharain/strapi-content-sync-pro/issues)

## License

MIT License - see [LICENSE](LICENSE) for details.

## Author

**Ejaz Husain Arain** — [Tech Style Ltd](https://tech-style.co/)
- Website: [tech-style.co](https://tech-style.co/)
- Email: [hello@tech-style.co](mailto:hello@tech-style.co)
- GitHub: [@eharain](https://github.com/eharain)
- LinkedIn: [Ejaz Husain Arain](https://www.linkedin.com/in/eharain/)

<sub>Tech Style Ltd · Registered in England &amp; Wales · Company No. 11101491</sub>
