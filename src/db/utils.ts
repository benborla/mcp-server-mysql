import { isMultiDbMode } from "./../config/index.js";
import { log } from "./../utils/index.js";
import SqlParser, { AST } from "node-sql-parser";

const { Parser } = SqlParser;
const parser = new Parser();

// Extract schema from SQL query
function extractSchemaFromQuery(sql: string): string | null {
  // Default schema from environment
  const defaultSchema = process.env.MYSQL_DB || null;

  // If we have a default schema and not in multi-DB mode, return it
  if (defaultSchema && !isMultiDbMode) {
    return defaultSchema;
  }

  // Try to extract schema from query

  // Case 1: USE database statement
  const useMatch = sql.match(/USE\s+`?([a-zA-Z0-9_]+)`?/i);
  if (useMatch && useMatch[1]) {
    return useMatch[1];
  }

  // Case 2: database.table notation
  const dbTableMatch = sql.match(/`?([a-zA-Z0-9_]+)`?\.`?[a-zA-Z0-9_]+`?/i);
  if (dbTableMatch && dbTableMatch[1]) {
    return dbTableMatch[1];
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

/**
 * Detect column wildcards (`SELECT *` or `SELECT t.*`) anywhere in the query,
 * including inside subqueries. Aggregate forms like `COUNT(*)` are *not*
 * flagged because the parser represents those as a `star`-typed expression
 * argument rather than a `column_ref` with column `"*"`.
 *
 * Returns false (i.e. allows the query through) if the SQL fails to parse —
 * downstream `executeQuery` will surface the parse error in its normal error
 * path. We don't want a parser hiccup to block otherwise valid queries here.
 */
function containsSelectStar(sql: string): boolean {
  let astOrArray: AST | AST[];
  try {
    astOrArray = parser.astify(sql, { database: "mysql" });
  } catch {
    return false;
  }
  const statements = Array.isArray(astOrArray) ? astOrArray : [astOrArray];
  return statements.some((stmt) => nodeHasColumnStar(stmt));
}

function nodeHasColumnStar(node: unknown): boolean {
  if (node == null || typeof node !== "object") return false;
  if (node instanceof Date) return false;

  const obj = node as Record<string, unknown>;

  // A bare/qualified column wildcard projection.
  if (obj.type === "column_ref" && obj.column === "*") return true;

  for (const value of Object.values(obj)) {
    if (Array.isArray(value)) {
      if (value.some((item) => nodeHasColumnStar(item))) return true;
    } else if (value && typeof value === "object") {
      if (nodeHasColumnStar(value)) return true;
    }
  }
  return false;
}

export { extractSchemaFromQuery, getQueryTypes, containsSelectStar };
