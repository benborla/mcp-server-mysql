# Project Database Setup Guide with MCP Server, SSH Tunnels, and Hooks

This guide explains how to set up database connections for projects using Claude Code with MCP servers, SSH tunnels, and automatic hooks.

## Table of Contents
- [Overview](#overview)
- [Prerequisites](#prerequisites)
- [Step-by-Step Setup](#step-by-step-setup)
- [File Structure](#file-structure)
- [Configuration Examples](#configuration-examples)
- [Testing Your Setup](#testing-your-setup)
- [Troubleshooting](#troubleshooting)

## Overview

Each project requires three main components for database access through Claude Code:
1. **SSH Tunnel Scripts** - Establish secure connection to remote database
2. **MCP Configuration** - Configure database access through MCP server
3. **Hooks** - Automatically start/stop tunnels with Claude

### Current Project Configurations

| Project | Port | SSH Server | Database | Location |
|---------|------|------------|----------|----------|
| NIMA | 3307 | gold.superhosting.bg:1022 | izdavamc_nima | `/Users/dimitarklaturov/Dropbox/nima` |
| IZDAVAM | 3308 | gold.superhosting.bg:1022 | izdavamc_izdavam | `/Users/dimitarklaturov/Dropbox/izdavam` |
| NUFC | 3309 | nufc.bg:1022 | pwr0iwww_nufc | `/Users/dimitarklaturov/Dropbox/nufc` |
| STUDIA | 3310 | gold.superhosting.bg:1022 | izdavamc_studia | `/Users/dimitarklaturov/Dropbox/flutter/studia` |

## Prerequisites

1. **MCP MySQL Server** installed at: `/Users/dimitarklaturov/Dropbox/github/mcp-server-mysql`
   - Must have `MYSQL_DISABLE_READ_ONLY_TRANSACTIONS` support for CREATE TABLE operations
   - Built with `npm run build` or `pnpm build`

2. **SSH Access** to your database server
   - SSH key configured (`~/.ssh/id_rsa`)
   - Known hosts configured

3. **MySQL Client** installed locally for testing
   - Install with: `brew install mysql-client`

## Step-by-Step Setup

### Step 1: Create SSH Tunnel Scripts

Create two scripts in your project directory:

#### `start-tunnel-[project].sh`
```bash
#!/bin/bash

# SSH Tunnel for [PROJECT] project
LOCAL_PORT=33XX  # Use unique port (3307, 3308, 3309, etc.)
REMOTE_SERVER="your.server.com"  # Your SSH server
SSH_PORT=1022  # SSH port (often 1022 or 22)
SSH_USER="your_ssh_user"  # SSH username

echo "🔗 Starting SSH tunnel for [PROJECT] project..."
echo "📊 Local port: $LOCAL_PORT"
echo "🌐 Remote server: $REMOTE_SERVER:$SSH_PORT"
echo "👤 User: $SSH_USER"

# Check if port is already in use
if lsof -Pi :$LOCAL_PORT -sTCP:LISTEN -t >/dev/null ; then
    echo "⚠️  Port $LOCAL_PORT already in use - tunnel may already be running"
    exit 0
fi

# Create the SSH tunnel
ssh -f -N -L $LOCAL_PORT:localhost:3306 -p $SSH_PORT $SSH_USER@$REMOTE_SERVER

if [ $? -eq 0 ]; then
    sleep 2
    if lsof -Pi :$LOCAL_PORT -sTCP:LISTEN -t >/dev/null ; then
        echo "✅ [PROJECT] SSH tunnel created successfully on port $LOCAL_PORT"
    else
        echo "❌ Tunnel creation failed"
        exit 1
    fi
else
    echo "❌ Failed to create SSH tunnel"
    exit 1
fi
```

#### `stop-tunnel-[project].sh`
```bash
#!/bin/bash

# Stop SSH Tunnel for [PROJECT] project
LOCAL_PORT=33XX  # Same port as in start script

echo "🛑 Stopping SSH tunnel for [PROJECT] project (port $LOCAL_PORT)..."

# Find and kill the tunnel process
PID=$(lsof -ti:$LOCAL_PORT)
if [ -n "$PID" ]; then
    kill $PID
    echo "✅ [PROJECT] SSH tunnel stopped (PID: $PID)"
else
    echo "ℹ️  No tunnel found running on port $LOCAL_PORT"
fi
```

Make scripts executable:
```bash
chmod +x start-tunnel-*.sh stop-tunnel-*.sh
```

### Step 2: Create MCP Configuration

Create `.mcp.json` in your project directory:

```json
{
  "hooks": {
    "claude_start": {
      "command": "./start-tunnel-[project].sh",
      "background": true,
      "description": "Start SSH tunnel for [PROJECT] database"
    },
    "claude_stop": {
      "command": "./stop-tunnel-[project].sh",
      "background": false,
      "description": "Stop SSH tunnel for [PROJECT] database"
    }
  },
  "inputs": [
    {
      "type": "promptString",
      "id": "mysql-password-[project]",
      "description": "MySQL Password for [PROJECT] Database",
      "password": true,
      "default": "your_password_here"
    }
  ],
  "servers": {
    "[project]-mysql-server": {
      "type": "stdio",
      "command": "bash",
      "args": ["-c", "cd /Users/dimitarklaturov/Dropbox/github/mcp-server-mysql && node dist/index.js"],
      "env": {
        "MYSQL_HOST": "127.0.0.1",
        "MYSQL_PORT": "33XX",
        "MYSQL_USER": "your_db_user",
        "MYSQL_PASS": "${input:mysql-password-[project]}",
        "MYSQL_DB": "your_database_name",
        "ALLOW_INSERT_OPERATION": "true",
        "ALLOW_UPDATE_OPERATION": "true",
        "ALLOW_DELETE_OPERATION": "true",
        "ALLOW_DDL_OPERATION": "true",
        "MYSQL_DISABLE_READ_ONLY_TRANSACTIONS": "true"
      }
    }
  }
}
```

### Step 3: Configure Port Mapping

Choose a unique local port for each project to avoid conflicts:

| Port Range | Usage |
|------------|-------|
| 3307 | First project |
| 3308 | Second project |
| 3309 | Third project |
| 3310 | Fourth project |
| 3311+ | Additional projects |

## File Structure

Your project should have this structure:
```
/path/to/your/project/
├── .mcp.json                    # MCP configuration
├── start-tunnel-[project].sh    # Start SSH tunnel script
├── stop-tunnel-[project].sh     # Stop SSH tunnel script
└── ... (your project files)
```

## Configuration Examples

### Example 1: Project on gold.superhosting.bg

For projects hosted on gold.superhosting.bg (like NIMA, IZDAVAM, STUDIA):

```json
{
  "hooks": {
    "claude_start": {
      "command": "./start-tunnel-myproject.sh",
      "background": true,
      "description": "Start SSH tunnel for MYPROJECT database"
    },
    "claude_stop": {
      "command": "./stop-tunnel-myproject.sh",
      "background": false,
      "description": "Stop SSH tunnel for MYPROJECT database"
    }
  },
  "inputs": [
    {
      "type": "promptString",
      "id": "mysql-password-myproject",
      "description": "MySQL Password for MYPROJECT Database",
      "password": true,
      "default": "my_secure_password"
    }
  ],
  "servers": {
    "myproject-mysql-server": {
      "type": "stdio",
      "command": "bash",
      "args": ["-c", "cd /Users/dimitarklaturov/Dropbox/github/mcp-server-mysql && node dist/index.js"],
      "env": {
        "MYSQL_HOST": "127.0.0.1",
        "MYSQL_PORT": "3311",
        "MYSQL_USER": "izdavamc_myproject",
        "MYSQL_PASS": "${input:mysql-password-myproject}",
        "MYSQL_DB": "izdavamc_myproject",
        "ALLOW_INSERT_OPERATION": "true",
        "ALLOW_UPDATE_OPERATION": "true",
        "ALLOW_DELETE_OPERATION": "true",
        "ALLOW_DDL_OPERATION": "true",
        "MYSQL_DISABLE_READ_ONLY_TRANSACTIONS": "true"
      }
    }
  }
}
```

### Example 2: Project on Different Server

For projects on different servers (like NUFC on nufc.bg):

```bash
# start-tunnel-myproject.sh
LOCAL_PORT=3312
REMOTE_SERVER="myserver.com"
SSH_PORT=22  # Standard SSH port
SSH_USER="myuser"
```

## Testing Your Setup

### 1. Test SSH Tunnel
```bash
# Start tunnel manually
./start-tunnel-[project].sh

# Check if port is listening
lsof -i :33XX

# Stop tunnel
./stop-tunnel-[project].sh
```

### 2. Test Database Connection
```bash
# Test connection through tunnel
mysql -h 127.0.0.1 -P 33XX -u db_user -p"password" -D database_name -e "SELECT 'Connection OK' as status;"
```

### 3. Test Claude Integration
```bash
# Navigate to project
cd /path/to/your/project

# Start Claude (should auto-start tunnel)
claude

# Check MCP servers
/mcp

# Exit Claude (should auto-stop tunnel)
# Press Ctrl+C twice
```

### 4. Test MCP Server Operations
Once in Claude, test database operations:
```sql
# Through MCP server
CREATE TABLE test_table (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100)
);

INSERT INTO test_table (name) VALUES ('Test');

SELECT * FROM test_table;

DROP TABLE test_table;
```

## Troubleshooting

### Common Issues and Solutions

#### 1. SSH Tunnel Fails to Start
- **Check SSH key**: Ensure `~/.ssh/id_rsa` exists and has correct permissions (600)
- **Test SSH manually**: `ssh -p 1022 user@server.com`
- **Check port availability**: `lsof -i :33XX`

#### 2. Database Connection Fails
- **Verify tunnel is running**: `lsof -i :33XX`
- **Check credentials**: Test with mysql client directly
- **Verify database exists**: `SHOW DATABASES;`

#### 3. MCP Server Fails to Connect
- **Check MCP server is built**: `ls /Users/dimitarklaturov/Dropbox/github/mcp-server-mysql/dist/`
- **Verify Node.js version**: `node --version` (should be 18+ or 20+)
- **Check logs**: `claude --debug`

#### 4. Hooks Not Working
- **Check script permissions**: `ls -la *.sh` (should be executable)
- **Verify script paths**: Use relative paths (`./script.sh`) in .mcp.json
- **Test scripts manually**: Run start/stop scripts directly

#### 5. Port Conflicts
- **Kill existing process**: `kill $(lsof -ti:33XX)`
- **Use different port**: Update both scripts and .mcp.json

### Debug Commands

```bash
# Check all SSH tunnels
ps aux | grep ssh | grep -E "3307|3308|3309|3310"

# Check all listening ports
lsof -i -P | grep LISTEN | grep -E "3307|3308|3309|3310"

# Test MCP server directly
cd /Users/dimitarklaturov/Dropbox/github/mcp-server-mysql
MYSQL_HOST=127.0.0.1 MYSQL_PORT=33XX MYSQL_USER=user MYSQL_PASS=pass MYSQL_DB=db node dist/index.js

# View Claude logs
claude --debug 2>&1 | grep -i mcp
```

## Security Notes

1. **Password Storage**: The default password in .mcp.json is visible in the file. Consider:
   - Using environment variables
   - Removing the default and entering manually each time
   - Using a password manager integration

2. **SSH Keys**: Ensure your SSH keys are:
   - Protected with proper permissions (600)
   - Password-protected for additional security
   - Regularly rotated

3. **Port Security**: Local ports (3307-3310+) are only accessible from localhost

## Quick Setup Checklist

For each new project:

- [ ] Choose unique local port (3311, 3312, etc.)
- [ ] Create `start-tunnel-[project].sh` with correct server details
- [ ] Create `stop-tunnel-[project].sh` with matching port
- [ ] Make scripts executable: `chmod +x *.sh`
- [ ] Create `.mcp.json` with:
  - [ ] Hooks for start/stop scripts
  - [ ] Input for password
  - [ ] MCP server configuration
- [ ] Test SSH tunnel manually
- [ ] Test database connection
- [ ] Test with `claude` command
- [ ] Verify auto-start/stop works

## Support

For issues with:
- **MCP Server**: Check `/Users/dimitarklaturov/Dropbox/github/mcp-server-mysql`
- **Claude Code**: Run `claude --help` or visit https://docs.anthropic.com/en/docs/claude-code
- **SSH Tunnels**: Check server connectivity and SSH key configuration