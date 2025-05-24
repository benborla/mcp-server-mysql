#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import * as mysql2 from "mysql2/promise";
import * as dotenv from "dotenv";
import SqlParser, { AST } from 'node-sql-parser';
import { log } from './utils/index.js';

interface SchemaPermissions {
  [schema: string]: boolean
}

export interface TableRow {
  table_name: string
}

export interface ColumnRow {
  column_name: string
  data_type: string
}

// @INFO: Load environment variables from .env file
dotenv.config()

log('info', 'Starting MCP server...')


// @INFO: Update the environment setup to ensure database is correctly set
if (process.env.NODE_ENV === 'test' && !process.env.MYSQL_DB) {
  process.env.MYSQL_DB = 'mcp_test_db' // @INFO: Ensure we have a database name for tests
}

// Write operation flags (global defaults)
const ALLOW_INSERT_OPERATION = process.env.ALLOW_INSERT_OPERATION === 'true'
const ALLOW_UPDATE_OPERATION = process.env.ALLOW_UPDATE_OPERATION === 'true'
const ALLOW_DELETE_OPERATION = process.env.ALLOW_DELETE_OPERATION === 'true'
const ALLOW_DDL_OPERATION = process.env.ALLOW_DDL_OPERATION === 'true'

// Schema-specific permissions
const SCHEMA_INSERT_PERMISSIONS: SchemaPermissions = parseSchemaPermissions(process.env.SCHEMA_INSERT_PERMISSIONS)
const SCHEMA_UPDATE_PERMISSIONS: SchemaPermissions = parseSchemaPermissions(process.env.SCHEMA_UPDATE_PERMISSIONS)
const SCHEMA_DELETE_PERMISSIONS: SchemaPermissions = parseSchemaPermissions(process.env.SCHEMA_DELETE_PERMISSIONS)
const SCHEMA_DDL_PERMISSIONS: SchemaPermissions = parseSchemaPermissions(process.env.SCHEMA_DDL_PERMISSIONS)

// Check if we're in multi-DB mode (no specific DB set)
const isMultiDbMode = !process.env.MYSQL_DB || process.env.MYSQL_DB.trim() === ''

// Force read-only mode in multi-DB mode unless explicitly configured otherwise
if (isMultiDbMode && process.env.MULTI_DB_WRITE_MODE !== 'true') {
  log('error', 'Multi-DB mode detected - enabling read-only mode for safety')
}

// @INFO: Check if running in test mode
const isTestEnvironment =
  process.env.NODE_ENV === 'test' || process.env.VITEST

// @INFO: Safe way to exit process (not during tests)
function safeExit(code: number): void {
  if (!isTestEnvironment) {
    process.exit(code)
  } else {
    log('error', `[Test mode] Would have called process.exit(${code})`)
  }
}

// Function to parse schema-specific permissions from environment variables
function parseSchemaPermissions(permissionsString?: string): SchemaPermissions {
  const permissions: SchemaPermissions = {}
  
  if (!permissionsString) {
    return permissions
  }
  
  // Format: "schema1:true,schema2:false"
  const permissionPairs = permissionsString.split(',')
  
  for (const pair of permissionPairs) {
    const [schema, value] = pair.split(':')
    if (schema && value) {
      permissions[schema.trim()] = value.trim() === 'true'
    }
  }
  
  return permissions
}

// Schema permission checking functions
function isInsertAllowedForSchema(schema: string | null): boolean {
  if (!schema) {
    return ALLOW_INSERT_OPERATION
  }
  return schema in SCHEMA_INSERT_PERMISSIONS 
    ? SCHEMA_INSERT_PERMISSIONS[schema] 
    : ALLOW_INSERT_OPERATION
}

function isUpdateAllowedForSchema(schema: string | null): boolean {
  if (!schema) {
    return ALLOW_UPDATE_OPERATION
  }
  return schema in SCHEMA_UPDATE_PERMISSIONS 
    ? SCHEMA_UPDATE_PERMISSIONS[schema] 
    : ALLOW_UPDATE_OPERATION
}

function isDeleteAllowedForSchema(schema: string | null): boolean {
  if (!schema) {
    return ALLOW_DELETE_OPERATION
  }
  return schema in SCHEMA_DELETE_PERMISSIONS 
    ? SCHEMA_DELETE_PERMISSIONS[schema] 
    : ALLOW_DELETE_OPERATION
}

function isDDLAllowedForSchema(schema: string | null): boolean {
  if (!schema) {
    return ALLOW_DDL_OPERATION
  }
  return schema in SCHEMA_DDL_PERMISSIONS 
    ? SCHEMA_DDL_PERMISSIONS[schema] 
    : ALLOW_DDL_OPERATION
}

// Extract schema from SQL query
function extractSchemaFromQuery(sql: string): string | null {
  // Default schema from environment
  const defaultSchema = process.env.MYSQL_DB || null
  
  // If we have a default schema and not in multi-DB mode, return it
  if (defaultSchema && !isMultiDbMode) {
    return defaultSchema
  }
  
  // Try to extract schema from query
  
  // Case 1: USE database statement
  const useMatch = sql.match(/USE\s+`?([a-zA-Z0-9_]+)`?/i)
  if (useMatch && useMatch[1]) {
    return useMatch[1]
  }
  
  // Case 2: database.table notation
  const dbTableMatch = sql.match(/`?([a-zA-Z0-9_]+)`?\.`?[a-zA-Z0-9_]+`?/i)
  if (dbTableMatch && dbTableMatch[1]) {
    return dbTableMatch[1]
  }
  
  // Return default if we couldn't find a schema in the query
  return defaultSchema
}

// Update tool description to include multi-DB mode and schema-specific permissions
let toolDescription = 'Run SQL queries against MySQL database'

if (isMultiDbMode) {
  toolDescription += ' (Multi-DB mode enabled)'
}

if (ALLOW_INSERT_OPERATION || ALLOW_UPDATE_OPERATION || ALLOW_DELETE_OPERATION || ALLOW_DDL_OPERATION) {
  // At least one write operation is enabled
  toolDescription += ' with support for:'
  
  if (ALLOW_INSERT_OPERATION) {
    toolDescription += ' INSERT,'
  }
  
  if (ALLOW_UPDATE_OPERATION) {
    toolDescription += ' UPDATE,'
  }
  
  if (ALLOW_DELETE_OPERATION) {
    toolDescription += ' DELETE,'
  }
  
  if (ALLOW_DDL_OPERATION) {
    toolDescription += ' DDL,'
  }
  
  // Remove trailing comma and add READ operations
  toolDescription = toolDescription.replace(/,$/, '') + ' and READ operations'
  
  if (Object.keys(SCHEMA_INSERT_PERMISSIONS).length > 0 ||
      Object.keys(SCHEMA_UPDATE_PERMISSIONS).length > 0 ||
      Object.keys(SCHEMA_DELETE_PERMISSIONS).length > 0 ||
      Object.keys(SCHEMA_DDL_PERMISSIONS).length > 0) {
    toolDescription += ' (Schema-specific permissions enabled)'
  }
} else {
  // Only read operations are allowed
  toolDescription += ' (READ-ONLY)'
}

// Update MySQL config to handle blank database name and Unix socket connections
const config = {
  server: {
    name: '@benborla29/mcp-server-mysql',
    version: '0.1.18',
    connectionTypes: ['stdio'],
  },
  mysql: {
    // Use Unix socket if provided, otherwise use host/port
    ...(process.env.MYSQL_SOCKET_PATH
      ? {
          socketPath: process.env.MYSQL_SOCKET_PATH,
        }
      : {
          host: process.env.MYSQL_HOST || '127.0.0.1',
          port: Number(process.env.MYSQL_PORT || '3306'),
        }
    ),
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASS || 'root',
    database: process.env.MYSQL_DB || undefined, // Allow undefined database for multi-DB mode
    connectionLimit: 10,
    authPlugins: {
      mysql_clear_password: () => () =>
        Buffer.from(process.env.MYSQL_PASS || 'root'),
    },
    ...(process.env.MYSQL_SSL === 'true'
      ? {
          ssl: {
            rejectUnauthorized:
              process.env.MYSQL_SSL_REJECT_UNAUTHORIZED === 'true',
          },
        }
      : {}),
  },
  paths: {
    schema: 'schema',
  },
}

// @INFO: Add debug logging for configuration
log('info', 'MySQL Configuration:', JSON.stringify(
  {
    ...(process.env.MYSQL_SOCKET_PATH
      ? {
          socketPath: process.env.MYSQL_SOCKET_PATH,
          connectionType: 'Unix Socket',
        }
      : {
          host: process.env.MYSQL_HOST || '127.0.0.1',
          port: process.env.MYSQL_PORT || '3306',
          connectionType: 'TCP/IP',
        }
    ),
    user: config.mysql.user,
    password: config.mysql.password ? '******' : 'not set',
    database: config.mysql.database || 'MULTI_DB_MODE',
    ssl: process.env.MYSQL_SSL === 'true' ? 'enabled' : 'disabled',
    multiDbMode: isMultiDbMode ? 'enabled' : 'disabled',
  },
  null,
  2,
))

// @INFO: Lazy load MySQL pool
let poolPromise: Promise<mysql2.Pool>
const getPool = (): Promise<mysql2.Pool> => {
  if (!poolPromise) {
    poolPromise = new Promise<mysql2.Pool>((resolve, reject) => {
      try {
        const pool = mysql2.createPool(config.mysql)
        log('info', 'MySQL pool created successfully')
        resolve(pool)
      } catch (error) {
        log('error', 'Error creating MySQL pool:', error)
        reject(error)
      }
    })
  }
  return poolPromise
}

// @INFO: Lazy load server instance
let serverInstance: Promise<Server> | null = null
const getServer = (): Promise<Server> => {
  if (!serverInstance) {
    serverInstance = new Promise<Server>((resolve) => {
      const server = new Server(config.server, {
        capabilities: {
          resources: {},
          tools: {
            mysql_query: {
              description: toolDescription,
              inputSchema: {
                type: 'object',
                properties: {
                  sql: {
                    type: 'string',
                    description: 'The SQL query to execute',
                  },
                },
                required: ['sql'],
              },
            },
          },
        },
      })

      // @INFO: Register request handlers
      server.setRequestHandler(
        ListResourcesRequestSchema,
        async () => {
          try {
            log('error', 'Handling ListResourcesRequest')

            // Determine connection info for URI
            const connectionInfo = process.env.MYSQL_SOCKET_PATH 
            ? `socket:${process.env.MYSQL_SOCKET_PATH}`
            : `${process.env.MYSQL_HOST || '127.0.0.1'}:${process.env.MYSQL_PORT || '3306'}`;
            
            // If we're in multi-DB mode, list all databases first
            if (isMultiDbMode) {
              const databases = (await executeQuery(
                'SHOW DATABASES'
              )) as { Database: string }[]
              
              // For each database, list tables
              let allResources = []
              
              for (const db of databases) {
                // Skip system databases
                if (['information_schema', 'mysql', 'performance_schema', 'sys'].includes(db.Database)) {
                  continue
                }
                
                const tables = (await executeQuery(
                  `SELECT table_name FROM information_schema.tables WHERE table_schema = '${db.Database}'`
                )) as TableRow[]
                
                allResources.push(...tables.map((row: TableRow) => ({
                  uri: new URL(
                    `${db.Database}/${row.table_name}/${config.paths.schema}`,
                    connectionInfo,
                  ).href,
                  mimeType: 'application/json',
                  name: `"${db.Database}.${row.table_name}" database schema`,
                })))
              }
              
              return {
                resources: allResources,
              }
            } else {
              // Original behavior for single database mode
              const results = (await executeQuery(
                'SELECT table_name FROM information_schema.tables WHERE table_schema = DATABASE()',
              )) as TableRow[]

              return {
                resources: results.map((row: TableRow) => ({
                  uri: new URL(
                    `${row.table_name}/${config.paths.schema}`,
                    connectionInfo,
                  ).href,
                  mimeType: 'application/json',
                  name: `"${row.table_name}" database schema`,
                })),
              }
            }
          } catch (error) {
            log('error', 'Error in ListResourcesRequest handler:', error)
            throw error
          }
        },
      )

      server.setRequestHandler(
        ReadResourceRequestSchema,
        async (request) => {
          try {
            log('error', 'Handling ReadResourceRequest')
            const resourceUrl = new URL(request.params.uri)
            const pathComponents = resourceUrl.pathname.split('/')
            const schema = pathComponents.pop()
            const tableName = pathComponents.pop()
            let dbName = null
            
            // In multi-DB mode, we expect a database name in the path
            if (isMultiDbMode && pathComponents.length > 0) {
              dbName = pathComponents.pop() || null
            }

            if (schema !== config.paths.schema) {
              throw new Error('Invalid resource URI')
            }
            
            // Modify query to include schema information
            let columnsQuery = 'SELECT column_name, data_type FROM information_schema.columns WHERE table_name = ?'
            let queryParams = [tableName as string]
            
            if (dbName) {
              columnsQuery += ' AND table_schema = ?'
              queryParams.push(dbName)
            }

            const results = (await executeQuery(
              columnsQuery,
              queryParams,
            )) as ColumnRow[]

            return {
              contents: [
                {
                  uri: request.params.uri,
                  mimeType: 'application/json',
                  text: JSON.stringify(results, null, 2),
                },
              ],
            }
          } catch (error) {
            log('error', 'Error in ReadResourceRequest handler:', error)
            throw error
          }
        },
      )

      server.setRequestHandler(ListToolsRequestSchema, async () => {
        log('error', 'Handling ListToolsRequest')
        
        const toolsResponse = {
          tools: [
            {
              name: 'mysql_query',
              description: toolDescription,
              inputSchema: {
                type: 'object',
                properties: {
                  sql: {
                    type: 'string',
                    description: 'The SQL query to execute',
                  },
                },
                required: ['sql'],
              },
            },
          ],
        }
        
        log('error',
          'ListToolsRequest response:',
          JSON.stringify(toolsResponse, null, 2),
        )
        return toolsResponse
      })

      server.setRequestHandler(
        CallToolRequestSchema,
        async (request) => {
          try {
            log('error', 'Handling CallToolRequest:', request.params.name)
            if (request.params.name !== 'mysql_query') {
              throw new Error(`Unknown tool: ${request.params.name}`)
            }

            const sql = request.params.arguments?.sql as string
            return executeReadOnlyQuery(sql)
          } catch (error) {
            log('error', 'Error in CallToolRequest handler:', error)
            throw error
          }
        },
      )

      resolve(server)
    })
  }
  return serverInstance
}

const { Parser } = SqlParser;
const parser = new Parser();

async function getQueryTypes(query: string): Promise<string[]> {
  try {
    log('error', "Parsing SQL query: ", query);
    // Parse into AST or array of ASTs - only specify the database type
    const astOrArray: AST | AST[] = parser.astify(query, { database: 'mysql' });
    const statements = Array.isArray(astOrArray) ? astOrArray : [astOrArray];

    log('error', "Parsed SQL AST: ", statements.map(stmt => stmt.type?.toLowerCase() ?? 'unknown'));
    
    // Map each statement to its lowercased type (e.g., 'select', 'update', 'insert', 'delete', etc.)
    return statements.map(stmt => stmt.type?.toLowerCase() ?? 'unknown');
  } catch (err: any) {
    log('error', "sqlParser error, query: ", query);
    log('error', 'Error parsing SQL query:', err);
    throw new Error(`Parsing failed: ${err.message}`);
  }
}

async function executeQuery<T>(
  sql: string,
  params: string[] = [],
): Promise<T> {
  let connection
  try {
    const pool = await getPool()
    connection = await pool.getConnection()
    const result = await connection.query(sql.toLocaleLowerCase(), params)
    return (Array.isArray(result) ? result[0] : result) as T
  } catch (error) {
    log('error', 'Error executing query:', error)
    throw error
  } finally {
    if (connection) {
      connection.release()
      log('error', 'Connection released')
    }
  }
}

async function executeReadOnlyQuery<T>(sql: string): Promise<T> {
  let connection
  try {
    // Check the type of query
    const queryTypes = await getQueryTypes(sql);
    
    // Get schema for permission checking
    const schema = extractSchemaFromQuery(sql)
    
    const isUpdateOperation = queryTypes.some(type => ['update'].includes(type)); 
    const isInsertOperation = queryTypes.some(type => ['insert'].includes(type)); 
    const isDeleteOperation = queryTypes.some(type => ['delete'].includes(type));
    const isDDLOperation = queryTypes.some(type => 
      ['create', 'alter', 'drop', 'truncate'].includes(type));
    
    // Check schema-specific permissions
    if (isInsertOperation && !isInsertAllowedForSchema(schema)) {
      log(
        'error',
        `INSERT operations are not allowed for schema '${schema || 'default'}'. Configure SCHEMA_INSERT_PERMISSIONS.`,
      )
      return {
        content: [
          {
            type: 'text',
            text: `Error: INSERT operations are not allowed for schema '${schema || 'default'}'. Ask the administrator to update SCHEMA_INSERT_PERMISSIONS.`,
          },
        ],
        isError: true,
      } as T
    }
    
    if (isUpdateOperation && !isUpdateAllowedForSchema(schema)) {
      log(
        'error',
        `UPDATE operations are not allowed for schema '${schema || 'default'}'. Configure SCHEMA_UPDATE_PERMISSIONS.`,
      )
      return {
        content: [
          {
            type: 'text',
            text: `Error: UPDATE operations are not allowed for schema '${schema || 'default'}'. Ask the administrator to update SCHEMA_UPDATE_PERMISSIONS.`,
          },
        ],
        isError: true,
      } as T
    }
    
    if (isDeleteOperation && !isDeleteAllowedForSchema(schema)) {
      log(
        'error',
        `DELETE operations are not allowed for schema '${schema || 'default'}'. Configure SCHEMA_DELETE_PERMISSIONS.`,
      )
      return {
        content: [
          {
            type: 'text',
            text: `Error: DELETE operations are not allowed for schema '${schema || 'default'}'. Ask the administrator to update SCHEMA_DELETE_PERMISSIONS.`,
          },
        ],
        isError: true,
      } as T
    }
    
    if (isDDLOperation && !isDDLAllowedForSchema(schema)) {
      log(
        'error',
        `DDL operations are not allowed for schema '${schema || 'default'}'. Configure SCHEMA_DDL_PERMISSIONS.`,
      )
      return {
        content: [
          {
            type: 'text',
            text: `Error: DDL operations are not allowed for schema '${schema || 'default'}'. Ask the administrator to update SCHEMA_DDL_PERMISSIONS.`,
          },
        ],
        isError: true,
      } as T
    }

    // For write operations that are allowed, use executeWriteQuery
    if (
      (isInsertOperation && isInsertAllowedForSchema(schema)) ||
      (isUpdateOperation && isUpdateAllowedForSchema(schema)) ||
      (isDeleteOperation && isDeleteAllowedForSchema(schema)) ||
      (isDDLOperation && isDDLAllowedForSchema(schema))
    ) {
      return executeWriteQuery(sql)
    }
    
    // For read-only operations, continue with the original logic
    const pool = await getPool()
    connection = await pool.getConnection()
    log('error', 'Read-only connection acquired')

    // Set read-only mode
    await connection.query('SET SESSION TRANSACTION READ ONLY')

    // Begin transaction
    await connection.beginTransaction()

    try {
      // Execute query - in multi-DB mode, we may need to handle USE statements specially
      const result = await connection.query(sql.toLocaleLowerCase())
      const rows = Array.isArray(result) ? result[0] : result

      // Rollback transaction (since it's read-only)
      await connection.rollback()

      // Reset to read-write mode
      await connection.query('SET SESSION TRANSACTION READ WRITE')

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(rows, null, 2),
          },
        ],
        isError: false,
      } as T
    } catch (error) {
      // Rollback transaction on query error
      log('error', 'Error executing read-only query:', error)
      await connection.rollback()
      throw error
    }
  } catch (error) {
    // Ensure we rollback and reset transaction mode on any error
    log('error', 'Error in read-only query transaction:', error)
    try {
      if (connection) {
        await connection.rollback()
        await connection.query('SET SESSION TRANSACTION READ WRITE')
      }
    } catch (cleanupError) {
      // Ignore errors during cleanup
      log('error', 'Error during cleanup:', cleanupError)
    }
    throw error
  } finally {
    if (connection) {
      connection.release()
      log('error', 'Read-only connection released')
    }
  }
}

// @INFO: New function to handle write operations
async function executeWriteQuery<T>(sql: string): Promise<T> {
  let connection
  try {
    const pool = await getPool()
    connection = await pool.getConnection()
    log('error', 'Write connection acquired')

    // Extract schema for permissions (if needed)
    const schema = extractSchemaFromQuery(sql)

    // @INFO: Begin transaction for write operation
    await connection.beginTransaction()

    try {
      // @INFO: Execute the write query
      const result = await connection.query(sql.toLocaleLowerCase())
      const response = Array.isArray(result) ? result[0] : result
      
      // @INFO: Commit the transaction
      await connection.commit()
      
      // @INFO: Format the response based on operation type
      let responseText
      
      // Check the type of query
      const queryTypes = await getQueryTypes(sql);
      const isUpdateOperation = queryTypes.some(type => ['update'].includes(type)); 
      const isInsertOperation = queryTypes.some(type => ['insert'].includes(type)); 
      const isDeleteOperation = queryTypes.some(type => ['delete'].includes(type));
      const isDDLOperation = queryTypes.some(type => 
        ['create', 'alter', 'drop', 'truncate'].includes(type));
    

      // @INFO: Type assertion for ResultSetHeader which has affectedRows, insertId, etc.
      if (isInsertOperation) {
        const resultHeader = response as mysql2.ResultSetHeader
        responseText = `Insert successful on schema '${schema || 'default'}'. Affected rows: ${resultHeader.affectedRows}, Last insert ID: ${resultHeader.insertId}`
      } else if (isUpdateOperation) {
        const resultHeader = response as mysql2.ResultSetHeader
        responseText = `Update successful on schema '${schema || 'default'}'. Affected rows: ${resultHeader.affectedRows}, Changed rows: ${resultHeader.changedRows || 0}`
      } else if (isDeleteOperation) {
        const resultHeader = response as mysql2.ResultSetHeader
        responseText = `Delete successful on schema '${schema || 'default'}'. Affected rows: ${resultHeader.affectedRows}`
      } else if (isDDLOperation) {
        responseText = `DDL operation successful on schema '${schema || 'default'}'.`
      } else {
        responseText = JSON.stringify(response, null, 2)
      }

      return {
        content: [
          {
            type: 'text',
            text: responseText,
          },
        ],
        isError: false,
      } as T
    } catch (error: unknown) {
      // @INFO: Rollback on error
      log('error', 'Error executing write query:', error)
      await connection.rollback()
      
      return {
        content: [
          {
            type: 'text',
            text: `Error executing write operation: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      } as T
    }
  } catch (error: unknown) {
    log('error', 'Error in write operation transaction:', error)
    return {
      content: [
        {
          type: 'text',
          text: `Database connection error: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    } as T
  } finally {
    if (connection) {
      connection.release()
      log('error', 'Write connection released')
    }
  }
}

// @INFO: Add exports for the query functions
export { executeQuery, executeReadOnlyQuery, executeWriteQuery, getServer }

// @INFO: Server startup and shutdown
async function runServer(): Promise<void> {
  try {
    log('error', 'Attempting to test database connection...')
    // @INFO: Test the connection before fully starting the server
    const pool = await getPool()
    const connection = await pool.getConnection()
    log('error', 'Database connection test successful')
    connection.release()
    
    const server = await getServer()
    const transport = new StdioServerTransport()
    log('error', 'Connecting server to transport...')
    await server.connect(transport)
    log('error', 'Server connected to transport successfully')
  } catch (error) {
    log('error', 'Fatal error during server startup:', error)
    safeExit(1)
  }
}

const shutdown = async (signal: string): Promise<void> => {
  log('error', `Received ${signal}. Shutting down...`)
  try {
    // @INFO: Only attempt to close the pool if it was created
    if (poolPromise) {
      const pool = await poolPromise
      await pool.end()
      log('error', 'MySQL pool closed successfully')
    }
  } catch (err) {
    log('error', 'Error closing pool:', err)
    throw err
  }
}

process.on('SIGINT', async () => {
  try {
    await shutdown('SIGINT')
    process.exit(0)
  } catch (err) {
    log('error', 'Error during SIGINT shutdown:', err)
    safeExit(1)
  }
})

process.on('SIGTERM', async () => {
  try {
    await shutdown('SIGTERM')
    process.exit(0)
  } catch (err) {
    log('error', 'Error during SIGTERM shutdown:', err)
    safeExit(1)
  }
})

// @INFO: Add unhandled error listeners
process.on('uncaughtException', (error) => {
  log('error', 'Uncaught exception:', error)
  safeExit(1)
})

process.on('unhandledRejection', (reason, promise) => {
  log('error', 'Unhandled rejection at:', promise, 'reason:', reason)
  safeExit(1)
})

runServer().catch((error: unknown) => {
  log('error', 'Server error:', error)
  safeExit(1)
})
