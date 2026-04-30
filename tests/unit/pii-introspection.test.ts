import { describe, it, expect } from "vitest";
import { isIntrospectionQuery } from "../../src/db/utils.js";

describe("isIntrospectionQuery", () => {
  describe("flags SHOW-family introspection (textual pre-screen)", () => {
    it("flags SHOW COLUMNS FROM users", () => {
      expect(isIntrospectionQuery("SHOW COLUMNS FROM users").kind).toBe(
        "show_columns",
      );
    });

    it("flags SHOW FULL COLUMNS FROM users (parser doesn't accept this; pre-screen catches it)", () => {
      // node-sql-parser refuses `SHOW FULL COLUMNS`; relying on the AST alone
      // would let this through. The regex pre-screen is what closes the gap.
      expect(
        isIntrospectionQuery("SHOW FULL COLUMNS FROM users").kind,
      ).toBe("show_columns");
    });

    it("flags SHOW FIELDS FROM users (alias for SHOW COLUMNS)", () => {
      expect(isIntrospectionQuery("SHOW FIELDS FROM users").kind).toBe(
        "show_columns",
      );
    });

    it("flags SHOW CREATE TABLE users", () => {
      expect(
        isIntrospectionQuery("SHOW CREATE TABLE users").kind,
      ).toBe("show_create");
    });

    it("flags SHOW CREATE VIEW users_v", () => {
      expect(
        isIntrospectionQuery("SHOW CREATE VIEW users_v").kind,
      ).toBe("show_create");
    });

    it("flags SHOW INDEX FROM users", () => {
      expect(isIntrospectionQuery("SHOW INDEX FROM users").kind).toBe(
        "show_index",
      );
    });

    it("flags SHOW INDEXES FROM users", () => {
      expect(isIntrospectionQuery("SHOW INDEXES FROM users").kind).toBe(
        "show_index",
      );
    });

    it("flags SHOW KEYS FROM users", () => {
      expect(isIntrospectionQuery("SHOW KEYS FROM users").kind).toBe(
        "show_index",
      );
    });

    it("classifies SHOW TABLES as show_passthrough (no column-level PII)", () => {
      // Table enumeration exposes schema topology only — no column data — so
      // it's safe to let through under PII redaction. The hard-block escape
      // valve (PII_BLOCK_INTROSPECTION) still rejects it.
      expect(isIntrospectionQuery("SHOW TABLES").kind).toBe("show_passthrough");
    });

    it("classifies SHOW TABLE STATUS as show_passthrough", () => {
      expect(isIntrospectionQuery("SHOW TABLE STATUS").kind).toBe(
        "show_passthrough",
      );
    });

    it("classifies SHOW DATABASES as show_passthrough", () => {
      expect(isIntrospectionQuery("SHOW DATABASES").kind).toBe(
        "show_passthrough",
      );
    });

    it("classifies SHOW SCHEMAS as show_passthrough (alias for SHOW DATABASES)", () => {
      // node-sql-parser fails to parse `SHOW SCHEMAS`; the textual pre-screen
      // is what classifies it.
      expect(isIntrospectionQuery("SHOW SCHEMAS").kind).toBe(
        "show_passthrough",
      );
    });

    it("classifies SHOW CHARACTER SET as show_passthrough", () => {
      expect(isIntrospectionQuery("SHOW CHARACTER SET").kind).toBe(
        "show_passthrough",
      );
    });

    it("classifies SHOW CHARSET as show_passthrough (alias for SHOW CHARACTER SET)", () => {
      // node-sql-parser fails on `SHOW CHARSET`; pre-screen handles it.
      expect(isIntrospectionQuery("SHOW CHARSET").kind).toBe(
        "show_passthrough",
      );
    });

    it("classifies SHOW COLLATION as show_passthrough", () => {
      expect(isIntrospectionQuery("SHOW COLLATION").kind).toBe(
        "show_passthrough",
      );
    });

    it("does NOT classify SHOW PROCESSLIST as passthrough (falls to show_other → blocked)", () => {
      // Unknown SHOW shapes must default to the rejected bucket so we don't
      // accidentally surface server-internal data the LLM shouldn't see.
      expect(isIntrospectionQuery("SHOW PROCESSLIST").kind).toBe("show_other");
    });

    it("is case-insensitive", () => {
      expect(isIntrospectionQuery("show columns from users").kind).toBe(
        "show_columns",
      );
    });
  });

  describe("flags DESCRIBE / DESC / EXPLAIN", () => {
    it("flags DESCRIBE users", () => {
      expect(isIntrospectionQuery("DESCRIBE users").kind).toBe("describe");
    });

    it("flags DESC users", () => {
      expect(isIntrospectionQuery("DESC users").kind).toBe("describe");
    });

    it("flags EXPLAIN users (extended-describe form)", () => {
      // MySQL's `EXPLAIN tbl_name` is a synonym for `DESCRIBE tbl_name`.
      // Treating it as introspection prevents the LLM from learning columns
      // by EXPLAINing a table directly.
      expect(isIntrospectionQuery("EXPLAIN users").kind).toBe("describe");
    });

    it("flags EXPLAIN db.users (qualified)", () => {
      expect(isIntrospectionQuery("EXPLAIN mydb.users").kind).toBe("describe");
    });

    it("does NOT flag EXPLAIN <SELECT> as describe (it's a query plan, not column metadata)", () => {
      // Critical: this case must fall through to the column-reference guard
      // so PII columns referenced inside the SELECT are still rejected.
      // Otherwise the introspection filter would receive a query-plan-shaped
      // result and the row-shape mismatch would mask whatever protection we
      // think we have.
      expect(isIntrospectionQuery("EXPLAIN SELECT email FROM users").kind).toBeNull();
    });

    it("does NOT flag EXPLAIN INSERT/UPDATE/DELETE", () => {
      expect(
        isIntrospectionQuery("EXPLAIN INSERT INTO users (email) VALUES ('x@y.z')").kind,
      ).toBeNull();
      expect(
        isIntrospectionQuery("EXPLAIN UPDATE users SET email = 'x' WHERE id = 1").kind,
      ).toBeNull();
      expect(
        isIntrospectionQuery("EXPLAIN DELETE FROM users WHERE id = 1").kind,
      ).toBeNull();
    });

    it("does NOT flag EXPLAIN ANALYZE / EXPLAIN FORMAT=JSON / EXPLAIN FOR CONNECTION", () => {
      expect(
        isIntrospectionQuery("EXPLAIN ANALYZE SELECT id FROM users").kind,
      ).toBeNull();
      expect(
        isIntrospectionQuery("EXPLAIN FORMAT=JSON SELECT id FROM users").kind,
      ).toBeNull();
      expect(
        isIntrospectionQuery("EXPLAIN FOR CONNECTION 42").kind,
      ).toBeNull();
    });
  });

  describe("flags information_schema and mysql metadata access", () => {
    it("flags SELECT FROM information_schema.columns", () => {
      const sql =
        "SELECT column_name FROM information_schema.columns WHERE table_name = 'users'";
      expect(isIntrospectionQuery(sql).kind).toBe("information_schema");
    });

    it("flags INFORMATION_SCHEMA.COLUMNS regardless of casing", () => {
      const sql =
        "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='users'";
      expect(isIntrospectionQuery(sql).kind).toBe("information_schema");
    });

    it("flags JOIN against information_schema.columns", () => {
      const sql = `SELECT t.id FROM mydb.t t JOIN information_schema.columns c ON c.table_name = 'users'`;
      expect(isIntrospectionQuery(sql).kind).toBe("information_schema");
    });

    it("flags information_schema reference inside a subquery", () => {
      const sql = `SELECT 1 WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'mydb')`;
      expect(isIntrospectionQuery(sql).kind).toBe("information_schema");
    });

    it("flags SELECT FROM mysql.user (the system database)", () => {
      const sql = "SELECT user, host FROM mysql.user";
      expect(isIntrospectionQuery(sql).kind).toBe("mysql_schema");
    });
  });

  describe("does not flag regular queries", () => {
    it("does not flag a normal SELECT against a user table", () => {
      expect(
        isIntrospectionQuery("SELECT id, name FROM mydb.users").kind,
      ).toBeNull();
    });

    it("does not flag a SELECT against a table whose name contains 'columns'", () => {
      // A user table coincidentally named `columns` should not be confused
      // with `information_schema.columns`. The AST walk inspects `db`, not
      // `table`, so this is safe.
      expect(
        isIntrospectionQuery("SELECT id FROM mydb.columns").kind,
      ).toBeNull();
    });

    it("does not flag CTE name 'columns' without information_schema reference", () => {
      const sql = `WITH columns AS (SELECT 1 AS x) SELECT * FROM columns`;
      // The CTE alias is `columns` but no `db` is `information_schema`;
      // the SELECT * itself is a separate concern handled by `containsSelectStar`.
      expect(isIntrospectionQuery(sql).kind).toBeNull();
    });

    it("returns null on parse failure with no textual match", () => {
      expect(isIntrospectionQuery("THIS IS NOT VALID SQL ;;;").kind).toBeNull();
    });
  });
});
