import { spawn, ChildProcess } from "child_process";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as dotenv from "dotenv";
import * as path from "path";
import { fileURLToPath } from "url";

// Set test directory path
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load test environment variables
dotenv.config({ path: path.resolve(__dirname, "../../.env.test") });

// Non-default port to avoid colliding with anything else the developer may run
const PORT = "39737";
const SECRET = "test-secret-key";
const SERVER_URL = `http://127.0.0.1:${PORT}/mcp`;
const SERVER_START_TIMEOUT_MS = 15000;

describe("Remote MCP HTTP mode — parallel /mcp requests", () => {
  let serverProcess: ChildProcess;

  beforeAll(async () => {
    const serverPath = path.resolve(__dirname, "../../dist/index.js");
    serverProcess = spawn("node", [serverPath], {
      env: {
        ...process.env,
        IS_REMOTE_MCP: "true",
        REMOTE_SECRET_KEY: SECRET,
        PORT,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    // Wait for the express server to print its "listening" line
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("Server did not start in time")),
        SERVER_START_TIMEOUT_MS,
      );

      const onData = (chunk: Buffer) => {
        if (chunk.toString().includes("listening on port")) {
          clearTimeout(timer);
          resolve();
        }
      };

      serverProcess.stdout?.on("data", onData);
      serverProcess.stderr?.on("data", onData);

      serverProcess.once("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });

      serverProcess.once("exit", (code) => {
        clearTimeout(timer);
        reject(new Error(`Server exited early with code ${code}`));
      });
    });
  }, 30000);

  afterAll(() => {
    if (serverProcess && !serverProcess.killed) {
      serverProcess.kill("SIGTERM");
    }
  });

  async function callMcp(
    reqId: number,
    sql: string,
    timeoutMs: number,
  ): Promise<{ status: number; text: string }> {
    const res = await fetch(SERVER_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${SECRET}`,
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: reqId,
        method: "tools/call",
        params: { name: "mysql_query", arguments: { sql } },
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    return { status: res.status, text: await res.text() };
  }

  // Regression test for the bug where two parallel POST /mcp requests share
  // the module-level Server instance: the first response's res.on("close")
  // handler calls server.close() on the shared Server, severing every other
  // in-flight transport. Without the per-request createMcpServer() fix, one
  // of the two requests below hangs forever and the AbortSignal trips the
  // test's per-request timeout.
  it("returns correct results to two concurrent tools/call requests", async () => {
    const [r1, r2] = await Promise.all([
      callMcp(1, "SELECT SLEEP(1) AS slept, 1 AS req_id", 8000),
      callMcp(2, "SELECT SLEEP(1) AS slept, 2 AS req_id", 8000),
    ]);

    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);

    // SSE response embeds the tool result as a JSON-encoded string, so the
    // inner field appears as \"req_id\": N in the raw response bytes.
    expect(r1.text).toContain('\\"req_id\\": 1');
    expect(r2.text).toContain('\\"req_id\\": 2');

    expect(r1.text).not.toContain('"isError":true');
    expect(r2.text).not.toContain('"isError":true');
  }, 20000);
});
