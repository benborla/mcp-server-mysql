#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { log } from "./src/utils/index.js";
import type { TableRow, ColumnRow } from "./src/types/index.js";
import {
  ALLOW_DELETE_OPERATION,
  ALLOW_DDL_OPERATION,
  ALLOW_INSERT_OPERATION,
  ALLOW_UPDATE_OPERATION,
  SCHEMA_DELETE_PERMISSIONS,
  SCHEMA_DDL_PERMISSIONS,
  SCHEMA_INSERT_PERMISSIONS,
  SCHEMA_UPDATE_PERMISSIONS,
  isMultiDbMode,
  mcpConfig as config,
  MCP_VERSION as version,
  IS_REMOTE_MCP,
  REMOTE_SECRET_KEY,
  ENABLE_PII_REDACTION,
  PII_EXTRA_COLUMNS,
  PII_EXTRA_COLUMN_PATTERNS,
} from "./src/config/index.js";
import { isPIIColumn, DEFAULT_PII_COLUMNS } from "./src/security/redact.js";
import {
  safeExit,
  executeQuery,
  executeReadOnlyQuery,
} from "./src/db/index.js";

import { startHttpServer, resolveHttpOptions } from "./src/http/index.js";
import { runProcessSetup } from "./src/setup/index.js";
import { fileURLToPath } from 'url';
import { realpathSync } from 'fs';


log("info", `Starting MySQL MCP server v${version}...`);

// Update tool description to include multi-DB mode and schema-specific permissions
const toolVersion = `MySQL MCP Server [v${process.env.npm_package_version}]`;
let toolDescription = `[${toolVersion}] Run SQL queries against MySQL database`;

if (isMultiDbMode) {
  toolDescription += " (Multi-DB mode enabled)";
}

if (
  ALLOW_INSERT_OPERATION ||
  ALLOW_UPDATE_OPERATION ||
  ALLOW_DELETE_OPERATION ||
  ALLOW_DDL_OPERATION
) {
  // At least one write operation is enabled
  toolDescription += " with support for:";

  if (ALLOW_INSERT_OPERATION) {
    toolDescription += " INSERT,";
  }

  if (ALLOW_UPDATE_OPERATION) {
    toolDescription += " UPDATE,";
  }

  if (ALLOW_DELETE_OPERATION) {
    toolDescription += " DELETE,";
  }

  if (ALLOW_DDL_OPERATION) {
    toolDescription += " DDL,";
  }

  // Remove trailing comma and add READ operations
  toolDescription = toolDescription.replace(/,$/, "") + " and READ operations";

  if (
    Object.keys(SCHEMA_INSERT_PERMISSIONS).length > 0 ||
    Object.keys(SCHEMA_UPDATE_PERMISSIONS).length > 0 ||
    Object.keys(SCHEMA_DELETE_PERMISSIONS).length > 0 ||
    Object.keys(SCHEMA_DDL_PERMISSIONS).length > 0
  ) {
    toolDescription += " (Schema-specific permissions enabled)";
  }
} else {
  // Only read operations are allowed
  toolDescription += " (READ-ONLY)";
}

// Determine if we're in read-only mode (no write operations enabled)
const isReadOnly = !(
  ALLOW_INSERT_OPERATION ||
  ALLOW_UPDATE_OPERATION ||
  ALLOW_DELETE_OPERATION ||
  ALLOW_DDL_OPERATION
);

// @INFO: Add debug logging for configuration
log(
  "info",
  "MySQL Configuration:",
  JSON.stringify(
    {
      ...(process.env.MYSQL_SOCKET_PATH
        ? {
            socketPath: process.env.MYSQL_SOCKET_PATH,
            connectionType: "Unix Socket",
          }
        : {
            host: process.env.MYSQL_HOST || "127.0.0.1",
            port: process.env.MYSQL_PORT || "3306",
            connectionType: "TCP/IP",
          }),
      user: config.mysql.user,
      password: config.mysql.password ? "******" : "not set",
      database: config.mysql.database || "MULTI_DB_MODE",
      ssl: process.env.MYSQL_SSL === "true" ? "enabled" : "disabled",
      sslCA: process.env.MYSQL_SSL_CA || "not set",
      sslCert: process.env.MYSQL_SSL_CERT || "not set",
      sslKey: process.env.MYSQL_SSL_KEY || "not set",
      multiDbMode: isMultiDbMode ? "enabled" : "disabled",
    },
    null,
    2,
  ),
);

// Define configuration schema
export const configSchema = z.object({
  debug: z.boolean().default(false).describe("Enable debug logging"),
});

// Export the default function that creates and returns the MCP server
export default function createMcpServer({
  sessionId,
  config,
}: {
  sessionId?: string;
  config: z.infer<typeof configSchema>;
}) {
  // Create the server instance
  const server = new Server(
    {
      name: "MySQL MCP Server",
      version: process.env.npm_package_version || "1.0.0",
    },
    {
      capabilities: {
        resources: {},
        tools: {
          mysql_query: {
            description: toolDescription,
            inputSchema: {
              type: "object",
              properties: {
                sql: {
                  type: "string",
                  description: "The SQL query to execute",
                },
              },
              required: ["sql"],
            },
            annotations: {
              readOnlyHint: isReadOnly,
              idempotentHint: isReadOnly,
              destructiveHint: !isReadOnly,
              openWorldHint: false,
              title: "MySQL Query",
            },
          },
        },
      },
    },
  );

  // Register request handlers for resources
  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    try {
      log("info", "Handling ListResourcesRequest");
      const connectionInfo = process.env.MYSQL_SOCKET_PATH
        ? `socket: ${process.env.MYSQL_SOCKET_PATH}`
        : `host: ${process.env.MYSQL_HOST || "localhost"}, port: ${
            process.env.MYSQL_PORT || 3306
          }`;
      log("info", `Connection info: ${connectionInfo}`);

      // Query to get all tables
      const tablesQuery = `
      SELECT
        table_name as name,
        table_schema as \`database\`,
        table_comment as description,
        table_rows as rowCount,
        data_length as dataSize,
        index_length as indexSize,
        create_time as createTime,
        update_time as updateTime
      FROM
        information_schema.tables
      WHERE
        table_schema NOT IN ('information_schema', 'mysql', 'performance_schema', 'sys')
      ORDER BY
        table_schema, table_name
    `;

      const queryResult = (await executeReadOnlyQuery<any>(tablesQuery));
      const tables = JSON.parse(queryResult.content[0].text) as TableRow[];
      log("info", `Found ${tables.length} tables`);

      // Create resources for each table
      const resources = tables.map((table) => ({
        uri: `mysql://tables/${table.name}`,
        name: table.name,
        title: `${table.database}.${table.name}`,
        description:
          table.description ||
          `Table ${table.name} in database ${table.database}`,
        mimeType: "application/json",
      }));

      // Add a resource for the list of tables
      resources.push({
        uri: "mysql://tables",
        name: "Tables",
        title: "MySQL Tables",
        description: "List of all MySQL tables",
        mimeType: "application/json",
      });

      return { resources };
    } catch (error) {
      log("error", "Error in ListResourcesRequest handler:", error);
      throw error;
    }
  });

  // Register request handler for reading resources
  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    try {
      log("info", "Handling ReadResourceRequest:", request.params.uri);

      // Parse the URI to extract table name and optional database name
      const uriParts = request.params.uri.split("/");
      const tableName = uriParts.pop();
      const dbName = uriParts.length > 0 ? uriParts.pop() : null;

      if (!tableName) {
        throw new Error(`Invalid resource URI: ${request.params.uri}`);
      }

      // Modify query to include schema information
      let columnsQuery =
        "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = ?";
      let queryParams = [tableName as string];

      if (dbName) {
        columnsQuery += " AND table_schema = ?";
        queryParams.push(dbName);
      }

      const results = (await executeQuery(
        columnsQuery,
        queryParams,
      )) as ColumnRow[];

      // When PII redaction is enabled, hide PII column names from the schema
      // response so the LLM never learns they exist and won't generate SQL
      // referencing them. Combined with the SELECT * guard in executeReadOnlyQuery,
      // this gives end-to-end protection: the LLM only ever sees safe columns
      // and is forced to project them explicitly.
      const piiColumnList = [...DEFAULT_PII_COLUMNS, ...PII_EXTRA_COLUMNS];
      const filtered = ENABLE_PII_REDACTION
        ? results.filter(
            (col) =>
              !isPIIColumn(col.column_name, piiColumnList, PII_EXTRA_COLUMN_PATTERNS),
          )
        : results;

      if (ENABLE_PII_REDACTION && filtered.length !== results.length) {
        log(
          "info",
          `[redact] hid ${results.length - filtered.length} PII column(s) from schema for table "${tableName}"`,
        );
      }

      return {
        contents: [
          {
            uri: request.params.uri,
            mimeType: "application/json",
            text: JSON.stringify(filtered, null, 2),
          },
        ],
      };
    } catch (error) {
      log("error", "Error in ReadResourceRequest handler:", error);
      throw error;
    }
  });

  // Register handler for tool calls
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    try {
      log("info", "Handling CallToolRequest:", request.params.name);
      if (request.params.name !== "mysql_query") {
        throw new Error(`Unknown tool: ${request.params.name}`);
      }

      const sql = request.params.arguments?.sql as string;
      return await executeReadOnlyQuery(sql);
    } catch (err) {
      const error = err as Error;
      log("error", "Error in CallToolRequest handler:", error);
      return {
        content: [{
          type: "text",
          text: `Error: ${error.message}`
        }],
        isError: true
      };
    }
  });

  // Register handler for listing tools
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    log("info", "Handling ListToolsRequest");

    const toolsResponse = {
      tools: [
        {
          name: "mysql_query",
          description: toolDescription,
          inputSchema: {
            type: "object",
            properties: {
              sql: {
                type: "string",
                description: "The SQL query to execute",
              },
            },
            required: ["sql"],
          },
          annotations: {
            readOnlyHint: isReadOnly,
            idempotentHint: isReadOnly,
            destructiveHint: !isReadOnly,
            openWorldHint: false,
            title: "MySQL Query",
          },
        },
      ],
    };

    log(
      "info",
      "ListToolsRequest response:",
      JSON.stringify(toolsResponse, null, 2),
    );
    return toolsResponse;
  });

  return server;
}

/**
* Checks if the current module is the main module (the entry point of the application).
* This function works for both ES Modules (ESM) and CommonJS.
* @returns {boolean} - True if the module is the main module, false otherwise.
*/
const isMainModule = () => {
  // 1. Standard check for CommonJS
  // `require.main` refers to the application's entry point module.
  // If it's the same as the current `module`, this file was executed directly.
  if (typeof require !== 'undefined' && require.main === module) {
    return true;
  }
  // 2. Check for ES Modules (ESM)
  // `import.meta.url` provides the file URL of the current module.
  // `process.argv[1]` provides the path of the executed script.
  if (typeof import.meta !== 'undefined' && import.meta.url && process.argv[1]) {
    // Convert the `import.meta.url` (e.g., 'file:///path/to/file.js') to a system-standard absolute path.
    const currentModulePath = fileURLToPath(import.meta.url);
    // Resolve `process.argv[1]` (which can be a relative path) to a standard absolute path.
    const mainScriptPath = realpathSync(process.argv[1]);
    // Compare the two standardized absolute paths.
    return currentModulePath === mainScriptPath;
  }
  // Fallback if neither of the above conditions are met.
  return false;
}

// Start the server if this file is being run directly
if (isMainModule()) {
  log("info", "Running in standalone mode");

  // Start the server
  (async () => {
    try {
      if (IS_REMOTE_MCP && REMOTE_SECRET_KEY?.length) {
        // Fail fast: do not listen until the database is reachable.
        await runProcessSetup();
        // A new server and transport are created per request for isolation.
        await startHttpServer({
          ...resolveHttpOptions(process.env),
          createServer: () => createMcpServer({ config: { debug: false } }),
        });
      } else {
        // Not awaited, as before: stdio clients may initialize while the check runs.
        void runProcessSetup();
        const mcpServer = createMcpServer({ config: { debug: false } });
        const transport = new StdioServerTransport();
        await mcpServer.connect(transport);
        log("info", "Server started and listening on stdio");
      }
    } catch (error) {
      log("error", "Server error:", error);
      safeExit(1);
    }
  })();
}
