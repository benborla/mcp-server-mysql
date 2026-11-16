import { describe, it, expect } from "vitest";
import {
  extractSchemaFromQuery,
  extractSchemasFromQuery,
} from "../../src/db/utils.js";

describe("extractSchemasFromQuery", () => {
  it("extracts all referenced schemas from multi-table UPDATE ... JOIN", () => {
    const schemas = extractSchemasFromQuery(
      "UPDATE allowed_db.t1 JOIN restricted_db.t2 ON t1.id = t2.id SET t2.val = 1",
    );
    expect(schemas).toEqual(["allowed_db", "restricted_db"]);
  });

  it("extracts all referenced schemas from multi-table DELETE ... JOIN", () => {
    const schemas = extractSchemasFromQuery(
      "DELETE t2 FROM allowed_db.t1 JOIN restricted_db.t2 ON t1.id = t2.id",
    );
    expect(schemas).toEqual(["allowed_db", "restricted_db"]);
  });

  it("extracts all referenced schemas from multi-table DROP TABLE", () => {
    const schemas = extractSchemasFromQuery(
      "DROP TABLE allowed_db.t1, restricted_db.t2",
    );
    expect(schemas).toEqual(["allowed_db", "restricted_db"]);
  });

  it("extracts schema from TRUNCATE TABLE", () => {
    const schemas = extractSchemasFromQuery("TRUNCATE TABLE restricted_db.t2");
    expect(schemas).toEqual(["restricted_db"]);
  });

  it("extracts schemas across USE and subsequent statements", () => {
    const schemas = extractSchemasFromQuery(
      "USE allowed_db; UPDATE restricted_db.t2 SET val = 1",
    );
    expect(schemas).toEqual(["allowed_db", "restricted_db"]);
  });

  it("preserves extractSchemaFromQuery single-schema return compatibility", () => {
    expect(
      extractSchemaFromQuery("INSERT INTO staging_db.users (name) VALUES ('a')"),
    ).toBe("staging_db");
  });
});
