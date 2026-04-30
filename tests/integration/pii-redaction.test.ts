import * as mysql2 from "mysql2/promise";
import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  vi,
} from "vitest";
import * as dotenv from "dotenv";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, "../../.env.test") });

const DB_NAME = "pii_redaction_test";

/**
 * Seeded rows are deliberately varied so every detection path is exercised:
 *   - column-name heuristic (email, phone, ssn, ip_address, credit_card, first_name)
 *   - regex scanning inside a free-text column (`notes`) even when the column
 *     name itself is not sensitive
 *   - Luhn-valid PANs for `maskCard`
 */
const SEED_ROWS = [
  {
    email: "jane.doe@example.com",
    phone: "415-555-0134",
    ssn: "123-45-6789",
    ip_address: "192.168.1.42",
    credit_card: "4111111111111111",
    first_name: "Ada Lovelace",
    notes: "Reach jane.doe@example.com from 192.168.1.42 or 415-555-0134",
    // Realistic-looking asset URLs used to exercise the operator-defined
    // extension mechanisms. Neither column is on the built-in PII list.
    image_url: "https://cdn.example.com/assets/hero-abc123.jpg",
    signed_download_url:
      "https://cdn.example.com/downloads/receipt?sig=deadbeef12345",
  },
  {
    email: "john@acme.io",
    phone: "+1 (212) 555-9999",
    ssn: "987-65-4321",
    ip_address: "10.0.0.7",
    credit_card: "5500000000000004",
    first_name: "Grace Hopper",
    notes: "Card 5500000000000004 last seen from 10.0.0.7",
    image_url: "https://cdn.example.com/assets/hero-xyz789.jpg",
    signed_download_url:
      "https://cdn.example.com/downloads/invoice?sig=cafef00d67890",
  },
];

/** Full list of raw PII tokens that must NOT survive in a redacted response. */
const RAW_PII_SUBSTRINGS = [
  "jane.doe@example.com",
  "john@acme.io",
  "415-555-0134",
  "212-555-9999",
  "+1 (212) 555-9999",
  "123-45-6789",
  "987-65-4321",
  "192.168.1.42",
  "10.0.0.7",
  "4111111111111111",
  "5500000000000004",
  "Ada Lovelace",
  "Grace Hopper",
];

/**
 * Reload the compiled db module with a specific env configuration. The config
 * module reads `process.env.ENABLE_PII_REDACTION` (and friends) at import time,
 * so toggling the flag mid-test requires `vi.resetModules()` + a fresh import.
 */
async function reloadDbModule(
  env: Record<string, string | undefined>,
): Promise<typeof import("../../dist/src/db/index.js")> {
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  vi.resetModules();
  return await import("../../dist/src/db/index.js");
}

describe("PII Redaction – integration", () => {
  let pool: mysql2.Pool;

  beforeAll(async () => {
    pool = mysql2.createPool({
      host: process.env.MYSQL_HOST || "127.0.0.1",
      port: Number(process.env.MYSQL_PORT || "3306"),
      user: process.env.MYSQL_USER || "root",
      password: process.env.MYSQL_PASS || "",
      connectionLimit: 5,
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
          notes TEXT,
          image_url VARCHAR(255),
          signed_download_url VARCHAR(255)
        )
      `);
    } finally {
      conn.release();
    }
  });

  beforeEach(async () => {
    const conn = await pool.getConnection();
    try {
      await conn.query(`TRUNCATE TABLE ${DB_NAME}.pii_users`);
      for (const row of SEED_ROWS) {
        await conn.query(
          `INSERT INTO ${DB_NAME}.pii_users
             (email, phone, ssn, ip_address, credit_card, first_name, notes,
              image_url, signed_download_url)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            row.email,
            row.phone,
            row.ssn,
            row.ip_address,
            row.credit_card,
            row.first_name,
            row.notes,
            row.image_url,
            row.signed_download_url,
          ],
        );
      }
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

  it("passes raw PII through when ENABLE_PII_REDACTION is unset", async () => {
    const { executeReadOnlyQuery } = await reloadDbModule({
      ENABLE_PII_REDACTION: undefined,
    });

    const result = await executeReadOnlyQuery<any>(
      `SELECT * FROM ${DB_NAME}.pii_users ORDER BY id`,
    );

    expect(result.isError).toBe(false);
    const body = result.content[0].text;
    // Flag-off baseline: the raw values MUST appear. This confirms the test
    // setup is exercising the real path and the next test isn't passing by
    // accident (e.g. empty result).
    expect(body).toContain("jane.doe@example.com");
    expect(body).toContain("4111111111111111");
    expect(body).toContain("Ada Lovelace");
  });

  it("masks PII in read-only results when ENABLE_PII_REDACTION=true", async () => {
    // Opt out of the column-reference guard: this test exists to exercise
    // the value-level masking pipeline, which is what we exercise by
    // selecting PII columns explicitly. The column-reference guard has
    // its own dedicated tests further down in this file.
    const { executeReadOnlyQuery } = await reloadDbModule({
      ENABLE_PII_REDACTION: "true",
      PII_ALLOW_REFERENCES: "true",
    });

    // Explicit projection: redaction is enabled, so SELECT * is gated. Listing
    // the columns here exercises the same redaction code paths without
    // tripping the SELECT * guard (which has its own dedicated tests below).
    const result = await executeReadOnlyQuery<any>(
      `SELECT id, email, phone, ssn, ip_address, credit_card, first_name,
              notes, image_url, signed_download_url
         FROM ${DB_NAME}.pii_users ORDER BY id`,
    );

    expect(result.isError).toBe(false);
    const rows = JSON.parse(result.content[0].text);
    const first = rows[0];

    expect(first.email).toBe("j***@e***.com");
    expect(first.phone).toBe("***-***-0134");
    expect(first.ssn).toBe("***-**-6789");
    expect(first.ip_address).toBe("***.***.***.42");
    expect(first.credit_card).toBe("****-****-****-1111");
    // `first_name` matches the column heuristic but the value has no regex
    // shape, so the generic mask applies (first char + asterisks, capped).
    expect(first.first_name.startsWith("A")).toBe(true);
    expect(first.first_name).not.toBe("Ada Lovelace");
    // Free-text column is NOT on the heuristic list, but its embedded PII
    // must still be caught by regex scanning.
    expect(first.notes).not.toContain("jane.doe@example.com");
    expect(first.notes).not.toContain("192.168.1.42");
    expect(first.notes).not.toContain("415-555-0134");
    expect(first.notes).toContain("j***@e***.com");
  });

  it("serialized response leaks no raw PII (adversarial re-scan)", async () => {
    // See note on the previous test: opt out of the column-reference guard
    // so this test focuses on the value-level redactor invariants.
    const { executeReadOnlyQuery } = await reloadDbModule({
      ENABLE_PII_REDACTION: "true",
      PII_ALLOW_REFERENCES: "true",
    });
    const { applyPatternMasks } = await import(
      "../../dist/src/security/redact.js"
    );

    const result = await executeReadOnlyQuery<any>(
      `SELECT id, email, phone, ssn, ip_address, credit_card, first_name,
              notes, image_url, signed_download_url
         FROM ${DB_NAME}.pii_users`,
    );
    const fullBody = result.content.map((c: any) => c.text).join("\n");

    // 1. None of the known raw PII tokens appear anywhere in the response.
    for (const needle of RAW_PII_SUBSTRINGS) {
      expect(
        fullBody.includes(needle),
        `raw PII leaked through redaction: "${needle}"`,
      ).toBe(false);
    }

    // 2. Re-running the pattern masks over the final serialized body must be
    //    a no-op. If `applyPatternMasks` finds anything to rewrite, something
    //    the redactor should have caught slipped through.
    expect(applyPatternMasks(fullBody)).toBe(fullBody);
  });

  it("write-operation summaries are unaffected by the flag (by design)", async () => {
    const { executeWriteQuery } = await reloadDbModule({
      ENABLE_PII_REDACTION: "true",
      ALLOW_INSERT_OPERATION: "true",
      MULTI_DB_WRITE_MODE: "true",
    });

    const result = await executeWriteQuery<any>(
      `INSERT INTO ${DB_NAME}.pii_users (email, phone)
         VALUES ('new.user@example.com', '415-555-0000')`,
    );

    expect(result.isError).toBe(false);
    // The summary is a generated string and doesn't echo the inserted values,
    // so it's both unredacted AND leak-free. We verify both invariants.
    expect(result.content[0].text).toContain("Insert successful");
    expect(result.content[0].text).not.toContain("new.user@example.com");
  });

  it("PII_EXTRA_COLUMNS masks operator-defined columns only when set", async () => {
    // When only the master flag is on, non-built-in columns pass through.
    const base = await reloadDbModule({
      ENABLE_PII_REDACTION: "true",
      PII_EXTRA_COLUMNS: undefined,
      PII_EXTRA_COLUMN_PATTERNS: undefined,
    });
    const unmasked = await base.executeReadOnlyQuery<any>(
      `SELECT image_url, signed_download_url FROM ${DB_NAME}.pii_users ORDER BY id`,
    );
    const unmaskedRow = JSON.parse(unmasked.content[0].text)[0];
    expect(unmaskedRow.image_url).toContain("cdn.example.com");
    expect(unmaskedRow.signed_download_url).toContain("cdn.example.com");

    // With PII_EXTRA_COLUMNS=image_url, only image_url is masked. We opt
    // out of the column-reference guard here because this test is
    // specifically exercising the value-level masking layer; once the
    // operator marks `image_url` as PII, the reference guard would (by
    // design) reject the projection.
    const { executeReadOnlyQuery } = await reloadDbModule({
      ENABLE_PII_REDACTION: "true",
      PII_EXTRA_COLUMNS: "image_url",
      PII_EXTRA_COLUMN_PATTERNS: undefined,
      PII_ALLOW_REFERENCES: "true",
    });
    const masked = await executeReadOnlyQuery<any>(
      `SELECT image_url, signed_download_url FROM ${DB_NAME}.pii_users ORDER BY id`,
    );
    const maskedRow = JSON.parse(masked.content[0].text)[0];
    expect(maskedRow.image_url).not.toContain("cdn.example.com");
    expect(maskedRow.image_url.startsWith("h")).toBe(true);
    // signed_download_url stays unmasked — the extras list is additive but
    // narrowly scoped to what the operator listed.
    expect(maskedRow.signed_download_url).toContain("cdn.example.com");
  });

  it("PII_EXTRA_COLUMN_PATTERNS masks columns matched by the regex", async () => {
    // Opt out of the column-reference guard for the same reason as the
    // PII_EXTRA_COLUMNS test above.
    const { executeReadOnlyQuery } = await reloadDbModule({
      ENABLE_PII_REDACTION: "true",
      PII_EXTRA_COLUMNS: undefined,
      PII_EXTRA_COLUMN_PATTERNS: "^signed_.*",
      PII_ALLOW_REFERENCES: "true",
    });
    const result = await executeReadOnlyQuery<any>(
      `SELECT image_url, signed_download_url FROM ${DB_NAME}.pii_users ORDER BY id`,
    );
    const row = JSON.parse(result.content[0].text)[0];
    // Pattern catches signed_download_url but not image_url — proves the
    // regex layer is independent of the substring layer.
    expect(row.signed_download_url).not.toContain("cdn.example.com");
    expect(row.signed_download_url.startsWith("h")).toBe(true);
    expect(row.image_url).toContain("cdn.example.com");
  });

  it("invalid PII_EXTRA_COLUMN_PATTERNS entries do not crash the server", async () => {
    // Garbage regex alongside a valid one: the garbage should be logged and
    // skipped, the valid pattern should still fire, and the query must run.
    // The reference guard is opted out so the SELECT email projection — used
    // here purely as a baseline-redaction check — isn't rejected.
    const { executeReadOnlyQuery } = await reloadDbModule({
      ENABLE_PII_REDACTION: "true",
      PII_EXTRA_COLUMNS: undefined,
      PII_EXTRA_COLUMN_PATTERNS: "[unclosed(regex;^signed_.*",
      PII_ALLOW_REFERENCES: "true",
    });
    const result = await executeReadOnlyQuery<any>(
      `SELECT email, signed_download_url FROM ${DB_NAME}.pii_users ORDER BY id`,
    );
    expect(result.isError).toBe(false);
    const row = JSON.parse(result.content[0].text)[0];
    // Built-in redaction still works...
    expect(row.email).toBe("j***@e***.com");
    // ...and the valid regex entry was still applied.
    expect(row.signed_download_url.startsWith("h")).toBe(true);
  });

  // ---- SELECT * gate -----------------------------------------------------
  // When redaction is on, wildcard projections are refused so the LLM can't
  // accidentally pull a redacted column it never saw in the schema response.

  it("rejects bare SELECT * when ENABLE_PII_REDACTION=true", async () => {
    const { executeReadOnlyQuery } = await reloadDbModule({
      ENABLE_PII_REDACTION: "true",
      PII_ALLOW_SELECT_STAR: undefined,
    });
    const result = await executeReadOnlyQuery<any>(
      `SELECT * FROM ${DB_NAME}.pii_users`,
    );
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("SELECT *");
    expect(result.content[0].text).toContain("PII_ALLOW_SELECT_STAR");
  });

  it("rejects qualified t.* wildcard when ENABLE_PII_REDACTION=true", async () => {
    const { executeReadOnlyQuery } = await reloadDbModule({
      ENABLE_PII_REDACTION: "true",
      PII_ALLOW_SELECT_STAR: undefined,
    });
    const result = await executeReadOnlyQuery<any>(
      `SELECT u.* FROM ${DB_NAME}.pii_users u`,
    );
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("PII_ALLOW_SELECT_STAR");
  });

  it("permits COUNT(*) under ENABLE_PII_REDACTION=true (aggregate, not wildcard)", async () => {
    const { executeReadOnlyQuery } = await reloadDbModule({
      ENABLE_PII_REDACTION: "true",
      PII_ALLOW_SELECT_STAR: undefined,
    });
    const result = await executeReadOnlyQuery<any>(
      `SELECT COUNT(*) AS n FROM ${DB_NAME}.pii_users`,
    );
    expect(result.isError).toBe(false);
    const rows = JSON.parse(result.content[0].text);
    expect(rows[0].n).toBe(SEED_ROWS.length);
  });

  it("PII_ALLOW_SELECT_STAR=true opts out of the SELECT * gate", async () => {
    // Operator escape hatch — when a table is known to have no PII, the gate
    // can be lifted globally. Value-level masking still runs (defence in
    // depth), so the unmasked baseline (flag off) is verified by an earlier
    // test in this file.
    const { executeReadOnlyQuery } = await reloadDbModule({
      ENABLE_PII_REDACTION: "true",
      PII_ALLOW_SELECT_STAR: "true",
    });
    const result = await executeReadOnlyQuery<any>(
      `SELECT * FROM ${DB_NAME}.pii_users ORDER BY id`,
    );
    expect(result.isError).toBe(false);
    const rows = JSON.parse(result.content[0].text);
    expect(rows).toHaveLength(SEED_ROWS.length);
    // Value masking still applies — the override only lifts the projection
    // policy, not the redactor itself.
    expect(rows[0].email).toBe("j***@e***.com");
  });

  it("does not block SELECT * when ENABLE_PII_REDACTION is unset", async () => {
    // Sanity: with redaction off, the gate must not engage. Otherwise we'd
    // be regressing every consumer that hasn't opted in to redaction.
    const { executeReadOnlyQuery } = await reloadDbModule({
      ENABLE_PII_REDACTION: undefined,
      PII_ALLOW_SELECT_STAR: undefined,
    });
    const result = await executeReadOnlyQuery<any>(
      `SELECT * FROM ${DB_NAME}.pii_users ORDER BY id`,
    );
    expect(result.isError).toBe(false);
  });

  // ---- PII column-reference gate ----------------------------------------
  // When redaction is on, any reference to a PII column anywhere in the
  // query (projection, WHERE, ORDER BY, subquery, ...) is rejected so the
  // LLM can't bypass the result-key redactor by aliasing the projection
  // (the original `CONCAT(first_name, last_name) AS NAME` failure).

  it("rejects the alias-bypass query (CONCAT(first_name, last_name) AS NAME)", async () => {
    // Reproduces the exact failure that prompted this guard. The AS NAME
    // alias would render the result-key redactor blind; the AST walk does
    // not care about the output alias and rejects on the input columns.
    const { executeReadOnlyQuery } = await reloadDbModule({
      ENABLE_PII_REDACTION: "true",
      PII_ALLOW_REFERENCES: undefined,
    });
    const result = await executeReadOnlyQuery<any>(
      `SELECT id, CONCAT(COALESCE(first_name, ''), ' ', COALESCE(first_name, '')) AS NAME
         FROM ${DB_NAME}.pii_users`,
    );
    expect(result.isError).toBe(true);
    // Error names the offending column so the LLM can self-correct.
    expect(result.content[0].text).toContain("first_name");
    expect(result.content[0].text).toContain("PII_ALLOW_REFERENCES");
    // And no plain-text PII appears in the rejection.
    expect(result.content[0].text).not.toContain("Ada Lovelace");
  });

  it("rejects PII referenced only in WHERE", async () => {
    // Side-channel: the LLM could otherwise infer PII via observable row
    // counts (e.g. existence of a user with a given email).
    const { executeReadOnlyQuery } = await reloadDbModule({
      ENABLE_PII_REDACTION: "true",
      PII_ALLOW_REFERENCES: undefined,
    });
    const result = await executeReadOnlyQuery<any>(
      `SELECT id FROM ${DB_NAME}.pii_users WHERE email = 'jane.doe@example.com'`,
    );
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("email");
  });

  it("rejects PII referenced only in ORDER BY", async () => {
    const { executeReadOnlyQuery } = await reloadDbModule({
      ENABLE_PII_REDACTION: "true",
      PII_ALLOW_REFERENCES: undefined,
    });
    const result = await executeReadOnlyQuery<any>(
      `SELECT id FROM ${DB_NAME}.pii_users ORDER BY first_name`,
    );
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("first_name");
  });

  it("PII_ALLOW_REFERENCES=true opts out of the column-reference gate", async () => {
    const { executeReadOnlyQuery } = await reloadDbModule({
      ENABLE_PII_REDACTION: "true",
      PII_ALLOW_REFERENCES: "true",
    });
    const result = await executeReadOnlyQuery<any>(
      `SELECT id, first_name FROM ${DB_NAME}.pii_users ORDER BY id`,
    );
    expect(result.isError).toBe(false);
    // Override lifts the projection policy but value masking still runs.
    const rows = JSON.parse(result.content[0].text);
    expect(rows[0].first_name).not.toBe("Ada Lovelace");
  });

  it("does not block PII references when ENABLE_PII_REDACTION is unset", async () => {
    const { executeReadOnlyQuery } = await reloadDbModule({
      ENABLE_PII_REDACTION: undefined,
      PII_ALLOW_REFERENCES: undefined,
    });
    const result = await executeReadOnlyQuery<any>(
      `SELECT id, first_name FROM ${DB_NAME}.pii_users ORDER BY id`,
    );
    expect(result.isError).toBe(false);
  });

  // ---- Introspection gate -----------------------------------------------
  // When redaction is on, schema-introspection statements are rejected so
  // the LLM can't enumerate PII column names by running SQL directly
  // (it should use the filtered mysql://tables/{name} resource instead).

  it("rejects SHOW COLUMNS FROM <table>", async () => {
    const { executeReadOnlyQuery } = await reloadDbModule({
      ENABLE_PII_REDACTION: "true",
      PII_ALLOW_INTROSPECTION: undefined,
    });
    const result = await executeReadOnlyQuery<any>(
      `SHOW COLUMNS FROM ${DB_NAME}.pii_users`,
    );
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("introspection");
    expect(result.content[0].text).toContain("mysql://tables");
    expect(result.content[0].text).toContain("PII_ALLOW_INTROSPECTION");
  });

  it("rejects SHOW FULL COLUMNS (which the SQL parser can't parse)", async () => {
    // node-sql-parser refuses `SHOW FULL COLUMNS`; the textual pre-screen
    // is what catches it. This test pins that behaviour.
    const { executeReadOnlyQuery } = await reloadDbModule({
      ENABLE_PII_REDACTION: "true",
      PII_ALLOW_INTROSPECTION: undefined,
    });
    const result = await executeReadOnlyQuery<any>(
      `SHOW FULL COLUMNS FROM ${DB_NAME}.pii_users`,
    );
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("introspection");
  });

  it("rejects DESCRIBE <table>", async () => {
    const { executeReadOnlyQuery } = await reloadDbModule({
      ENABLE_PII_REDACTION: "true",
      PII_ALLOW_INTROSPECTION: undefined,
    });
    const result = await executeReadOnlyQuery<any>(
      `DESCRIBE ${DB_NAME}.pii_users`,
    );
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("introspection");
  });

  it("rejects SELECT FROM information_schema.columns", async () => {
    const { executeReadOnlyQuery } = await reloadDbModule({
      ENABLE_PII_REDACTION: "true",
      PII_ALLOW_INTROSPECTION: undefined,
    });
    const result = await executeReadOnlyQuery<any>(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'pii_users'`,
    );
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("introspection");
  });

  it("PII_ALLOW_INTROSPECTION=true opts out of the introspection gate", async () => {
    const { executeReadOnlyQuery } = await reloadDbModule({
      ENABLE_PII_REDACTION: "true",
      PII_ALLOW_INTROSPECTION: "true",
      // SHOW COLUMNS results contain a `Field` column whose values are
      // column names; these names happen to include things like `email`,
      // which the value-level redactor will then mask. That's fine — we
      // only need to assert that the executor accepted the query and ran
      // it (no longer treating it as a hard rejection).
    });
    const result = await executeReadOnlyQuery<any>(
      `SHOW COLUMNS FROM ${DB_NAME}.pii_users`,
    );
    expect(result.isError).toBe(false);
  });

  it("does not block introspection when ENABLE_PII_REDACTION is unset", async () => {
    const { executeReadOnlyQuery } = await reloadDbModule({
      ENABLE_PII_REDACTION: undefined,
      PII_ALLOW_INTROSPECTION: undefined,
    });
    const result = await executeReadOnlyQuery<any>(
      `SHOW COLUMNS FROM ${DB_NAME}.pii_users`,
    );
    expect(result.isError).toBe(false);
  });
});
