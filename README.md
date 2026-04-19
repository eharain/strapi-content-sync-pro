# Strapi-to-Strapi Data Sync Plugin

A powerful Strapi v5 plugin for synchronizing data between Strapi instances with bi-directional sync, field-level policies, scheduling, and alerts.

[![npm version](https://badge.fury.io/js/strapi-to-strapi-data-sync.svg)](https://www.npmjs.com/package/strapi-to-strapi-data-sync)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Features

- **Bi-directional Sync** - Push, pull, or sync both ways
- **Sync Profiles** - Define WHAT to sync with field-level control
- **Execution Modes** - On-demand, scheduled, or live (real-time) sync
- **Conflict Resolution** - Latest wins, local wins, or remote wins strategies
- **Dependency Syncing** - Automatically sync related entities
- **Enforcement Checks** - Schema validation, version checks, time sync
- **Alerts** - Email (via Strapi email plugin), webhooks, and log notifications
- **Secure** - HMAC-SHA256 signed requests with shared secrets
- **Admin UI** - Complete configuration and monitoring interface

## Requirements

- Strapi v5.0.0 or higher
- Node.js 20.0.0 or higher

## Installation

```bash
npm install strapi-to-strapi-data-sync
```

Or with yarn:

```bash
yarn add strapi-to-strapi-data-sync
```

## Configuration

### 1. Enable the plugin

Add to your `config/plugins.js` (or `config/plugins.ts`):

```javascript
module.exports = {
  'strapi-to-strapi-data-sync': {
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

1. Navigate to **Strapi-to-Strapi Data Sync** in the admin sidebar
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
| **Scheduled** | Run at intervals (1-1440 minutes) |
| **Live** | Real-time sync on content changes |

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
| `GET` | `/strapi-to-strapi-data-sync/config` | Get connection config |
| `POST` | `/strapi-to-strapi-data-sync/config` | Update connection config |
| `POST` | `/strapi-to-strapi-data-sync/sync-now` | Trigger manual sync |
| `GET` | `/strapi-to-strapi-data-sync/sync-profiles` | List sync profiles |
| `GET` | `/strapi-to-strapi-data-sync/logs` | View sync logs |

### Public Routes (HMAC signed)

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/strapi-to-strapi-data-sync/receive` | Receive data from remote |

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