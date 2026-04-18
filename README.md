# Strapi-to-Strapi Data Sync Plugin

## Overview
The **Strapi-to-Strapi Data Sync** plugin enables seamless data synchronization between two Strapi instances. It supports both manual and event-based sync, ensuring data consistency across environments.

## Features
- **Manual Sync**: Trigger synchronization on demand.
- **Incremental Sync**: Only sync records updated since the last sync.
- **Event-Based Sync**: Automatically sync records after creation or update.
- **Conflict Resolution**: Configurable strategies (`latest`, `local_wins`, `remote_wins`).
- **Secure Communication**: HMAC-SHA256 request signing with shared secrets.
- **Admin UI**: Configure remote server, select content types, trigger sync, and view logs.
- **Logging**: Detailed logs of sync operations.

## Installation
1. Clone this repository into your Strapi project's `src/plugins` directory:
   ```bash
   git clone https://github.com/your-repo/strapi-plugin-strapi-to-strapi-data-sync src/plugins/strapi-to-strapi-data-sync
   ```
2. Enable the plugin in `config/plugins.js`:
   ```javascript
   module.exports = {
     'strapi-to-strapi-data-sync': {
       enabled: true,
       resolve: './src/plugins/strapi-to-strapi-data-sync',
     },
   };
   ```
3. Restart your Strapi server.

## Endpoints

### Public Endpoints
| Method | Path                     | Description                | Auth  |
|--------|--------------------------|----------------------------|-------|
| `POST` | `/strapi-to-strapi-data-sync/receive` | Receive records from remote | HMAC  |

### Admin Endpoints
| Method | Path                     | Description                |
|--------|--------------------------|----------------------------|
| `GET`  | `/strapi-to-strapi-data-sync/ping`    | Health check               |
| `GET`  | `/strapi-to-strapi-data-sync/config`  | Get remote server config   |
| `POST` | `/strapi-to-strapi-data-sync/config`  | Update remote server config|
| `GET`  | `/strapi-to-strapi-data-sync/content-types` | List syncable content types |
| `GET`  | `/strapi-to-strapi-data-sync/sync-config` | Get sync configuration     |
| `POST` | `/strapi-to-strapi-data-sync/sync-config` | Update sync configuration  |
| `POST` | `/strapi-to-strapi-data-sync/sync-now` | Trigger manual sync        |
| `GET`  | `/strapi-to-strapi-data-sync/logs`    | View sync logs             |

## Configuration

### Remote Server Configuration
The following fields are stored in the plugin store (`core_store`):
- **`baseUrl`**: Base URL of the remote Strapi instance.
- **`apiToken`**: API token for authentication.
- **`syncDirection`**: `push`, `pull`, or `bidirectional`.
- **`instanceId`**: Unique identifier for this Strapi instance.
- **`sharedSecret`**: Secret key for HMAC signing.

### Sync Configuration
Define which content types to sync and their behavior:
```json
{
  "contentTypes": [
    {
      "uid": "api::product.product",
      "direction": "both",
      "fields": ["name", "price", "stock"],
      "enabled": true
    }
  ],
  "conflictStrategy": "latest"
}
```

## Admin UI
The plugin adds a tabbed interface to the Strapi admin panel:
1. **Configuration**: Set remote server details.
2. **Content Types**: Select content types and sync options.
3. **Sync**: Trigger manual sync.
4. **Logs**: View detailed sync logs.

## Security
- **HMAC-SHA256**: Ensures secure communication between instances.
- **Masked Secrets**: `apiToken` and `sharedSecret` are masked in the admin UI and GET responses.

## Lifecycle Hooks
- **`beforeCreate`**: Automatically generates a `syncId` (UUID) for new records.
- **`afterCreate` / `afterUpdate`**: Pushes changes to the remote instance.

## Logging
Logs are stored in the `sync_logs` collection type and include:
- Action (e.g., `push`, `pull`, `sync_complete`)
- Content type
- Sync ID
- Status (`success`, `error`, `partial`)
- Message

## Development
### File Structure
```
strapi-plugin-strapi-to-strapi-data-sync/
├── server/
│   ├── src/
│   │   ├── controllers/       # API controllers
│   │   ├── services/          # Business logic
│   │   ├── utils/             # Helper functions
│   │   ├── routes/            # Route definitions
│   │   ├── content-types/     # Content type schemas
│   │   └── middlewares/       # Custom middleware
│   ├── bootstrap.js           # Lifecycle hooks
│   ├── register.js            # Plugin registration
│   └── destroy.js             # Cleanup
├── admin/
│   ├── src/
│   │   ├── components/        # React components
│   │   ├── pages/             # Admin pages
│   │   └── pluginId.js        # Plugin ID
└── README.md
```

## License
MIT