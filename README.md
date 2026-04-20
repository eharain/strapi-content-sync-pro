# Content Sync Pro Plugin for Strapi

A powerful Strapi v5 plugin to copy, migrate, and live-sync content, media, and data between multiple Strapi environments.

[![npm version](https://badge.fury.io/js/strapi-content-sync-pro.svg)](https://www.npmjs.com/package/strapi-content-sync-pro)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Video

Plugin intro: https://youtu.be/hr3dD6dLgLQ

<a href="https://youtu.be/hr3dD6dLgLQ" target="_blank" rel="noopener noreferrer">
  <img src="docs/Screenshot%202026-04-20%20160506.png" alt="Content Sync Pro — watch the intro video" width="100%" />
</a>

## Screenshots

<details>
  <summary>View screenshots</summary>

  <br />

  <table>
    <tr>
      <td width="33%"><img src="docs/Screenshot%202026-04-20%20160506.png" alt="Content Sync Pro - screenshot 1" width="100%" /></td>
      <td width="33%"><img src="docs/Screenshot%202026-04-20%20160558.png" alt="Content Sync Pro - screenshot 2" width="100%" /></td>
      <td width="33%"><img src="docs/Screenshot%202026-04-20%20175903.png" alt="Content Sync Pro - screenshot 3" width="100%" /></td>
    </tr>
    <tr>
      <td width="33%"><img src="docs/Screenshot%202026-04-20%20175931.png" alt="Content Sync Pro - screenshot 4" width="100%" /></td>
      <td width="33%"><img src="docs/Screenshot%202026-04-20%20180001.png" alt="Content Sync Pro - screenshot 5" width="100%" /></td>
      <td width="33%"><img src="docs/Screenshot%202026-04-20%20180041.png" alt="Content Sync Pro - screenshot 6" width="100%" /></td>
    </tr>
    <tr>
      <td width="33%"><img src="docs/Screenshot%202026-04-20%20180116.png" alt="Content Sync Pro - screenshot 7" width="100%" /></td>
      <td width="33%"><img src="docs/Screenshot%202026-04-20%20180135.png" alt="Content Sync Pro - screenshot 8" width="100%" /></td>
      <td width="33%"><img src="docs/Screenshot%202026-04-20%20180202.png" alt="Content Sync Pro - screenshot 9" width="100%" /></td>
    </tr>
    <tr>
      <td width="33%"><img src="docs/Screenshot%202026-04-20%20180228.png" alt="Content Sync Pro - screenshot 10" width="100%" /></td>
      <td width="33%"><img src="docs/Screenshot%202026-04-20%20180251.png" alt="Content Sync Pro - screenshot 11" width="100%" /></td>
      <td width="33%"><img src="docs/Screenshot%202026-04-20%20180301.png" alt="Content Sync Pro - screenshot 12" width="100%" /></td>
    </tr>
  </table>
</details>

## Features

- **Bi-directional Content Sync** - Push, pull, or sync both ways (Local wins, Remote wins, or Latest wins).
- **Media Sync** - Full media synchronization via HTTP (URL-based) or host-level file copy (`rsync`). Includes MIME type filtering and concurrency controls.
- **Sync Profiles** - Define WHAT to sync with field-level control (Advanced mode) or preset modes.
- **Execution Modes** - On-demand, Scheduled (interval, timeout, cron, or external scheduler), or Live (real-time) sync.
- **Pagination & Large Dataset Support** - Built-in pagination ensures stable memory usage even when syncing thousands of records.
- **Dependency Analytics** - Automatically detects and syncs related entities and components in the correct order.
- **Enforcement Checks** - Pre-sync schema compatibility validation, version checks, and server time drift checks.
- **Alerts & Logging** - Detailed sync logs. Receive success/failure alerts via Email (using Strapi's email provider) or Webhooks.
- **Secure Communication** - API token authentication combined with HMAC-SHA256 request signing using a shared secret.

## Installation

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
   - **API Token**: Generate from remote Strapi's Settings → API Tokens
   - **Instance ID**: Unique identifier for this instance
   - **Shared Secret**: Same secret on both instances for HMAC signing

## Quick Start

### Step 1: Configure Connection
In the **Configuration** tab, set up the remote server connection.

### Step 2: Enable Content Types
In the **Content Types** tab, toggle on the content types you want to sync. Default profiles are auto-generated.

### Step 3: Run Sync
In the **Sync** tab, click "Sync All Active Profiles" or run individual profiles.

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

## Troubleshooting

### Common Issues

| Error | Solution |
|-------|----------|
| "Remote server not configured" | Add Base URL and API Token in Configuration |
| "401 Unauthorized" | Regenerate API token on remote server |
| "HMAC verification failed" | Ensure shared secret matches on both instances |
| "Schema mismatch" | Sync content type schemas or set enforcement to "compatible" |

### Viewing Logs

Check the **Logs** tab for detailed sync history including:
- Timestamp and duration
- Content type and record ID
- Direction (push/pull)
- Status and error messages

## Contributing

Contributions are welcome! Please open an issue or submit a pull request.

## License

MIT License - see [LICENSE](LICENSE) for details.

## Author

**Ejaz Husain Arain**
- GitHub: [@eharain](https://github.com/eharain)
- Email: eharain@yahoo.com