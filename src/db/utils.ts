import { isMultiDbMode } from "./../config/index.js";
import { log } from "./../utils/index.js";
import SqlParser, { AST } from "node-sql-parser";

const { Parser } = SqlParser;
const parser = new Parser();

// Extract schema from SQL query using the AST parser for accuracy.
// Previous regex-based extraction could be bypassed with SQL comments
// (e.g. USE/**/schema_name) which allowed schema permission checks to
// fall through to the global default.
function extractSchemaFromQuery(sql: string): string | null {
  // Default schema from environment
  const defaultSchema = process.env.MYSQL_DB || null;

  // If we have a default schema and not in multi-DB mode, return it
  if (defaultSchema && !isMultiDbMode) {
    return defaultSchema;
  }

  // Use the AST parser to reliably extract schema information
  try {
    const astOrArray: AST | AST[] = parser.astify(sql, { database: "mysql" });
    const statements = Array.isArray(astOrArray) ? astOrArray : [astOrArray];

    for (const stmt of statements) {
      // Case 1: USE database statement
      if (stmt.type === "use" && (stmt as any).db) {
        return (stmt as any).db;
      }

      // Case 2: database.table notation in FROM/INTO clauses
      const tables = (stmt as any).table || (stmt as any).from;
      if (Array.isArray(tables)) {
        for (const t of tables) {
          if (t.db) {
            return t.db;
          }
        }
      } else if (tables && typeof tables === "object" && tables.db) {
        return tables.db;
      }
    }
  } catch (err: any) {
    log("error", "Failed to parse SQL for schema extraction:", err.message);
  }

  // Return default if we couldn't find a schema in the query
  return defaultSchema;
}

async function getQueryTypes(query: string): Promise<string[]> {
  try {
    log("info", "Parsing SQL query: ", query);
    // Parse into AST or array of ASTs - only specify the database type
    const astOrArray: AST | AST[] = parser.astify(query, { database: "mysql" });
    const statements = Array.isArray(astOrArray) ? astOrArray : [astOrArray];

    // Map each statement to its lowercased type (e.g., 'select', 'update', 'insert', 'delete', etc.)
    return statements.map((stmt) => stmt.type?.toLowerCase() ?? "unknown");
  } catch (err: any) {
    log("error", "sqlParser error, query: ", query);
    log("error", "Error parsing SQL query:", err);
    throw new Error(`Parsing failed: ${err.message}`);
  }
}

export { extractSchemaFromQuery, getQueryTypes };
