# Troubleshooting

## Connection Issues

- Verify MySQL is running and accessible
- Check credentials and user permissions
- Verify SSL/TLS config if enabled
- Test with a MySQL client directly

**Path resolution error** ("Could not connect to MCP server"):

```json
{
  "env": {
    "PATH": "/path/to/node/bin:/usr/bin:/bin"
  }
}
```

Find paths:

```bash
echo "$(which node)/../"                     # PATH value
echo "$(which node)/../../lib/node_modules"  # NODE_PATH value
```

## Performance Issues

- Increase `MYSQL_POOL_SIZE`
- Raise `MYSQL_QUERY_TIMEOUT`
- Enable `MYSQL_CACHE_TTL`
- Reduce `MYSQL_MAX_QUERY_COMPLEXITY`

## Security Restrictions

- Check `MYSQL_RATE_LIMIT`
- Verify write operation flags (`ALLOW_INSERT_OPERATION`, etc.)
- Confirm MySQL user has required privileges

## Claude Code / Claude Desktop

**"Server disconnected"** — check logs at:
```
~/Library/Logs/Claude/mcp-server-mcp_server_mysql.log
```

- Use absolute paths for both Node binary and server script
- Ensure `.env` is loaded or env vars are set explicitly in config
- Test the server directly: `node dist/index.js`
- Enable write ops if needed:
  ```json
  "env": {
    "ALLOW_INSERT_OPERATION": "true",
    "ALLOW_UPDATE_OPERATION": "true",
    "ALLOW_DELETE_OPERATION": "true"
  }
  ```

**Direct execution config:**

```json
{
  "mcpServers": {
    "mcp_server_mysql": {
      "command": "/full/path/to/node",
      "args": ["/full/path/to/mcp-server-mysql/dist/index.js"],
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

## Authentication Issues (MySQL 8.0+)

Ensure `caching_sha2_password` is supported, or create a user with legacy auth:

```sql
CREATE USER 'user'@'localhost' IDENTIFIED WITH mysql_native_password BY 'password';
```

## `ERR_MODULE_NOT_FOUND: Cannot find package 'dotenv'`

```bash
npx -y -p @benborla29/mcp-server-mysql -p dotenv mcp-server-mysql
```

Thanks to @lizhuangs
