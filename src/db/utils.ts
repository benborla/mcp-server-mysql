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

/**
 * MySQL EXPLAIN accepts optional modifiers between EXPLAIN and the statement:
 *   ANALYZE, EXTENDED, PARTITIONS, FORMAT=<word>
 *
 * node-sql-parser only understands bare `EXPLAIN <statement>` — any modifier
 * after EXPLAIN causes a parse error. Strip them before handing to the parser
 * so that e.g. `EXPLAIN ANALYZE SELECT …` is treated the same as
 * `EXPLAIN SELECT …` (operation type `"explain"`, routed as read-only).
 *
 * Multiple modifiers may appear together, e.g. `EXPLAIN ANALYZE FORMAT=JSON`.
 */
const EXPLAIN_MODIFIER_RE =
  /^(\s*EXPLAIN\s+)((?:ANALYZE\s+|EXTENDED\s+|PARTITIONS\s+|FORMAT\s*=\s*\w+\s+)+)/i;

function stripExplainModifiers(sql: string): string {
  return sql.replace(EXPLAIN_MODIFIER_RE, "$1");
}

async function getQueryTypes(query: string): Promise<string[]> {
  try {
    log("info", "Parsing SQL query: ", query);
    // Strip unsupported EXPLAIN modifiers (ANALYZE, FORMAT=…, EXTENDED, PARTITIONS)
    // before parsing so node-sql-parser can handle them.
    const normalised = stripExplainModifiers(query);
    // Parse into AST or array of ASTs - only specify the database type
    const astOrArray: AST | AST[] = parser.astify(normalised, { database: "mysql" });
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

/**
 * Reference to a column in the parsed SQL. `table` is the table-qualifier from
 * the SQL (alias or table name), or `null` for an unqualified reference.
 */
export interface PIIColumnReference {
  table: string | null;
  column: string;
}

/**
 * Walk the AST of `sql` and return every `column_ref` whose column name passes
 * `isPII`. Walks naturally cover SELECT projection, WHERE, JOIN ON, GROUP BY,
 * HAVING, ORDER BY, subqueries, CTEs, and `INSERT ... SELECT` because we
 * recurse into every nested object/array regardless of key name.
 *
 * Returns `[]` on parse failure (fail-open, matching `containsSelectStar`).
 * Downstream `executeQuery` will surface the parse error in its normal path;
 * we don't want a parser hiccup here to block otherwise valid queries.
 *
 * Duplicates are de-duplicated on `table`+`column` so the rejection message
 * stays compact when a column is referenced multiple times.
 */
function findPIIColumnReferences(
  sql: string,
  isPII: (column: string) => boolean,
): PIIColumnReference[] {
  let astOrArray: AST | AST[];
  try {
    astOrArray = parser.astify(sql, { database: "mysql" });
  } catch {
    return [];
  }
  const statements = Array.isArray(astOrArray) ? astOrArray : [astOrArray];
  const seen = new Set<string>();
  const hits: PIIColumnReference[] = [];
  for (const stmt of statements) {
    collectPIIColumnRefs(stmt, isPII, seen, hits);
  }
  return hits;
}

function collectPIIColumnRefs(
  node: unknown,
  isPII: (column: string) => boolean,
  seen: Set<string>,
  out: PIIColumnReference[],
): void {
  if (node == null || typeof node !== "object") return;
  if (node instanceof Date) return;

  const obj = node as Record<string, unknown>;

  if (
    obj.type === "column_ref" &&
    typeof obj.column === "string" &&
    obj.column !== "*" &&
    isPII(obj.column)
  ) {
    const table = typeof obj.table === "string" ? obj.table : null;
    const key = `${table ?? ""}.${obj.column}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push({ table, column: obj.column });
    }
  }

  for (const value of Object.values(obj)) {
    if (Array.isArray(value)) {
      for (const item of value) collectPIIColumnRefs(item, isPII, seen, out);
    } else if (value && typeof value === "object") {
      collectPIIColumnRefs(value, isPII, seen, out);
    }
  }
}

/**
 * Categorisation of a query that would let the LLM enumerate column names.
 * `null` means the query is not an introspection query (under our policy).
 */
export type IntrospectionKind =
  | "show_columns"
  | "show_create"
  | "show_index"
  // Table-/database-level metadata listings that expose only schema topology
  // (table names, database names, charset/collation lists). They have no
  // column-level information, so the executor lets them run unchanged.
  | "show_passthrough"
  | "show_other"
  | "describe"
  | "information_schema"
  | "mysql_schema";

export interface IntrospectionResult {
  kind: IntrospectionKind | null;
}

// Statements that node-sql-parser can't parse but still leak schema (e.g.
// `SHOW FULL COLUMNS FROM users`, `SHOW FIELDS FROM users`). We pre-screen
// for these via a textual check before falling through to the AST walk.
const SHOW_INTROSPECTION_RE =
  /^\s*SHOW\s+(?:FULL\s+)?(COLUMNS|FIELDS|CREATE\s+TABLE|CREATE\s+VIEW|INDEX(?:ES)?|KEYS|TABLE\s+STATUS|TABLES|DATABASES|SCHEMAS|CHARACTER\s+SET|CHARSET|COLLATION)\b/i;
const DESCRIBE_RE = /^\s*(?:DESCRIBE|DESC)\s+/i;
// `EXPLAIN <table>` is a synonym for `DESCRIBE <table>` and produces the same
// SHOW COLUMNS-shaped result. We classify it as introspection so the row
// filter applies. We must NOT match `EXPLAIN <select-stmt>` etc., because
// those are query-plan inspections — their result rows have a totally
// different shape, and the SQL itself can reference PII columns that the
// column-reference guard needs to see. The negative look-ahead lists the
// query-statement keywords MySQL accepts after EXPLAIN.
const EXPLAIN_TABLE_RE =
  /^\s*EXPLAIN\s+(?!SELECT\b|INSERT\b|UPDATE\b|DELETE\b|REPLACE\b|ANALYZE\b|FORMAT\b|FOR\s|EXTENDED\b|PARTITIONS\b|\()[A-Za-z_`]/i;

/**
 * Identify queries that expose schema/column metadata. Combines a textual
 * pre-screen (catches statements the parser doesn't understand, like
 * `SHOW FULL COLUMNS FROM users`) with an AST walk (catches `db.table`
 * references to `information_schema` or `mysql` anywhere in the query,
 * including inside subqueries and joins).
 *
 * On parse failure with no textual match, returns `{ kind: null }` — the
 * downstream executor will reject or surface the parse error normally.
 */
function isIntrospectionQuery(sql: string): IntrospectionResult {
  const showMatch = sql.match(SHOW_INTROSPECTION_RE);
  if (showMatch) {
    const keyword = showMatch[1].toUpperCase().replace(/\s+/g, " ");
    if (keyword.startsWith("COLUMNS") || keyword.startsWith("FIELDS")) {
      return { kind: "show_columns" };
    }
    if (keyword.startsWith("CREATE")) {
      return { kind: "show_create" };
    }
    if (
      keyword.startsWith("INDEX") ||
      keyword.startsWith("KEYS")
    ) {
      return { kind: "show_index" };
    }
    // Table-/database-level listings: schema topology only, no column data.
    if (
      keyword === "TABLES" ||
      keyword.startsWith("TABLE STATUS") ||
      keyword === "DATABASES" ||
      keyword === "SCHEMAS" ||
      keyword.startsWith("CHARACTER") ||
      keyword === "CHARSET" ||
      keyword === "COLLATION"
    ) {
      return { kind: "show_passthrough" };
    }
    return { kind: "show_other" };
  }
  if (DESCRIBE_RE.test(sql) || EXPLAIN_TABLE_RE.test(sql)) {
    return { kind: "describe" };
  }

  let astOrArray: AST | AST[];
  try {
    astOrArray = parser.astify(sql, { database: "mysql" });
  } catch {
    return { kind: null };
  }
  const statements = Array.isArray(astOrArray) ? astOrArray : [astOrArray];
  for (const stmt of statements) {
    const kind = findIntrospectionKind(stmt);
    if (kind) return { kind };
  }
  return { kind: null };
}

function findIntrospectionKind(node: unknown): IntrospectionKind | null {
  if (node == null || typeof node !== "object") return null;
  if (node instanceof Date) return null;

  const obj = node as Record<string, unknown>;

  if (obj.type === "show") {
    const keyword =
      typeof obj.keyword === "string" ? obj.keyword.toLowerCase() : "";
    if (keyword === "columns" || keyword === "fields") return "show_columns";
    if (keyword === "create") return "show_create";
    if (keyword === "index" || keyword === "keys") return "show_index";
    // Table-/database-level listings: schema topology only, no column data.
    // Empirically the parser produces `keyword: "tables" / "databases" /
    // "character" / "collation"` for the parse-able cases. SHOW TABLE STATUS,
    // SHOW SCHEMAS, and SHOW CHARSET fail to parse entirely — those are
    // covered by the textual pre-screen at the top of `isIntrospectionQuery`.
    if (
      keyword === "tables" ||
      keyword === "databases" ||
      keyword === "character" ||
      keyword === "collation"
    ) {
      return "show_passthrough";
    }
    return "show_other";
  }
  if (obj.type === "desc" || obj.type === "describe") {
    return "describe";
  }

  // Reference to a metadata schema anywhere in the AST (`from`, JOIN target,
  // subquery, etc.). The AST stores the schema name in lowercase already, but
  // we lower again defensively for portability across parser versions.
  if (typeof obj.db === "string") {
    const db = obj.db.toLowerCase();
    if (db === "information_schema") return "information_schema";
    if (db === "mysql") return "mysql_schema";
  }

  for (const value of Object.values(obj)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        const kind = findIntrospectionKind(item);
        if (kind) return kind;
      }
    } else if (value && typeof value === "object") {
      const kind = findIntrospectionKind(value);
      if (kind) return kind;
    }
  }
  return null;
}

export {
  extractSchemaFromQuery,
  getQueryTypes,
  containsSelectStar,
  findPIIColumnReferences,
  isIntrospectionQuery,
};
