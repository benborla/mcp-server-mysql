import { describe, it, expect } from "vitest";
import { findPIIColumnReferences } from "../../src/db/utils.js";
import {
  isPIIColumn,
  DEFAULT_PII_COLUMNS,
} from "../../src/security/redact.js";

/**
 * Test helper: wires `findPIIColumnReferences` to the same default PII
 * column-name policy used by `executeReadOnlyQuery` in production. Tests
 * stay focused on the AST-walking logic instead of repeating the policy
 * configuration in every assertion.
 */
function find(sql: string) {
  return findPIIColumnReferences(sql, (col) =>
    isPIIColumn(col, DEFAULT_PII_COLUMNS, []),
  );
}

describe("findPIIColumnReferences", () => {
  describe("catches PII column references", () => {
    it("flags qualified u.FIRST_NAME in projection", () => {
      const hits = find("SELECT u.FIRST_NAME FROM users u");
      expect(hits).toContainEqual({ table: "u", column: "FIRST_NAME" });
    });

    it("flags bare first_name in projection", () => {
      const hits = find("SELECT first_name FROM users");
      expect(hits).toContainEqual({ table: null, column: "first_name" });
    });

    it("flags PII columns inside CONCAT(...) AS NAME (the alias-bypass case)", () => {
      // The user's exact failing query shape. The alias `NAME` would slip
      // past the result-key redactor; the column-reference guard does not
      // care about the alias because it walks the input expression.
      const sql = `SELECT u.USER_ID, CONCAT(COALESCE(u.FIRST_NAME, ''), ' ', COALESCE(u.LAST_NAME, '')) AS NAME, u.EMAIL_ADDRESS FROM users u`;
      const hits = find(sql);
      const cols = hits.map((h) => h.column);
      expect(cols).toContain("FIRST_NAME");
      expect(cols).toContain("LAST_NAME");
      expect(cols).toContain("EMAIL_ADDRESS");
    });

    it("flags PII inside CASE expressions", () => {
      const sql =
        "SELECT CASE WHEN u.email IS NULL THEN 'none' ELSE 'set' END AS status FROM users u";
      const hits = find(sql);
      expect(hits.map((h) => h.column)).toContain("email");
    });

    it("flags PII inside SUBSTRING / LOWER", () => {
      const sql = "SELECT LOWER(SUBSTRING(email, 1, 3)) AS prefix FROM users";
      const hits = find(sql);
      expect(hits.map((h) => h.column)).toContain("email");
    });

    it("flags PII referenced in WHERE", () => {
      const hits = find(
        "SELECT id FROM users WHERE first_name = 'John'",
      );
      expect(hits.map((h) => h.column)).toContain("first_name");
    });

    it("flags PII referenced in ORDER BY (side-channel via row order)", () => {
      const hits = find("SELECT id FROM users ORDER BY last_name");
      expect(hits.map((h) => h.column)).toContain("last_name");
    });

    it("flags PII referenced in GROUP BY", () => {
      const hits = find(
        "SELECT COUNT(*) AS n FROM users GROUP BY email",
      );
      expect(hits.map((h) => h.column)).toContain("email");
    });

    it("flags PII referenced in HAVING", () => {
      const hits = find(
        "SELECT id, COUNT(*) c FROM users GROUP BY id HAVING email IS NOT NULL",
      );
      expect(hits.map((h) => h.column)).toContain("email");
    });

    it("flags PII used in a JOIN ON predicate", () => {
      const sql =
        "SELECT u.id FROM users u JOIN contacts c ON c.email = u.email";
      const hits = find(sql);
      expect(hits.map((h) => h.column)).toContain("email");
    });

    it("flags PII referenced inside a subquery", () => {
      const sql =
        "SELECT id FROM users WHERE id IN (SELECT user_id FROM audit WHERE phone = '555-1234')";
      const hits = find(sql);
      expect(hits.map((h) => h.column)).toContain("phone");
    });

    it("flags PII referenced inside a derived table", () => {
      const sql =
        "SELECT sub.id FROM (SELECT id, first_name FROM users) AS sub";
      const hits = find(sql);
      expect(hits.map((h) => h.column)).toContain("first_name");
    });

    it("flags PII inside an INSERT ... SELECT source", () => {
      const sql =
        "INSERT INTO archive (id, n) SELECT id, last_name FROM users";
      const hits = find(sql);
      expect(hits.map((h) => h.column)).toContain("last_name");
    });

    it("de-duplicates repeated references to the same column", () => {
      const sql =
        "SELECT u.email FROM users u WHERE u.email IS NOT NULL ORDER BY u.email";
      const hits = find(sql);
      // One entry, even though `u.email` appears three times.
      expect(hits).toEqual([{ table: "u", column: "email" }]);
    });
  });

  describe("does not flag safe queries", () => {
    it("returns [] for an explicit safe projection", () => {
      expect(find("SELECT id, registration_date FROM users")).toEqual([]);
    });

    it("returns [] when an alias merely happens to be 'name'", () => {
      // Alias-on-output should not cause a false positive: `id AS NAME`
      // does not reference any PII column on the input side.
      expect(find("SELECT id AS NAME FROM users")).toEqual([]);
    });

    it("returns [] for a COUNT(*) aggregate", () => {
      expect(find("SELECT COUNT(*) AS n FROM users")).toEqual([]);
    });

    it("returns [] for non-PII columns that happen to contain 'name' as a non-substring match", () => {
      // `id` and `status` should pass; the test guards against an over-eager
      // policy that flags every column.
      expect(find("SELECT id, status FROM users")).toEqual([]);
    });
  });

  describe("safe behaviour on parser failure", () => {
    it("returns [] when SQL fails to parse instead of throwing", () => {
      // Fail-open matches the convention in `containsSelectStar`: the
      // downstream executor surfaces the parse error in its normal path.
      expect(find("THIS IS NOT VALID SQL ;;;")).toEqual([]);
    });
  });
});
