import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as dotenv from "dotenv";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Must be set before the server modules load: config is read at import time.
// dotenv does not override variables that are already set.
process.env.MYSQL_QUERY_TIMEOUT = "500";
process.env.MYSQL_QUERY_TIMEOUT_MAX = "5000";
dotenv.config({ path: path.resolve(__dirname, "../../.env.test") });

// SLEEP() has to be part of a larger expression: a bare `SELECT SLEEP(n)`
// that gets interrupted returns 1 instead of raising an error. MySQL 8.0+ and
// MariaDB; on 5.7 even this form returns an empty result instead of an error.
const SLOW_QUERY = "SELECT 1 AS ok FROM DUAL WHERE SLEEP(2) = 0";

describe("MYSQL_QUERY_TIMEOUT / timeout_ms", () => {
  let db: typeof import("../../dist/src/db/index.js");

  beforeAll(async () => {
    db = await import("../../dist/src/db/index.js");
  });

  afterAll(async () => {
    await (await db.getPool()).end();
  });

  it("stops a SELECT that runs past MYSQL_QUERY_TIMEOUT and says how to change it", async () => {
    const started = Date.now();
    await expect(db.executeReadOnlyQuery(SLOW_QUERY)).rejects.toThrow(
      /maximum statement execution time exceeded \(limit: 500 ms\. Pass timeout_ms to change it, up to 5000 ms\.\)/,
    );
    expect(Date.now() - started).toBeLessThan(1500);
  });

  it("lets a single call raise the limit with timeout_ms", async () => {
    const result: any = await db.executeReadOnlyQuery(SLOW_QUERY, 5000);
    expect(result.isError).toBe(false);
    expect(JSON.parse(result.content[0].text)).toEqual([{ ok: 1 }]);
  });

  it("does not carry a per-call timeout over to the next call", async () => {
    await db.executeReadOnlyQuery("SELECT 1", 5000);
    await expect(db.executeReadOnlyQuery(SLOW_QUERY)).rejects.toThrow(
      /maximum statement execution time exceeded/,
    );
  });

  it("refuses SQL that sets its own timeout, which would step around the limit", async () => {
    for (const hint of [
      "MAX_EXECUTION_TIME(60000)",
      "SET_VAR(max_execution_time=0)",
    ]) {
      const result: any = await db.executeReadOnlyQuery(
        `SELECT /*+ ${hint} */ 1 AS ok FROM DUAL WHERE SLEEP(1) = 0`,
      );
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Use the timeout_ms argument instead");
    }
  });
});
