# Installation Guide

## Using Smithery

Visit [https://smithery.ai/server/@benborla29/mcp-server-mysql](https://smithery.ai/server/@benborla29/mcp-server-mysql) and follow the on-screen instructions.

## Cursor

1. Visit [https://smithery.ai/server/@benborla29/mcp-server-mysql](https://smithery.ai/server/@benborla29/mcp-server-mysql)
2. Follow the Cursor instructions on that page.

## Codex CLI

```bash
codex mcp add mcp_server_mysql \
  --env MYSQL_HOST="127.0.0.1" \
  --env MYSQL_PORT="3306" \
  --env MYSQL_USER="root" \
  --env MYSQL_PASS="your_password" \
  --env MYSQL_DB="your_database" \
  --env ALLOW_INSERT_OPERATION="false" \
  --env ALLOW_UPDATE_OPERATION="false" \
  --env ALLOW_DELETE_OPERATION="false" \
  -- npx -y @benborla29/mcp-server-mysql
```

## Claude Code

### Option 1: Import from Claude Desktop (Recommended)

If already configured in Claude Desktop:

```bash
claude mcp add-from-claude-desktop
```

### Option 2: Manual — NPX (simplest)

```bash
claude mcp add mcp_server_mysql \
  -e MYSQL_HOST="127.0.0.1" \
  -e MYSQL_PORT="3306" \
  -e MYSQL_USER="root" \
  -e MYSQL_PASS="your_password" \
  -e MYSQL_DB="your_database" \
  -e ALLOW_INSERT_OPERATION="false" \
  -e ALLOW_UPDATE_OPERATION="false" \
  -e ALLOW_DELETE_OPERATION="false" \
  -- npx @benborla29/mcp-server-mysql
```

### Option 3: Global Install

```bash
npm install -g @benborla29/mcp-server-mysql
# or
pnpm add -g @benborla29/mcp-server-mysql
```

Then add to Claude Code:

```bash
claude mcp add mcp_server_mysql \
  -e MYSQL_HOST="127.0.0.1" \
  -e MYSQL_PORT="3306" \
  -e MYSQL_USER="root" \
  -e MYSQL_PASS="your_password" \
  -e MYSQL_DB="your_database" \
  -e ALLOW_INSERT_OPERATION="false" \
  -e ALLOW_UPDATE_OPERATION="false" \
  -e ALLOW_DELETE_OPERATION="false" \
  -- npx @benborla29/mcp-server-mysql
```

### Option 4: Local Repository

```bash
claude mcp add mcp_server_mysql \
  -e MYSQL_HOST="127.0.0.1" \
  -e MYSQL_PORT="3306" \
  -e MYSQL_USER="root" \
  -e MYSQL_PASS="your_password" \
  -e MYSQL_DB="your_database" \
  -e ALLOW_INSERT_OPERATION="false" \
  -e ALLOW_UPDATE_OPERATION="false" \
  -e ALLOW_DELETE_OPERATION="false" \
  -e PATH="/path/to/node/bin:/usr/bin:/bin" \
  -e NODE_PATH="/path/to/node/lib/node_modules" \
  -- /path/to/node /full/path/to/mcp-server-mysql/dist/index.js
```

Find your paths:

```bash
which node                               # → /path/to/node
echo "$(which node)/../"                 # → PATH value
echo "$(which node)/../../lib/node_modules"  # → NODE_PATH value
```

### Unix Socket Connection

```bash
claude mcp add mcp_server_mysql \
  -e MYSQL_SOCKET_PATH="/tmp/mysql.sock" \
  -e MYSQL_USER="root" \
  -e MYSQL_PASS="your_password" \
  -e MYSQL_DB="your_database" \
  -- npx @benborla29/mcp-server-mysql
```

### Scope Selection

```bash
# Local (default) — current project only
claude mcp add mcp_server_mysql [options...]

# User — all your projects
claude mcp add mcp_server_mysql -s user [options...]

# Project — shared via .mcp.json
claude mcp add mcp_server_mysql -s project [options...]
```

Use **local** or **user** scope to keep credentials private.

### Verification

```bash
claude mcp list
claude mcp get mcp_server_mysql
# Inside Claude Code:
/mcp
```

### Multi-Database Mode

Omit `MYSQL_DB` to enable multi-DB mode:

```bash
claude mcp add mcp_server_mysql_multi \
  -e MYSQL_HOST="127.0.0.1" \
  -e MYSQL_PORT="3306" \
  -e MYSQL_USER="root" \
  -e MYSQL_PASS="your_password" \
  -e MULTI_DB_WRITE_MODE="false" \
  -- npx @benborla29/mcp-server-mysql
```

See [README-MULTI-DB.md](../README-MULTI-DB.md) for details.

## Running from Local Repository

```bash
git clone https://github.com/benborla/mcp-server-mysql.git
cd mcp-server-mysql
pnpm install
pnpm run build
```

Add to Claude Desktop (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "mcp_server_mysql": {
      "command": "/path/to/node",
      "args": ["/full/path/to/mcp-server-mysql/dist/index.js"],
      "env": {
        "MYSQL_HOST": "127.0.0.1",
        "MYSQL_PORT": "3306",
        "MYSQL_USER": "root",
        "MYSQL_PASS": "your_password",
        "MYSQL_DB": "your_database",
        "ALLOW_INSERT_OPERATION": "false",
        "ALLOW_UPDATE_OPERATION": "false",
        "ALLOW_DELETE_OPERATION": "false",
        "PATH": "/path/to/node/bin:/usr/bin:/bin",
        "NODE_PATH": "/path/to/node/lib/node_modules"
      }
    }
  }
}
```

Test directly:

```bash
node dist/index.js
```

## Remote Mode

1. Create `.env` file and copy from [example](https://github.com/benborla/mcp-server-mysql/blob/main/.env)
2. Set MySQL credentials
3. Set `IS_REMOTE_MCP=true`
4. Set `REMOTE_SECRET_KEY` to a secure string
5. Optionally set `PORT` (default: 3000)
6. Load and run:

```bash
source .env
npx @benborla29/mcp-server-mysql
```

Configure your agent:

```json
{
  "mcpServers": {
    "mysql": {
      "url": "http://your-host:3000/mcp",
      "type": "streamableHttp",
      "headers": {
        "Authorization": "Bearer <REMOTE_SECRET_KEY>"
      }
    }
  }
}
```
