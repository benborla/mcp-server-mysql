import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
} from "vitest";
import * as mysql2 from "mysql2/promise";
import * as dotenv from "dotenv";
import * as path from "path";
import { fileURLToPath } from "url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

/**
 * End-to-end test for PII redaction.
 *
 * Unlike the unit and integration suites, this test exercises the *real*
 * binary the user runs: it spawns `node dist/index.js` with
 * `ENABLE_PII_REDACTION=true` in its environment, connects over stdio using a
 * real MCP client from the SDK, invokes the `mysql_query` tool, and asserts
 * that the returned content contains no raw PII.
 *
 * This is the only layer that proves the full pipeline — env parsing, config
 * loading, tool dispatch, query execution, redaction, JSON serialization, and
 * MCP framing — behaves correctly together.
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, "../../.env.test") });

const DB_NAME = "pii_redaction_e2e";
const SERVER_ENTRY = path.resolve(__dirname, "../../dist/index.js");

const SEED_ROW = {
  email: "jane.doe@example.com",
  phone: "415-555-0134",
  ssn: "123-45-6789",
  ip_address: "192.168.1.42",
  credit_card: "4111111111111111",
  first_name: "Ada Lovelace",
  notes: "Reach jane.doe@example.com from 192.168.1.42 or 415-555-0134",
};

const RAW_PII_SUBSTRINGS = [
  SEED_ROW.email,
  SEED_ROW.phone,
  SEED_ROW.ssn,
  SEED_ROW.ip_address,
  SEED_ROW.credit_card,
  SEED_ROW.first_name,
];

function serverEnv(enableRedaction: boolean): Record<string, string> {
  // Explicitly assemble the child env so we don't accidentally inherit a stale
  // `ENABLE_PII_REDACTION` from the parent shell. `dotenv.config()` inside the
  // server will NOT overwrite these once they are set.
  return {
    PATH: process.env.PATH ?? "",
    HOME: process.env.HOME ?? "",
    NODE_ENV: "test",
    MYSQL_HOST: process.env.MYSQL_HOST ?? "127.0.0.1",
    MYSQL_PORT: process.env.MYSQL_PORT ?? "3306",
    MYSQL_USER: process.env.MYSQL_USER ?? "root",
    MYSQL_PASS: process.env.MYSQL_PASS ?? "",
    MYSQL_DB: "",
    MULTI_DB_WRITE_MODE: "true",
    ENABLE_PII_REDACTION: enableRedaction ? "true" : "false",
  };
}

async function callMysqlQuery(
  enableRedaction: boolean,
  sql: string,
): Promise<string> {
  const transport = new StdioClientTransport({
    command: process.execPath, // current node binary
    args: [SERVER_ENTRY],
    env: serverEnv(enableRedaction),
    stderr: "ignore",
  });

  const client = new Client(
    { name: "pii-redaction-e2e-test", version: "0.0.0" },
    { capabilities: {} },
  );

  try {
    await client.connect(transport);
    const result = (await client.callTool({
      name: "mysql_query",
      arguments: { sql },
    })) as { content: Array<{ type: string; text: string }> };
    return result.content.map((c) => c.text).join("\n");
  } finally {
    await client.close().catch(() => undefined);
    await transport.close().catch(() => undefined);
  }
}

describe("PII Redaction – E2E via spawned MCP server", () => {
  let pool: mysql2.Pool;

  beforeAll(async () => {
    pool = mysql2.createPool({
      host: process.env.MYSQL_HOST || "127.0.0.1",
      port: Number(process.env.MYSQL_PORT || "3306"),
      user: process.env.MYSQL_USER || "root",
      password: process.env.MYSQL_PASS || "",
      connectionLimit: 3,
      multipleStatements: true,
    });

    const conn = await pool.getConnection();
    try {
      await conn.query(`CREATE DATABASE IF NOT EXISTS ${DB_NAME}`);
      await conn.query(`USE ${DB_NAME}`);
      await conn.query(`DROP TABLE IF EXISTS pii_users`);
      await conn.query(`
        CREATE TABLE pii_users (
          id INT AUTO_INCREMENT PRIMARY KEY,
          email VARCHAR(255),
          phone VARCHAR(64),
          ssn VARCHAR(16),
          ip_address VARCHAR(64),
          credit_card VARCHAR(32),
          first_name VARCHAR(128),
          notes TEXT
        )
      `);
    } finally {
      conn.release();
    }
  }, 30_000);

  beforeEach(async () => {
    const conn = await pool.getConnection();
    try {
      await conn.query(`TRUNCATE TABLE ${DB_NAME}.pii_users`);
      await conn.query(
        `INSERT INTO ${DB_NAME}.pii_users
           (email, phone, ssn, ip_address, credit_card, first_name, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          SEED_ROW.email,
          SEED_ROW.phone,
          SEED_ROW.ssn,
          SEED_ROW.ip_address,
          SEED_ROW.credit_card,
          SEED_ROW.first_name,
          SEED_ROW.notes,
        ],
      );
    } finally {
      conn.release();
    }
  });

  afterAll(async () => {
    const conn = await pool.getConnection();
    try {
      await conn.query(`DROP DATABASE IF EXISTS ${DB_NAME}`);
    } finally {
      conn.release();
    }
    await pool.end();
  });

  it(
    "returns raw PII when ENABLE_PII_REDACTION=false",
    async () => {
      const body = await callMysqlQuery(
        false,
        `SELECT * FROM ${DB_NAME}.pii_users`,
      );
      // Sanity check: the unredacted path must surface raw values, otherwise
      // the next test could pass for the wrong reason.
      expect(body).toContain(SEED_ROW.email);
      expect(body).toContain(SEED_ROW.credit_card);
    },
    30_000,
  );

  it(
    "never returns raw PII when ENABLE_PII_REDACTION=true",
    async () => {
      const body = await callMysqlQuery(
        true,
        `SELECT * FROM ${DB_NAME}.pii_users`,
      );

      for (const needle of RAW_PII_SUBSTRINGS) {
        expect(
          body.includes(needle),
          `raw PII leaked through the full MCP pipeline: "${needle}"`,
        ).toBe(false);
      }

      // Positive checks on well-known masked shapes.
      expect(body).toContain("j***@e***.com");
      expect(body).toContain("***-***-0134");
      expect(body).toContain("***-**-6789");
      expect(body).toContain("***.***.***.42");
      expect(body).toContain("****-****-****-1111");
    },
    30_000,
  );
});
