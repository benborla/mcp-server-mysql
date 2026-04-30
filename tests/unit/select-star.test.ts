import { describe, it, expect } from "vitest";
import { containsSelectStar } from "../../src/db/utils.js";

describe("containsSelectStar", () => {
  describe("flags wildcard column projections", () => {
    it("matches plain SELECT *", () => {
      expect(containsSelectStar("SELECT * FROM users")).toBe(true);
    });

    it("matches qualified SELECT t.*", () => {
      expect(containsSelectStar("SELECT u.* FROM users u")).toBe(true);
    });

    it("matches mixed projection with t.*", () => {
      expect(containsSelectStar("SELECT id, u.* FROM users u")).toBe(true);
    });

    it("matches SELECT * inside an EXISTS subquery", () => {
      expect(
        containsSelectStar(
          "SELECT 1 WHERE EXISTS(SELECT * FROM users)",
        ),
      ).toBe(true);
    });

    it("matches SELECT * inside a derived table", () => {
      expect(
        containsSelectStar(
          "SELECT id FROM (SELECT * FROM users) AS sub",
        ),
      ).toBe(true);
    });

    it("matches SELECT * regardless of casing/whitespace", () => {
      expect(containsSelectStar("select   *   from users")).toBe(true);
    });
  });

  describe("does not flag aggregate or non-wildcard projections", () => {
    it("allows COUNT(*)", () => {
      expect(containsSelectStar("SELECT COUNT(*) FROM users")).toBe(false);
    });

    it("allows COUNT(*) with alias", () => {
      expect(containsSelectStar("SELECT COUNT(*) AS n FROM users")).toBe(false);
    });

    it("allows explicit column lists", () => {
      expect(
        containsSelectStar("SELECT id, name FROM users"),
      ).toBe(false);
    });

    it("allows SUM/AVG aggregates", () => {
      expect(
        containsSelectStar("SELECT SUM(price), AVG(rating) FROM items"),
      ).toBe(false);
    });
  });

  describe("safe behaviour on parser failure", () => {
    it("returns false (does not block) when SQL fails to parse", () => {
      expect(containsSelectStar("THIS IS NOT VALID SQL ;;;")).toBe(false);
    });
  });
});
