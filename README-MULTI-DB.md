# Multi-DB Mode and Schema-Specific Permissions

This document describes the new multi-database mode and schema-specific permissions features added to the MCP-Server-MySQL.

## Multi-DB Mode

MCP-Server-MySQL now supports working with multiple databases simultaneously when no specific database is set in the configuration.

### How to Enable Multi-DB Mode

To enable multi-DB mode, simply leave the `MYSQL_DB` environment variable empty:

```json
{
  "mcpServers": {
    "mcp_server_mysql": {
      "env": {
        "MYSQL_HOST": "127.0.0.1",
        "MYSQL_PORT": "3306",
        "MYSQL_USER": "root",
        "MYSQL_PASS": "your_password",
        "MYSQL_DB": "", // Empty to enable multi-DB mode
        ...
      }
    }
  }
}
```

### Features in Multi-DB Mode

1. **List All Databases**: In multi-DB mode, the server will list resources from all available databases when the LLM requests database schemas.

2. **Query Any Database**: You can execute queries against any database to which the MySQL user has access.

3. **Schema Qualification Required**: When working in multi-DB mode, you should use fully qualified table names with schema/database prefixes:

   ```sql
   -- Use fully qualified table names
   SELECT * FROM database_name.table_name;
   
   -- Or use USE statements to switch between databases
   USE database_name;
   SELECT * FROM table_name;
   ```

4. **Automatic Read-Only Mode**: For safety, multi-DB mode enforces read-only operations by default. This can be customized using schema-specific permissions (see below).

5. **Database Exploration**: You can explore databases using commands like:

   ```sql
   -- List all databases
   SHOW DATABASES;
   
   -- List tables in a specific database
   SHOW TABLES FROM database_name;
   
   -- Describe a table's structure
   DESCRIBE database_name.table_name;
   ```

## Schema-Specific Permissions

This new feature allows fine-grained control over which operations are allowed on specific database schemas.

### Available Permission Types

1. **INSERT Permissions**: Control which schemas can have new records inserted.
2. **UPDATE Permissions**: Control which schemas can have records updated.
3. **DELETE Permissions**: Control which schemas can have records deleted.
4. **DDL Permissions**: Control which schemas can have their structure modified (CREATE, ALTER, DROP, TRUNCATE).

### How to Configure Schema-Specific Permissions

Set the following environment variables with a comma-separated list of schema:permission pairs:

```txt
SCHEMA_INSERT_PERMISSIONS=production:false,development:true,test:true
SCHEMA_UPDATE_PERMISSIONS=production:false,development:true,test:true
SCHEMA_DELETE_PERMISSIONS=production:false,development:false,test:true
SCHEMA_DDL_PERMISSIONS=production:false,development:false,test:true
```

This configuration:

- Allows INSERT and UPDATE on development and test databases, but not production
- Allows DELETE and DDL operations only on the test database
- Blocks all write operations on the production database

### Example Configuration

Here's a complete example configuration with schema-specific permissions:

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
        "MYSQL_DB": "", // Empty for multi-DB mode
        
        // Global defaults (apply when no schema-specific permission is set)
        "ALLOW_INSERT_OPERATION": "false",
        "ALLOW_UPDATE_OPERATION": "false",
        "ALLOW_DELETE_OPERATION": "false",
        "ALLOW_DDL_OPERATION": "false",
        
        // Schema-specific permissions
        "SCHEMA_INSERT_PERMISSIONS": "dev_db:true,test_db:true,prod_db:false",
        "SCHEMA_UPDATE_PERMISSIONS": "dev_db:true,test_db:true,prod_db:false",
        "SCHEMA_DELETE_PERMISSIONS": "dev_db:false,test_db:true,prod_db:false",
        "SCHEMA_DDL_PERMISSIONS": "dev_db:false,test_db:true,prod_db:false"
      }
    }
  }
}
```

### Permission Resolution Logic

1. If a schema-specific permission is set, it takes precedence over the global setting.
2. If no schema-specific permission is found, the global setting (`ALLOW_X_OPERATION`) is used.
3. In multi-DB mode, if a query doesn't specify a schema and one can't be determined from context, only read operations are allowed for safety.

## Environment Variables Summary

### Multi-DB Mode

- `MYSQL_DB`: Leave empty to enable multi-DB mode
- `MULTI_DB_WRITE_MODE`: Set to "true" to allow write operations in multi-DB mode without schema-specific permissions (not recommended for security)

### Schema-Specific Permissions

- `SCHEMA_INSERT_PERMISSIONS`: Control INSERT permissions per schema
- `SCHEMA_UPDATE_PERMISSIONS`: Control UPDATE permissions per schema
- `SCHEMA_DELETE_PERMISSIONS`: Control DELETE permissions per schema
- `SCHEMA_DDL_PERMISSIONS`: Control DDL permissions per schema (CREATE, ALTER, DROP, TRUNCATE)

### Global Permission Defaults

- `ALLOW_INSERT_OPERATION`: Global default for INSERT permissions
- `ALLOW_UPDATE_OPERATION`: Global default for UPDATE permissions
- `ALLOW_DELETE_OPERATION`: Global default for DELETE permissions
- `ALLOW_DDL_OPERATION`: Global default for DDL permissions

## Security Considerations

1. **Default to Principle of Least Privilege**: By default, all write operations are disabled globally and must be explicitly enabled.

2. **Isolation in Multi-DB Mode**: Consider using a dedicated MySQL user with limited database grants when using multi-DB mode.

3. **Careful with DDL Permissions**: DDL operations can modify database structure, so grant these permissions cautiously.

4. **Production Databases**: Always set `schema:false` for production database schemas in all write permission settings.

5. **User Least Privilege**: Ensure the MySQL user only has the required permissions on the specific databases needed.
