import express, { Request, Response } from "express";
import type { Server as HttpServer } from "http";
import type { Server as McpServer } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { log } from "../utils/index.js";

// Loopback by default so the endpoint is never exposed unless explicitly requested.
export const DEFAULT_HOST = "127.0.0.1";

/** HTTP settings from the environment; host is loopback unless MCP_HOST is set. */
export function resolveHttpOptions(env: NodeJS.ProcessEnv) {
  return {
    host: env.MCP_HOST || DEFAULT_HOST,
    port: env.PORT || 3000,
    secret: env.REMOTE_SECRET_KEY || "",
  };
}

export interface StartHttpServerOptions {
  port: number | string;
  host?: string;
  secret: string;
  createServer: () => McpServer;
}

const methodNotAllowed = (res: Response) => {
  res.writeHead(405).end(
    JSON.stringify({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Method not allowed." },
      id: null,
    }),
  );
};

/**
 * Starts the stateless Streamable HTTP endpoint (POST /mcp, bearer-protected).
 * A new MCP server and transport are created for every request so concurrent
 * clients cannot collide on request IDs or close each other's connections.
 * Resolves once the socket is listening.
 */
export function startHttpServer({
  port,
  host = DEFAULT_HOST,
  secret,
  createServer,
}: StartHttpServerOptions): Promise<HttpServer> {
  const app = express();
  app.use(express.json());

  app.post("/mcp", async (req: Request, res: Response) => {
    if (req.get("Authorization") !== `Bearer ${secret}`) {
      console.error("Missing or invalid Authorization header");
      res.status(401).json({
        jsonrpc: "2.0",
        error: {
          code: -32603,
          message: "Missing or invalid Authorization header",
        },
        id: null,
      });
      return;
    }
    try {
      const server = createServer();
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      });
      res.on("close", () => {
        log("info", "Request closed");
        transport.close();
        server.close();
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      log("error", "Error handling MCP request:", error);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: (error as any).message },
          id: null,
        });
      }
    }
  });

  // SSE notifications and session termination are not supported in stateless mode
  app.get("/mcp", async (_req: Request, res: Response) => {
    console.log("Received GET MCP request");
    methodNotAllowed(res);
  });
  app.delete("/mcp", async (_req: Request, res: Response) => {
    console.log("Received DELETE MCP request");
    methodNotAllowed(res);
  });

  return new Promise((resolve, reject) => {
    const httpServer = app.listen(Number(port), host, () => {
      console.log(
        `MCP Stateless Streamable HTTP Server listening on ${host}:${Number(port)}`,
      );
      resolve(httpServer);
    });
    httpServer.once("error", reject);
  });
}
