# Configuration

## Basic Connection

| Variable | Default | Description |
|---|---|---|
| `MYSQL_HOST` | `127.0.0.1` | MySQL host (ignored if `MYSQL_SOCKET_PATH` set) |
| `MYSQL_PORT` | `3306` | MySQL port (ignored if `MYSQL_SOCKET_PATH` set) |
| `MYSQL_USER` | `root` | MySQL username |
| `MYSQL_PASS` | — | MySQL password |
| `MYSQL_DB` | — | Target database (omit for multi-DB mode) |
| `MYSQL_SOCKET_PATH` | — | Unix socket path (e.g. `/tmp/mysql.sock`) |
| `MYSQL_CONNECTION_STRING` | — | MySQL CLI-format connection string (overrides individual settings) |

### Connection String Format

```
mysql --default-auth=mysql_native_password -A -hHOST -PPORT -uUSER -pPASS database_name
```

Useful for rotating/expiring credentials. Store via env, not in version-controlled config.

## Performance

| Variable | Default | Description |
|---|---|---|
| `MYSQL_POOL_SIZE` | `10` | Connection pool size |
| `MYSQL_QUERY_TIMEOUT` | `30000` | Query timeout (ms), `0` = no limit. A call can shorten it with the `timeout_ms` tool argument |
| `MYSQL_QUERY_TIMEOUT_MAX` | unset | Lets `timeout_ms` go above `MYSQL_QUERY_TIMEOUT`, up to this value (ms). Unset: a call can only shorten the default |
| `MYSQL_CACHE_TTL` | `60000` | Cache TTL (ms) |
| `MYSQL_QUEUE_LIMIT` | `100` | Max queued connection requests |
| `MYSQL_CONNECT_TIMEOUT` | `10000` | Connection timeout (ms) |

How the query timeout works:

- The server sets a session limit before each query, so the database stops the statement and the call returns an error that states the limit.
  - MySQL 5.7.8+: `max_execution_time`. It bounds `SELECT` statements only; writes and `CALL` are not bounded (a `SELECT` inside a stored program is exempt), and an interrupted `EXPLAIN ANALYZE` returns a partial plan with warning 1317 instead of an error.
  - MariaDB 10.1+: `max_statement_time`. It bounds every statement.
  - Other servers: the server logs this once per connection, and queries run without a limit.
- The limit never goes above what the database already applies to the session: the global value, or a value that `init_connect`, a MariaDB per-user `MAX_STATEMENT_TIME`, or a proxy sets for the account. The smaller value wins, and `0` falls back to the database's value. Each connection reads that value once, the first time it is used, the same way MySQL copies the global into a new session.
- Behind a proxy: ProxySQL 2.4+ tracks the variable (older versions turn off multiplexing for the session), RDS Proxy pins the connection, and Vitess/PlanetScale ignores it, so use Vitess's own query timeout there.
- The MCP client can give up first. Many clients time out a tool call after 60 s by default, so to let a call run longer, raise the client's timeout too (in Claude Code, `MCP_TOOL_TIMEOUT` or the server's `timeout` in `.mcp.json`).
- `timeout_ms` must be 1 to the ceiling: `MYSQL_QUERY_TIMEOUT_MAX`, or `MYSQL_QUERY_TIMEOUT` when `MYSQL_QUERY_TIMEOUT_MAX` is unset. Only when both are `0`/unset is any value, including `0`, accepted. If `MYSQL_QUERY_TIMEOUT` is unset and `MYSQL_QUERY_TIMEOUT_MAX` is set, the default becomes the smaller of `30000` and `MYSQL_QUERY_TIMEOUT_MAX`; an explicit value outside 1 to `MYSQL_QUERY_TIMEOUT_MAX` fails at startup.
- SQL that sets the limit itself is always rejected, because it would override both this server's limit and the database's: MySQL optimizer hints for `max_execution_time` (`MAX_EXECUTION_TIME(...)`, `SET_VAR(...)`) and MariaDB `SET STATEMENT max_statement_time=... FOR`. Use `timeout_ms` instead.

## Security & Permissions

| Variable | Default | Description |
|---|---|---|
| `ALLOW_INSERT_OPERATION` | `false` | Enable INSERT |
| `ALLOW_UPDATE_OPERATION` | `false` | Enable UPDATE |
| `ALLOW_DELETE_OPERATION` | `false` | Enable DELETE |
| `ALLOW_DDL_OPERATION` | `false` | Enable DDL (CREATE/DROP/ALTER) |
| `MYSQL_DISABLE_READ_ONLY_TRANSACTIONS` | `false` | Disable read-only transaction enforcement ⚠️ |
| `MYSQL_RATE_LIMIT` | `100` | Max queries per minute |
| `MYSQL_MAX_QUERY_COMPLEXITY` | `1000` | Max query complexity score |
| `MYSQL_SSL` | `false` | Enable SSL/TLS |
| `MYSQL_SSL_CA` | — | Path to SSL CA certificate (PEM) |
| `MYSQL_SSL_CERT` | — | Path to client certificate (PEM, for mTLS) |
| `MYSQL_SSL_KEY` | — | Path to client private key (PEM, for mTLS) |

### Schema-Specific Permissions

Override global permissions per database:

```bash
SCHEMA_INSERT_PERMISSIONS=development:true,test:true,production:false
SCHEMA_UPDATE_PERMISSIONS=development:true,test:true,production:false
SCHEMA_DELETE_PERMISSIONS=development:false,test:true,production:false
SCHEMA_DDL_PERMISSIONS=development:false,test:true,production:false
```

Multi-DB mode: `MULTI_DB_WRITE_MODE=false` (default — write disabled across all DBs).

See [README-MULTI-DB.md](../README-MULTI-DB.md) for full details.

## PII Redaction

See [PII-REDACTION.md](./PII-REDACTION.md) for full documentation.

| Variable | Default | Description |
|---|---|---|
| `ENABLE_PII_REDACTION` | `false` | Enable PII masking on read results |
| `PII_EXTRA_COLUMNS` | — | Comma-separated column name substrings to treat as PII |
| `PII_EXTRA_COLUMN_PATTERNS` | — | Semicolon-separated JS regex bodies for PII column matching |
| `PII_ALLOW_SELECT_STAR` | `false` | Allow `SELECT *` when redaction enabled |
| `PII_ALLOW_REFERENCES` | `false` | Allow queries referencing PII columns |
| `PII_ALLOW_INTROSPECTION` | `false` | Allow raw schema introspection when redaction enabled |
| `PII_BLOCK_INTROSPECTION` | `false` | Hard-block all introspection statements |

## Timezone & Dates

| Variable | Default | Description |
|---|---|---|
| `MYSQL_TIMEZONE` | — | Timezone for date/time (e.g. `+08:00`, `-05:00`, `Z`, `local`) |
| `MYSQL_DATE_STRINGS` | `false` | Return dates as strings instead of JS Date objects |

## Monitoring

| Variable | Default | Description |
|---|---|---|
| `MYSQL_ENABLE_LOGGING` | `false` | Enable query logging |
| `MYSQL_LOG_LEVEL` | `info` | Log level |
| `MYSQL_METRICS_ENABLED` | `false` | Enable performance metrics |

## Remote MCP

| Variable | Default | Description |
|---|---|---|
| `IS_REMOTE_MCP` | `false` | Enable HTTP server mode |
| `REMOTE_SECRET_KEY` | — | Bearer token for remote auth |
| `PORT` | `3000` | HTTP server port |

## Advanced Config Example

```json
{
  "mcpServers": {
    "mcp_server_mysql": {
      "command": "/path/to/npx/binary/npx",
      "args": ["-y", "@benborla29/mcp-server-mysql"],
      "env": {
        "MYSQL_HOST": "127.0.0.1",
        "MYSQL_PORT": "3306",
        "MYSQL_USER": "root",
        "MYSQL_PASS": "",
        "MYSQL_DB": "db_name",
        "PATH": "/path/to/node/bin:/usr/bin:/bin",
        "MYSQL_POOL_SIZE": "10",
        "MYSQL_QUERY_TIMEOUT": "30000",
        "MYSQL_CACHE_TTL": "60000",
        "MYSQL_RATE_LIMIT": "100",
        "MYSQL_SSL": "false",
        "ALLOW_INSERT_OPERATION": "false",
        "ALLOW_UPDATE_OPERATION": "false",
        "ALLOW_DELETE_OPERATION": "false",
        "MYSQL_ENABLE_LOGGING": "false"
      }
    }
  }
}
```
