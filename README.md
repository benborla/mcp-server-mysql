# MCP Server for MySQL

[![MCP Toplist](https://mcptoplist.com/badge/glama%2Fbenborla%2Fmcp-server-mysql.svg)](https://mcptoplist.com/server/glama%2Fbenborla%2Fmcp-server-mysql)

[![Trust Score](https://archestra.ai/mcp-catalog/api/badge/quality/benborla/mcp-server-mysql)](https://archestra.ai/mcp-catalog/benborla__mcp-server-mysql)

## Sponsor — Bloome

[![Bloome](assets/bloome.png)](https://bloome.im/login?ref=2x7GfeSw)

Using mcp-server-mysql to let your AI query MySQL? [**Bloome**](https://bloome.im/login?ref=2x7GfeSw) brings that to your whole team — an AI-agent IM platform where AI agents are members of the chat. Connect your MCP tools and have agents inspect schemas, run queries, and answer data questions for everyone in one thread. Zero local setup, runs in the cloud, on web and mobile.

---

MCP server that gives Claude and other LLMs access to MySQL — inspect schemas, run queries, and optionally write data, all through the Model Context Protocol.

## Key Features

- **Read-only by default** — write operations opt-in via env flags
- **Claude Code integration** — optimized for Anthropic's Claude Code CLI
- **SSH tunnel support** — built-in support for remote databases
- **Multi-DB mode** — query across multiple databases without reconnecting
- **Multiple connections** — connect to multiple MySQL hosts/databases from a single MCP server
- **Schema-specific permissions** — per-database read/write control
- **PII redaction** — automatic masking of sensitive data in results
- **Remote mode** — HTTP transport with bearer token auth
- **SSL/TLS support** — encrypted connections with mTLS option

## Requirements

- Node.js v20+
- MySQL 5.7+ (8.0+ recommended)
- MySQL user with appropriate privileges

## Quick Install

**Claude Code (simplest):**

```bash
claude mcp add mcp_server_mysql \
  -e MYSQL_HOST="127.0.0.1" \
  -e MYSQL_PORT="3306" \
  -e MYSQL_USER="root" \
  -e MYSQL_PASS="your_password" \
  -e MYSQL_DB="your_database" \
  -- npx @benborla29/mcp-server-mysql
```

**Claude Desktop / other clients:**

```json
{
  "mcpServers": {
    "mcp_server_mysql": {
      "command": "npx",
      "args": ["-y", "@benborla29/mcp-server-mysql"],
      "env": {
        "MYSQL_HOST": "127.0.0.1",
        "MYSQL_PORT": "3306",
        "MYSQL_USER": "root",
        "MYSQL_PASS": "your_password",
        "MYSQL_DB": "your_database"
      }
    }
  }
}
```

All write operations are disabled by default. Enable with `ALLOW_INSERT_OPERATION=true`, `ALLOW_UPDATE_OPERATION=true`, `ALLOW_DELETE_OPERATION=true`.

## Documentation

- [Installation Guide](docs/INSTALLATION.md) — Smithery, Cursor, Codex, Claude Code, local repo, remote mode
- [Configuration & Environment Variables](docs/CONFIGURATION.md) — all env vars, advanced config
- [Multi-DB Mode](README-MULTI-DB.md) — querying multiple databases
- [PII Redaction](docs/PII-REDACTION.md) — automatic data masking
- [Testing](docs/TESTING.md) — test setup and running
- [Troubleshooting](docs/TROUBLESHOOTING.md) — common issues and fixes
- [Changelog](CHANGELOG.md)

## Tools & Resources

**Tool: `mysql_query`**
Execute SQL queries. Read-only by default. Write operations enabled per flag.

Parameters:
- `sql` (required) — SQL query to execute
- `connection` (optional) — Connection name to use (default: `"default"`)

Use `SHOW CONNECTIONS` as the SQL query to list all available connections.

**Resources: `mysql://tables`**
Lists all tables and column metadata for the connected database.

## Multiple Connections

Connect to multiple MySQL hosts or databases from a single MCP server instance. This is useful when your workflow spans multiple environments (staging, production, analytics) or when you need to query different databases on different hosts.

### Configuration

Define named connections using numbered environment variables. Each group `N` (1, 2, 3, ...) registers a named connection accessible via the `connection` parameter in the `mysql_query` tool.

```bash
# Default connection (from MYSQL_HOST / MYSQL_DB)
MYSQL_HOST=127.0.0.1
MYSQL_PORT=3306
MYSQL_USER=root
MYSQL_PASS=your_password
MYSQL_DB=

# First named connection — accessible as connection "staging"
MYSQL_CONNECTION_1_NAME=staging
MYSQL_CONNECTION_1_HOST=staging-db.example.com
MYSQL_CONNECTION_1_PORT=3306
MYSQL_CONNECTION_1_USER=app_user
MYSQL_CONNECTION_1_PASS=secret123
MYSQL_CONNECTION_1_DB=app_staging

# Second named connection — accessible as connection "reporting"
MYSQL_CONNECTION_2_NAME=reporting
MYSQL_CONNECTION_2_HOST=analytics.example.com
MYSQL_CONNECTION_2_PORT=3306
MYSQL_CONNECTION_2_USER=readonly
MYSQL_CONNECTION_2_PASS=readonly_pass
MYSQL_CONNECTION_2_DB=reporting
```

### Per-Connection Write Permissions

By default, the global `ALLOW_*_OPERATION` flags apply to every connection. To restrict a specific connection to read-only, set the per-connection override flags:

```bash
# Make the "reporting" connection read-only
MYSQL_CONNECTION_2_ALLOW_INSERT_OPERATION=false
MYSQL_CONNECTION_2_ALLOW_UPDATE_OPERATION=false
MYSQL_CONNECTION_2_ALLOW_DELETE_OPERATION=false
MYSQL_CONNECTION_2_ALLOW_DDL_OPERATION=false
```

When a per-connection flag is not set, the global `ALLOW_*_OPERATION` value is used as the fallback. This lets you, for example, keep the default connection writable while marking production replicas as read-only.

### Usage

Pass the `connection` parameter when calling the `mysql_query` tool:

```json
{
  "sql": "SELECT * FROM users LIMIT 5",
  "connection": "staging"
}
```

If omitted, `connection` defaults to `"default"` (the main env-var-based config).

### Listing Available Connections

Use `SHOW CONNECTIONS` as the SQL query to see all registered connections:

```
SHOW CONNECTIONS
```

Returns:

```
- default → 127.0.0.1 (multi-DB mode)
- staging → staging-db.example.com (app_staging)
- reporting → analytics.example.com (reporting)
```

### Configuration with OpenCode

Add the named connection env vars to your `opencode.json` MCP server entry:

```json
{
  "mcpServers": {
    "mysql": {
      "type": "local",
      "command": ["node", "/path/to/dist/index.js"],
      "environment": {
        "MYSQL_HOST": "127.0.0.1",
        "MYSQL_PORT": "3306",
        "MYSQL_USER": "root",
        "MYSQL_PASS": "your_password",

        "MYSQL_CONNECTION_1_NAME": "staging",
        "MYSQL_CONNECTION_1_HOST": "staging-db.example.com",
        "MYSQL_CONNECTION_1_PORT": "3306",
        "MYSQL_CONNECTION_1_USER": "app_user",
        "MYSQL_CONNECTION_1_PASS": "secret123",
        "MYSQL_CONNECTION_1_DB": "app_staging",

        "MYSQL_CONNECTION_2_NAME": "reporting",
        "MYSQL_CONNECTION_2_HOST": "analytics.example.com",
        "MYSQL_CONNECTION_2_USER": "readonly",
        "MYSQL_CONNECTION_2_PASS": "readonly_pass",
        "MYSQL_CONNECTION_2_DB": "reporting"
      },
      "enabled": true,
      "timeout": 30000
    }
  }
}
```

After adding, restart OpenCode. The `mysql_query` tool description will automatically list all available connections.

### Example Prompts

> "Show me all tables in the staging connection"
>
> "Query the reporting connection: SELECT COUNT(*) FROM orders"
>
> "List my available MySQL connections"
>
> "Compare user count between default and staging"

### Notes

- Named connections inherit the default `connectionLimit` (10) and `connectTimeout` (10000ms).
- Write permissions (INSERT, UPDATE, DELETE, DDL) are applied globally — they affect all connections equally.
- Connections are created lazily on first use and pooled for reuse.
- The MCP resources (`mysql://tables`) always use the default connection.

## Contributing

PRs welcome at [github.com/benborla/mcp-server-mysql](https://github.com/benborla/mcp-server-mysql).

```bash
git clone https://github.com/benborla/mcp-server-mysql.git
pnpm install
pnpm run build
pnpm test
```

[![Contributors](https://contrib.rocks/image?repo=benborla/mcp-server-mysql)](https://github.com/benborla/mcp-server-mysql/graphs/contributors)

## License

MIT — see [LICENSE](LICENSE) for details.
