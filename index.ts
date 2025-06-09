#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import express from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { randomUUID } from "node:crypto";
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
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
} from "./src/config/index.js";
import {
  safeExit,
  getPool,
  executeQuery,
  executeReadOnlyQuery,
  poolPromise,
} from "./src/db/index.js";

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
      multiDbMode: isMultiDbMode ? "enabled" : "disabled",
    },
    null,
    2,
  ),
);

// @INFO: Lazy load server instance
let serverInstance: Promise<Server> | null = null;
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
                type: "object",
                properties: {
                  sql: {
                    type: "string",
                    description: "The SQL query to execute",
                  },
                },
                required: ["sql"],
              },
            },
          },
        },
      });

      // @INFO: Register request handlers
      server.setRequestHandler(ListResourcesRequestSchema, async () => {
        try {
          log("info", "Handling ListResourcesRequest");
          const connectionInfo = process.env.MYSQL_SOCKET_PATH
            ? `socket:${process.env.MYSQL_SOCKET_PATH}`
            : `${process.env.MYSQL_HOST || "127.0.0.1"}:${process.env.MYSQL_PORT || "3306"}`;

          // If we're in multi-DB mode, list all databases first
          if (isMultiDbMode) {
            const databases = (await executeQuery("SHOW DATABASES")) as {
              Database: string;
            }[];

            // For each database, list tables
            let allResources = [];

            for (const db of databases) {
              // Skip system databases
              if (
                [
                  "information_schema",
                  "mysql",
                  "performance_schema",
                  "sys",
                ].includes(db.Database)
              ) {
                continue;
              }

              const tables = (await executeQuery(
                `SELECT table_name FROM information_schema.tables WHERE table_schema = '${db.Database}'`,
              )) as TableRow[];

              allResources.push(
                ...tables.map((row: TableRow) => ({
                  uri: new URL(
                    `${db.Database}/${row.table_name}/${config.paths.schema}`,
                    connectionInfo,
                  ).href,
                  mimeType: "application/json",
                  name: `"${db.Database}.${row.table_name}" database schema`,
                })),
              );
            }

            return {
              resources: allResources,
            };
          } else {
            // Original behavior for single database mode
            const results = (await executeQuery(
              "SELECT table_name FROM information_schema.tables WHERE table_schema = DATABASE()",
            )) as TableRow[];

            return {
              resources: results.map((row: TableRow) => ({
                uri: new URL(
                  `${row.table_name}/${config.paths.schema}`,
                  connectionInfo,
                ).href,
                mimeType: "application/json",
                name: `"${row.table_name}" database schema`,
              })),
            };
          }
        } catch (error) {
          log("error", "Error in ListResourcesRequest handler:", error);
          throw error;
        }
      });

      server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
        try {
          log("error", "Handling ReadResourceRequest");
          const resourceUrl = new URL(request.params.uri);
          const pathComponents = resourceUrl.pathname.split("/");
          const schema = pathComponents.pop();
          const tableName = pathComponents.pop();
          let dbName = null;

          // In multi-DB mode, we expect a database name in the path
          if (isMultiDbMode && pathComponents.length > 0) {
            dbName = pathComponents.pop() || null;
          }

          if (schema !== config.paths.schema) {
            throw new Error("Invalid resource URI");
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

          return {
            contents: [
              {
                uri: request.params.uri,
                mimeType: "application/json",
                text: JSON.stringify(results, null, 2),
              },
            ],
          };
        } catch (error) {
          log("error", "Error in ReadResourceRequest handler:", error);
          throw error;
        }
      });

      server.setRequestHandler(ListToolsRequestSchema, async () => {
        log("error", "Handling ListToolsRequest");

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
            },
          ],
        };

        log(
          "error",
          "ListToolsRequest response:",
          JSON.stringify(toolsResponse, null, 2),
        );
        return toolsResponse;
      });

      server.setRequestHandler(CallToolRequestSchema, async (request) => {
        try {
          log("error", "Handling CallToolRequest:", request.params.name);
          if (request.params.name !== "mysql_query") {
            throw new Error(`Unknown tool: ${request.params.name}`);
          }

          const sql = request.params.arguments?.sql as string;
          return executeReadOnlyQuery(sql);
        } catch (error) {
          log("error", "Error in CallToolRequest handler:", error);
          throw error;
        }
      });

      resolve(server);
    });
  }
  return serverInstance;
};

// @INFO: Server startup and shutdown
async function runServer(): Promise<void> {
  try {
    log("info", "Attempting to test database connection...");
    // @INFO: Test the connection before fully starting the server
    const pool = await getPool();
    const connection = await pool.getConnection();
    log("info", "Database connection test successful");
    connection.release();

    // Choose transport based on env var MCP_TRANSPORT: "stdio" or "http" (default: http)
    const TRANSPORT = process.env.MCP_TRANSPORT || "http";

    if (TRANSPORT === "stdio") {
      log("info", "Starting MCP server in stdio mode");
      const server = await getServer();
      const transport = new StdioServerTransport();
      await server.connect(transport);
    } else {
      log("info", "Starting MCP server in HTTP mode with session management");
      const app = express();
      app.use(express.json());

      // Store transports by session ID
      const transports: { [sessionId: string]: { transport: StreamableHTTPServerTransport } } = {};

      app.get("/", (req, res) => {
      
      });
      // POST /mcp: handle client-to-server communication
      app.post(["/mcp","/sse"], async (req, res) => {

        const sessionId = req.headers['mcp-session-id'] as string | undefined;

        let transport: StreamableHTTPServerTransport;

        if (sessionId && transports[sessionId]) {
          // Reuse existing transport
          transport = transports[sessionId].transport;
        } else if (!sessionId && isInitializeRequest(req.body)) {
          // New initialization request
          transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => randomUUID(),
            onsessioninitialized: (newSid: string) => {
              transports[newSid] = { transport };
            }
          });
          // Clean up transport when closed (reference: README)
          transport.onclose = () => {
            if (transport.sessionId) {
              delete transports[transport.sessionId];
            }
          };
          const server = await getServer();
          await server.connect(transport);
        } else {
          // Invalid request
          log("error", "Invalid MCP session request", { sessionId, body: req.body });
          res.status(400).json({
            jsonrpc: '2.0',
            error: {
              code: -32000,
              message: 'Bad Request: No valid session ID provided',
            },
            id: null,
          });
          return;
        }

        // Handle the request
        await transport.handleRequest(req, res, req.body);
      });

      // GET and DELETE /mcp: handle server-to-client notifications and session termination
      const handleSessionRequest = async (req: any, res: any) => {
        const sessionId = req.headers['mcp-session-id'] as string | undefined;
        if (!sessionId || !transports[sessionId]) {
          res.status(400).send('Invalid or missing session ID');
          return;
        }
        const transport = transports[sessionId].transport;
        await transport.handleRequest(req, res);
      };

      app.get('/mcp', handleSessionRequest);
      app.delete('/mcp', handleSessionRequest);

      const PORT = process.env.PORT || 3000;
      app.listen(PORT, () => {
        log("info", `MCP Streamable HTTP Server (multi-client) listening on port ${PORT}`);
      });
    }
  } catch (error) {
    log("error", "Fatal error during server startup:", error);
    safeExit(1);
  }
}

const shutdown = async (signal: string): Promise<void> => {
  log("error", `Received ${signal}. Shutting down...`);
  try {
    // @INFO: Only attempt to close the pool if it was created
    if (poolPromise) {
      const pool = await poolPromise;
      await pool.end();
    }
  } catch (err) {
    log("error", "Error closing pool:", err);
    throw err;
  }
};

process.on("SIGINT", async () => {
  try {
    await shutdown("SIGINT");
    process.exit(0);
  } catch (err) {
    log("error", "Error during SIGINT shutdown:", err);
    safeExit(1);
  }
});

process.on("SIGTERM", async () => {
  try {
    await shutdown("SIGTERM");
    process.exit(0);
  } catch (err) {
    log("error", "Error during SIGTERM shutdown:", err);
    safeExit(1);
  }
});

// @INFO: Add unhandled error listeners
process.on("uncaughtException", (error) => {
  log("error", "Uncaught exception:", error);
  safeExit(1);
});

process.on("unhandledRejection", (reason, promise) => {
  log("error", "Unhandled rejection at:", promise, "reason:", reason);
  safeExit(1);
});

runServer().catch((error: unknown) => {
  log("error", "Server error:", error);
  safeExit(1);
});
