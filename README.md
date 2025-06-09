
# MCP Server for MySQL based on NodeJS
[![smithery badge](https://smithery.ai/badge/@benborla29/mcp-server-mysql)](https://smithery.ai/server/@benborla29/mcp-server-mysql)

![Demo](assets/demo.gif)
<a href="https://glama.ai/mcp/servers/@benborla/mcp-server-mysql">
  <img width="380" height="200" src="https://glama.ai/mcp/servers/@benborla/mcp-server-mysql/badge" />
</a>

A Model Context Protocol server that provides access to MySQL databases. This server enables LLMs to inspect database schemas and execute SQL queries.

## Table of Contents
- [Requirements](#requirements)
- [Installation](#installation)
  - [Smithery](#using-smithery)
  - [Clone to Local Repository](#running-from-local-repository)
- [Components](#components)
- [Configuration](#configuration)
- [Environment Variables](#environment-variables)
- [Multi-DB Mode](#multi-db-mode)
- [Schema-Specific Permissions](#schema-specific-permissions)
- [Testing](#testing)
- [Troubleshooting](#troubleshooting)
- [Contributing](#contributing)
- [License](#license)

## Requirements

- Node.js v18 or higher
- MySQL 5.7 or higher (MySQL 8.0+ recommended)
- MySQL user with appropriate permissions for the operations you need
- For write operations: MySQL user with INSERT, UPDATE, and/or DELETE privileges

## Installation

There are several ways to install and configure the MCP server but the most common would be checking this website https://smithery.ai/server/@benborla29/mcp-server-mysql

### Cursor

For Cursor IDE, you can install this MCP server with the following command in your project:

1. Visit https://smithery.ai/server/@benborla29/mcp-server-mysql
2. Follow the instruction for Cursor


MCP Get provides a centralized registry of MCP servers and simplifies the installation process.

### Using NPM/PNPM

For manual installation:

```bash
# Using npm
npm install -g @benborla29/mcp-server-mysql

# Using pnpm
pnpm add -g @benborla29/mcp-server-mysql
```

After manual installation, you'll need to configure your LLM application to use the MCP server (see Configuration section below).

### Running from Local Repository

If you want to clone and run this MCP server directly from the source code, follow these steps:

1. **Clone the repository**
   ```bash
   git clone https://github.com/benborla/mcp-server-mysql.git
   cd mcp-server-mysql
   ```

2. **Install dependencies**
   ```bash
   npm install
   # or
   pnpm install
   ```

3. **Build the project**
   ```bash
   npm run build
   # or
   pnpm run build
   ```

4. **Configure Claude Desktop**

   Add the following to your Claude Desktop configuration file (`claude_desktop_config.json`):

   ```json
   {
     "mcpServers": {
       "mcp_server_mysql": {
         "command": "/path/to/node",
         "args": [
           "/full/path/to/mcp-server-mysql/dist/index.js"
         ],
         "env": {
           "MYSQL_HOST": "127.0.0.1",
           "MYSQL_PORT": "3306",
           "MYSQL_USER": "root",
           "MYSQL_PASS": "your_password",
           "MYSQL_DB": "your_database",
           "ALLOW_INSERT_OPERATION": "false",
           "ALLOW_UPDATE_OPERATION": "false",
           "ALLOW_DELETE_OPERATION": "false",
           "PATH": "/Users/atlasborla/Library/Application Support/Herd/config/nvm/versions/node/v22.9.0/bin:/usr/bin:/bin", // <--- Important to add the following, run in your terminal `echo "$(which node)/../"` to get the path
           "NODE_PATH": "/Users/atlasborla/Library/Application Support/Herd/config/nvm/versions/node/v22.9.0/lib/node_modules" // <--- Important to add the following, run in your terminal `echo "$(which node)/../../lib/node_modules"`
         }
       }
     }
   }
   ```

   Replace:
   - `/path/to/node` with the full path to your Node.js binary (find it with `which node`)
   - `/full/path/to/mcp-server-mysql` with the full path to where you cloned the repository
   - Set the MySQL credentials to match your environment

5. **Test the server**
   ```bash
   # Run the server directly to test
   node dist/index.js
   ```

   If it connects to MySQL successfully, you're ready to use it with Claude Desktop.

## Components

### Tools

- **mysql_query**
  - Execute SQL queries against the connected database
  - Input: `sql` (string): The SQL query to execute
  - By default, limited to READ ONLY operations
  - Optional write operations (when enabled via configuration):
    - INSERT: Add new data to tables (requires `ALLOW_INSERT_OPERATION=true`)
    - UPDATE: Modify existing data (requires `ALLOW_UPDATE_OPERATION=true`)
    - DELETE: Remove data (requires `ALLOW_DELETE_OPERATION=true`)
  - All operations are executed within a transaction with proper commit/rollback handling
  - Supports prepared statements for secure parameter handling
  - Configurable query timeouts and result pagination
  - Built-in query execution statistics

### Resources

The server provides comprehensive database information:

- **Table Schemas**
  - JSON schema information for each table
  - Column names and data types
  - Index information and constraints
  - Foreign key relationships
  - Table statistics and metrics
  - Automatically discovered from database metadata

### Security Features

- SQL injection prevention through prepared statements
- Query whitelisting/blacklisting capabilities
- Rate limiting for query execution
- Query complexity analysis
- Configurable connection encryption
- Read-only transaction enforcement

### Performance Optimizations

- Optimized connection pooling
- Query result caching
- Large result set streaming
- Query execution plan analysis
- Configurable query timeouts

### Monitoring and Debugging

- Comprehensive query logging
- Performance metrics collection
- Error tracking and reporting
- Health check endpoints
- Query execution statistics

## Configuration

### Automatic Configuration with Smithery
If you installed using Smithery, your configuration is already set up. You can view or modify it with:

```bash
smithery configure @benborla29/mcp-server-mysql
```

When reconfiguring, you can update any of the MySQL connection details as well as the write operation settings:

- **Basic connection settings**:
  - MySQL Host, Port, User, Password, Database
  - SSL/TLS configuration (if your database requires secure connections)

- **Write operation permissions**:
  - Allow INSERT Operations: Set to true if you want to allow adding new data
  - Allow UPDATE Operations: Set to true if you want to allow updating existing data
  - Allow DELETE Operations: Set to true if you want to allow deleting data

For security reasons, all write operations are disabled by default. Only enable these settings if you specifically need Claude to modify your database data.

### Advanced Configuration Options
For more control over the MCP server's behavior, you can use these advanced configuration options:

```json
{
  "mcpServers": {
    "mcp_server_mysql": {
      "command": "/path/to/npx/binary/npx",
      "args": [
        "-y",
        "@benborla29/mcp-server-mysql"
      ],
      "env": {
        // Basic connection settings
        "MYSQL_HOST": "127.0.0.1",
        "MYSQL_PORT": "3306",
        "MYSQL_USER": "root",
        "MYSQL_PASS": "",
        "MYSQL_DB": "db_name",
        "PATH": "/path/to/node/bin:/usr/bin:/bin",
        
        // Performance settings
        "MYSQL_POOL_SIZE": "10",
        "MYSQL_QUERY_TIMEOUT": "30000",
        "MYSQL_CACHE_TTL": "60000",
        
        // Security settings
        "MYSQL_RATE_LIMIT": "100",
        "MYSQL_MAX_QUERY_COMPLEXITY": "1000",
        "MYSQL_SSL": "true",
        
        // Monitoring settings
        "ENABLE_LOGGING": "true",
        "MYSQL_LOG_LEVEL": "info",
        "MYSQL_METRICS_ENABLED": "true",
        
        // Write operation flags
        "ALLOW_INSERT_OPERATION": "false",
        "ALLOW_UPDATE_OPERATION": "false",
        "ALLOW_DELETE_OPERATION": "false"
      }
    }
  }
}
```

## Environment Variables

### Basic Connection
- `MYSQL_SOCKET_PATH`: Unix socket path for local connections (e.g., "/tmp/mysql.sock")
- `MYSQL_HOST`: MySQL server host (default: "127.0.0.1") - ignored if MYSQL_SOCKET_PATH is set
- `MYSQL_PORT`: MySQL server port (default: "3306") - ignored if MYSQL_SOCKET_PATH is set
- `MYSQL_USER`: MySQL username (default: "root")
- `MYSQL_PASS`: MySQL password
- `MYSQL_DB`: Target database name (leave empty for multi-DB mode)

### Performance Configuration
- `MYSQL_POOL_SIZE`: Connection pool size (default: "10")
- `MYSQL_QUERY_TIMEOUT`: Query timeout in milliseconds (default: "30000")
- `MYSQL_CACHE_TTL`: Cache time-to-live in milliseconds (default: "60000")

### Security Configuration
- `MYSQL_RATE_LIMIT`: Maximum queries per minute (default: "100")
- `MYSQL_MAX_QUERY_COMPLEXITY`: Maximum query complexity score (default: "1000")
- `MYSQL_SSL`: Enable SSL/TLS encryption (default: "false")
- `ALLOW_INSERT_OPERATION`: Enable INSERT operations (default: "false")
- `ALLOW_UPDATE_OPERATION`: Enable UPDATE operations (default: "false")
- `ALLOW_DELETE_OPERATION`: Enable DELETE operations (default: "false")
- `ALLOW_DDL_OPERATION`: Enable DDL operations (default: "false")
- `SCHEMA_INSERT_PERMISSIONS`: Schema-specific INSERT permissions
- `SCHEMA_UPDATE_PERMISSIONS`: Schema-specific UPDATE permissions
- `SCHEMA_DELETE_PERMISSIONS`: Schema-specific DELETE permissions
- `SCHEMA_DDL_PERMISSIONS`: Schema-specific DDL permissions
- `MULTI_DB_WRITE_MODE`: Enable write operations in multi-DB mode (default: "false")

### Monitoring Configuration
- `MYSQL_ENABLE_LOGGING`: Enable query logging (default: "false")
- `MYSQL_LOG_LEVEL`: Logging level (default: "info")
- `MYSQL_METRICS_ENABLED`: Enable performance metrics (default: "false")

## Multi-DB Mode

MCP-Server-MySQL supports connecting to multiple databases when no specific database is set. This allows the LLM to query any database the MySQL user has access to. For full details, see [README-MULTI-DB.md](./README-MULTI-DB.md).

### Enabling Multi-DB Mode

To enable multi-DB mode, simply leave the `MYSQL_DB` environment variable empty. In multi-DB mode, queries require schema qualification:

```sql
-- Use fully qualified table names
SELECT * FROM database_name.table_name;

-- Or use USE statements to switch between databases
USE database_name;
SELECT * FROM table_name;
```

## Schema-Specific Permissions

For fine-grained control over database operations, MCP-Server-MySQL now supports schema-specific permissions. This allows different databases to have different levels of access (read-only, read-write, etc.).

### Configuration Example

```
SCHEMA_INSERT_PERMISSIONS=development:true,test:true,production:false
SCHEMA_UPDATE_PERMISSIONS=development:true,test:true,production:false
SCHEMA_DELETE_PERMISSIONS=development:false,test:true,production:false
SCHEMA_DDL_PERMISSIONS=development:false,test:true,production:false
```

For complete details and security recommendations, see [README-MULTI-DB.md](./README-MULTI-DB.md).

## Testing

### Database Setup

Before running tests, you need to set up the test database and seed it with test data:

1. **Create Test Database and User**
   ```sql
   -- Connect as root and create test database
   CREATE DATABASE IF NOT EXISTS mcp_test;
   
   -- Create test user with appropriate permissions
   CREATE USER IF NOT EXISTS 'mcp_test'@'localhost' IDENTIFIED BY 'mcp_test_password';
   GRANT ALL PRIVILEGES ON mcp_test.* TO 'mcp_test'@'localhost';
   FLUSH PRIVILEGES;
   ```

2. **Run Database Setup Script**
   ```bash
   # Run the database setup script
   pnpm run setup:test:db
   ```

   This will create the necessary tables and seed data. The script is located in `scripts/setup-test-db.ts`

3. **Configure Test Environment**
   Create a `.env.test` file in the project root (if not existing):
   ```env
   MYSQL_HOST=127.0.0.1
   MYSQL_PORT=3306
   MYSQL_USER=mcp_test
   MYSQL_PASS=mcp_test_password
   MYSQL_DB=mcp_test
   ```

4. **Update package.json Scripts**
   Add these scripts to your package.json:
   ```json
   {
     "scripts": {
       "setup:test:db": "ts-node scripts/setup-test-db.ts",
       "pretest": "pnpm run setup:test:db",
       "test": "vitest run",
       "test:watch": "vitest",
       "test:coverage": "vitest run --coverage"
     }
   }
   ```

### Running Tests

The project includes a comprehensive test suite to ensure functionality and reliability:

```bash
# First-time setup
pnpm run setup:test:db

# Run all tests
pnpm test
```



## Running evals

The evals package loads an mcp client that then runs the index.ts file, so there is no need to rebuild between tests. You can load environment variables by prefixing the npx command. Full documentation can be found [here](https://www.mcpevals.io/docs).

```bash
OPENAI_API_KEY=your-key  npx mcp-eval evals.ts index.ts
```
## Troubleshooting

### Common Issues

1. **Connection Issues**
   - Verify MySQL server is running and accessible
   - Check credentials and permissions
   - Ensure SSL/TLS configuration is correct if enabled
   - Try connecting with a MySQL client to confirm access

2. **Performance Issues**
   - Adjust connection pool size
   - Configure query timeout values
   - Enable query caching if needed
   - Check query complexity settings
   - Monitor server resource usage

3. **Security Restrictions**
   - Review rate limiting configuration
   - Check query whitelist/blacklist settings
   - Verify SSL/TLS settings
   - Ensure the user has appropriate MySQL permissions

4. **Path Resolution**
If you encounter an error "Could not connect to MCP server mcp-server-mysql", explicitly set the path of all required binaries:
```json
{
  "env": {
    "PATH": "/path/to/node/bin:/usr/bin:/bin"
  }
}
```

*Where can I find my `node` bin path*
Run the following command to get it:

For **PATH**
```bash
echo "$(which node)/../"    
```

For **NODE_PATH**
```bash
echo "$(which node)/../../lib/node_modules"    
```

5. **Claude Desktop Specific Issues**
   - If you see "Server disconnected" logs in Claude Desktop, check the logs at `~/Library/Logs/Claude/mcp-server-mcp_server_mysql.log`
   - Ensure you're using the absolute path to both the Node binary and the server script
   - Check if your `.env` file is being properly loaded; use explicit environment variables in the configuration
   - Try running the server directly from the command line to see if there are connection issues
   - If you need write operations (INSERT, UPDATE, DELETE), set the appropriate flags to "true" in your configuration:
     ```json
     "env": {
       "ALLOW_INSERT_OPERATION": "true",  // Enable INSERT operations
       "ALLOW_UPDATE_OPERATION": "true",  // Enable UPDATE operations
       "ALLOW_DELETE_OPERATION": "true"   // Enable DELETE operations
     }
     ```
   - Ensure your MySQL user has the appropriate permissions for the operations you're enabling
   - For direct execution configuration, use:
     ```json
     {
       "mcpServers": {
         "mcp_server_mysql": {
           "command": "/full/path/to/node",
           "args": [
             "/full/path/to/mcp-server-mysql/dist/index.js"
           ],
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

6. **Authentication Issues**
   - For MySQL 8.0+, ensure the server supports the `caching_sha2_password` authentication plugin
   - Check if your MySQL user is configured with the correct authentication method
   - Try creating a user with legacy authentication if needed:
     ```sql
     CREATE USER 'user'@'localhost' IDENTIFIED WITH mysql_native_password BY 'password';
     ```
     @lizhuangs

7. I am encountering `Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'dotenv' imported from` error
try this workaround:
```bash
npx -y -p @benborla29/mcp-server-mysql -p dotenv mcp-server-mysql
```
Thanks to @lizhuangs

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request to 
https://github.com/benborla/mcp-server-mysql

## Many Thanks to the following Contributors:
<a href = "https://github.com/benborla/mcp-server-mysql/graphs/contributors">
  <img src = "https://contrib.rocks/image?repo=benborla/mcp-server-mysql"/>
</a>

### Development Setup

1. Clone the repository
2. Install dependencies: `pnpm install`
3. Build the project: `pnpm run build`
4. Run tests: `pnpm test`

### Project Roadmap

We're actively working on enhancing this MCP server. Check our [CHANGELOG.md](./CHANGELOG.md) for details on planned features, including:

- Enhanced query capabilities with prepared statements
- Advanced security features
- Performance optimizations
- Comprehensive monitoring
- Expanded schema information

If you'd like to contribute to any of these areas, please check the issues on GitHub or open a new one to discuss your ideas.

### Submitting Changes

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/your-feature-name`
3. Commit your changes: `git commit -am 'Add some feature'`
4. Push to the branch: `git push origin feature/your-feature-name`
5. Submit a pull request

## License

This MCP server is licensed under the MIT License. See the LICENSE file for details.


## Guide
$ npm i
$ npm run dev
$ npm run build
$ npm run start
### debug
$ npx @modelcontextprotocol/inspector

### Cloud build
$ node --env-file=".env" docker_deploy_gcp_cloud_build.js