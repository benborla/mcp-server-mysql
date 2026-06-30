import { describe, it, expect } from "vitest";
import { getQueryTypes } from "../../src/db/utils.js";

describe("getQueryTypes", () => {
  describe("standard DML statements", () => {
    it("classifies SELECT as select", async () => {
      expect(await getQueryTypes("SELECT id FROM users")).toEqual(["select"]);
    });

    it("classifies INSERT as insert", async () => {
      expect(
        await getQueryTypes("INSERT INTO users (name) VALUES ('alice')"),
      ).toEqual(["insert"]);
    });

    it("classifies UPDATE as update", async () => {
      expect(
        await getQueryTypes("UPDATE users SET name = 'bob' WHERE id = 1"),
      ).toEqual(["update"]);
    });

    it("classifies DELETE as delete", async () => {
      expect(await getQueryTypes("DELETE FROM users WHERE id = 1")).toEqual([
        "delete",
      ]);
    });
  });

  describe("EXPLAIN without modifiers", () => {
    it("classifies EXPLAIN SELECT as explain", async () => {
      expect(
        await getQueryTypes("EXPLAIN SELECT id FROM users"),
      ).toEqual(["explain"]);
    });
  });

  describe("EXPLAIN ANALYZE and other modifiers (MySQL 8.0+)", () => {
    it("classifies EXPLAIN ANALYZE SELECT as explain (not a parse error)", async () => {
      expect(
        await getQueryTypes("EXPLAIN ANALYZE SELECT id FROM users"),
      ).toEqual(["explain"]);
    });

    it("classifies EXPLAIN ANALYZE SELECT with lowercase as explain", async () => {
      expect(
        await getQueryTypes("explain analyze select id from users"),
      ).toEqual(["explain"]);
    });

    it("classifies EXPLAIN ANALYZE SELECT with a WHERE clause as explain", async () => {
      expect(
        await getQueryTypes(
          "EXPLAIN ANALYZE SELECT id, name FROM users WHERE id > 10",
        ),
      ).toEqual(["explain"]);
    });

    it("classifies EXPLAIN FORMAT=JSON SELECT as explain", async () => {
      expect(
        await getQueryTypes("EXPLAIN FORMAT=JSON SELECT id FROM users"),
      ).toEqual(["explain"]);
    });

    it("classifies EXPLAIN FORMAT = TREE SELECT as explain (spaces around =)", async () => {
      expect(
        await getQueryTypes("EXPLAIN FORMAT = TREE SELECT id FROM users"),
      ).toEqual(["explain"]);
    });

    it("classifies EXPLAIN EXTENDED SELECT as explain", async () => {
      expect(
        await getQueryTypes("EXPLAIN EXTENDED SELECT id FROM users"),
      ).toEqual(["explain"]);
    });

    it("classifies EXPLAIN PARTITIONS SELECT as explain", async () => {
      expect(
        await getQueryTypes("EXPLAIN PARTITIONS SELECT id FROM users"),
      ).toEqual(["explain"]);
    });

    it("classifies EXPLAIN ANALYZE FORMAT=JSON SELECT (multiple modifiers) as explain", async () => {
      expect(
        await getQueryTypes(
          "EXPLAIN ANALYZE FORMAT=JSON SELECT id FROM users",
        ),
      ).toEqual(["explain"]);
    });
  });

  describe("EXPLAIN is not a write operation", () => {
    it("EXPLAIN ANALYZE SELECT does not appear in write-operation type lists", async () => {
      const types = await getQueryTypes(
        "EXPLAIN ANALYZE SELECT id FROM users",
      );
      const writeTypes = [
        "insert",
        "update",
        "delete",
        "create",
        "alter",
        "drop",
        "truncate",
      ];
      expect(types.some((t) => writeTypes.includes(t))).toBe(false);
    });
  });

  describe("throws on genuinely invalid SQL", () => {
    it("throws Parsing failed for non-SQL input", async () => {
      await expect(
        getQueryTypes("THIS IS NOT VALID SQL ;;;"),
      ).rejects.toThrow("Parsing failed");
    });
  });
});
