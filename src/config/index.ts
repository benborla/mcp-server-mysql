import * as dotenv from "dotenv";
import * as fs from "fs";
import { SchemaPermissions } from "../types/index.js";
import { parseSchemaPermissions, parseMySQLConnectionString } from "../utils/index.js";

/**
 * Read and validate an SSL file (certificate, key, or CA) for SSL connections.
 * @param filePath - Path to the SSL file (PEM format)
 * @param label - Human-readable label for error messages (e.g. "CA certificate", "client certificate")
 * @returns Buffer containing the file data
 * @throws Error if file doesn't exist, is empty, or cannot be read
 */
function readSSLFile(filePath: string, label: string): Buffer {
  try {
    // Check if file exists and is readable
    if (!fs.existsSync(filePath)) {
      throw new Error(`SSL ${label} file not found: ${filePath}`);
    }

    // Read the file
    const data = fs.readFileSync(filePath);

    // Basic validation - check it's not empty
    if (data.length === 0) {
      throw new Error(`SSL ${label} file is empty: ${filePath}`);
    }

    return data;
  } catch (error) {
    if (error instanceof Error) {
      // Re-throw our custom errors as-is
      if (error.message.startsWith('SSL ')) {
        throw error;
      }
      // Wrap other errors (like permission denied)
      throw new Error(`Failed to read SSL ${label}: ${error.message}`);
    }
    throw error;
  }
}

/**
 * Read and validate CA certificate file for SSL connections.
 * @param filePath - Path to the CA certificate file (PEM format)
 * @returns Buffer containing the certificate data
 * @throws Error if file doesn't exist, is empty, or cannot be read
 */
function readCACertificate(filePath: string): Buffer {
  return readSSLFile(filePath, 'CA certificate');
}

export const MCP_VERSION = "2.0.2";

// @INFO: Load environment variables from .env file
dotenv.config();

// @INFO: Parse connection string if provided
// Connection string takes precedence over individual environment variables
const connectionStringConfig = process.env.MYSQL_CONNECTION_STRING
  ? parseMySQLConnectionString(process.env.MYSQL_CONNECTION_STRING)
  : {};

// @INFO: Update the environment setup to ensure database is correctly set
if (process.env.NODE_ENV === "test" && !process.env.MYSQL_DB) {
  process.env.MYSQL_DB = "mcp_test_db"; // @INFO: Ensure we have a database name for tests
}

// Write operation flags (global defaults)
export const ALLOW_INSERT_OPERATION =
  process.env.ALLOW_INSERT_OPERATION === "true";
export const ALLOW_UPDATE_OPERATION =
  process.env.ALLOW_UPDATE_OPERATION === "true";
export const ALLOW_DELETE_OPERATION =
  process.env.ALLOW_DELETE_OPERATION === "true";
export const ALLOW_DDL_OPERATION = process.env.ALLOW_DDL_OPERATION === "true";

// Transaction mode control
export const MYSQL_DISABLE_READ_ONLY_TRANSACTIONS = 
  process.env.MYSQL_DISABLE_READ_ONLY_TRANSACTIONS === "true";

// PII redaction: when enabled, read-only query results are walked and
// sensitive values are partially masked before being returned to the client.
// See src/security/redact.ts for the detection and masking rules.
export const ENABLE_PII_REDACTION =
  process.env.ENABLE_PII_REDACTION === "true";

// Operator-defined additions to the column-name heuristic. Empty entries are
// filtered out — an empty substring would match every key and mask the entire
// response. Lowercased at parse time to match the key-lowercasing inside
// `isPIIColumn`.
export const PII_EXTRA_COLUMNS: readonly string[] = (
  process.env.PII_EXTRA_COLUMNS ?? ""
)
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter((s) => s.length > 0);

/**
 * Parse `PII_EXTRA_COLUMN_PATTERNS` into a list of compiled `RegExp` objects.
 * Entries are semicolon-separated (not comma) so commas inside character
 * classes like `[a-z,.]` stay unambiguous. Each entry is a regex *body* — no
 * slash delimiters, no explicit flags. We compile with `i` so operators do
 * not have to think about casing, and the runtime lowers the key before
 * testing anyway.
 *
 * Invalid patterns are logged and skipped; one bad entry must not crash the
 * server or poison the rest of the list.
 */
function parseColumnPatterns(raw: string | undefined): RegExp[] {
  if (!raw) return [];
  const out: RegExp[] = [];
  for (const entry of raw.split(";")) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    try {
      out.push(new RegExp(trimmed, "i"));
    } catch (err) {
      console.error(
        `[config] ignoring invalid PII_EXTRA_COLUMN_PATTERNS entry "${trimmed}": ${
          (err as Error).message
        }`,
      );
    }
  }
  return out;
}

export const PII_EXTRA_COLUMN_PATTERNS: readonly RegExp[] = parseColumnPatterns(
  process.env.PII_EXTRA_COLUMN_PATTERNS,
);

// When PII redaction is enabled, string column values that contain a valid JSON
// object or array are parsed and their inner fields are redacted by the same
// column-name heuristics as top-level columns. This catches PII inside audit
// columns like `new_value` / `old_value` whose column name alone does not
// trigger a PII rule. Set to false only if JSON parsing overhead is a concern.
export const PII_REDACT_JSON_STRINGS =
  process.env.PII_REDACT_JSON_STRINGS !== "false";

// When PII redaction is enabled, queries with `SELECT *` (or `t.*`) are
// rejected by default to force the LLM to project explicit column lists.
// Combined with PII column filtering in the schema response, this prevents
// the LLM from accidentally pulling redacted columns it never saw.
// Set `PII_ALLOW_SELECT_STAR=true` to opt out (e.g. for tables with no PII).
export const PII_ALLOW_SELECT_STAR =
  process.env.PII_ALLOW_SELECT_STAR === "true";

// When PII redaction is enabled, any reference to a column whose name matches
// a PII rule (built-in list, `PII_EXTRA_COLUMNS`, or `PII_EXTRA_COLUMN_PATTERNS`)
// causes the query to be rejected — regardless of where in the query the
// reference appears (projection, WHERE, JOIN ON, ORDER BY, subquery, ...).
// This closes the alias-bypass where `CONCAT(first_name, ' ', last_name) AS NAME`
// would render a redacted-column-aware result-key check useless.
// Set `PII_ALLOW_REFERENCES=true` to opt out.
export const PII_ALLOW_REFERENCES =
  process.env.PII_ALLOW_REFERENCES === "true";

// When PII redaction is enabled, queries that introspect schema metadata get
// special handling so the LLM can discover non-PII columns without ever seeing
// the PII ones:
//   - `SHOW COLUMNS`, `SHOW FULL COLUMNS`, `DESCRIBE`, `DESC`, `EXPLAIN <table>`,
//     `SHOW INDEX(ES)`, `SHOW KEYS` execute, and rows whose column-name field
//     matches a PII rule are filtered out of the response.
//   - `SHOW CREATE TABLE`, `SHOW CREATE VIEW`, `SHOW TABLES`, `SHOW TABLE STATUS`,
//     and any SELECT against `information_schema` / `mysql` schema are rejected
//     because they cannot be filtered safely without a custom parser.
// Set `PII_ALLOW_INTROSPECTION=true` to bypass both behaviours and return raw
// results unchanged.
export const PII_ALLOW_INTROSPECTION =
  process.env.PII_ALLOW_INTROSPECTION === "true";

// Optional stricter mode: restores the original "hard block" behaviour for
// every introspection statement (filterable kinds included). Useful when the
// row-filter default is too permissive for an environment.
// Ignored when `PII_ALLOW_INTROSPECTION=true` (which always wins).
export const PII_BLOCK_INTROSPECTION =
  process.env.PII_BLOCK_INTROSPECTION === "true";

// Schema-specific permissions
export const SCHEMA_INSERT_PERMISSIONS: SchemaPermissions =
  parseSchemaPermissions(process.env.SCHEMA_INSERT_PERMISSIONS);
export const SCHEMA_UPDATE_PERMISSIONS: SchemaPermissions =
  parseSchemaPermissions(process.env.SCHEMA_UPDATE_PERMISSIONS);
export const SCHEMA_DELETE_PERMISSIONS: SchemaPermissions =
  parseSchemaPermissions(process.env.SCHEMA_DELETE_PERMISSIONS);
export const SCHEMA_DDL_PERMISSIONS: SchemaPermissions = parseSchemaPermissions(
  process.env.SCHEMA_DDL_PERMISSIONS,
);

// Remote MCP configuration
export const IS_REMOTE_MCP = process.env.IS_REMOTE_MCP === "true";
export const REMOTE_SECRET_KEY = process.env.REMOTE_SECRET_KEY || "";
export const PORT = process.env.PORT || 3000;

// Check if we're in multi-DB mode (no specific DB set)
const dbFromEnvOrConnString = connectionStringConfig.database || process.env.MYSQL_DB;
export const isMultiDbMode =
  !dbFromEnvOrConnString || dbFromEnvOrConnString.trim() === "";

export const mcpConfig = {
  server: {
    name: "@benborla29/mcp-server-mysql",
    version: MCP_VERSION,
    connectionTypes: ["stdio", "streamableHttp"],
  },
  mysql: {
    // Use Unix socket if provided (connection string takes precedence), otherwise use host/port
    ...(connectionStringConfig.socketPath || process.env.MYSQL_SOCKET_PATH
      ? {
          socketPath: connectionStringConfig.socketPath || process.env.MYSQL_SOCKET_PATH,
        }
      : {
          host: connectionStringConfig.host || process.env.MYSQL_HOST || "127.0.0.1",
          port: connectionStringConfig.port || Number(process.env.MYSQL_PORT || "3306"),
        }),
    user: connectionStringConfig.user || process.env.MYSQL_USER || "root",
    password:
      connectionStringConfig.password !== undefined
        ? connectionStringConfig.password
        : process.env.MYSQL_PASS === undefined
          ? ""
          : process.env.MYSQL_PASS,
    database: connectionStringConfig.database || process.env.MYSQL_DB || undefined, // Allow undefined database for multi-DB mode
    connectionLimit: 10,
    waitForConnections: true,
    queueLimit: process.env.MYSQL_QUEUE_LIMIT ? parseInt(process.env.MYSQL_QUEUE_LIMIT, 10) : 100,
    enableKeepAlive: true,
    keepAliveInitialDelay: 0,
    connectTimeout: process.env.MYSQL_CONNECT_TIMEOUT ? parseInt(process.env.MYSQL_CONNECT_TIMEOUT, 10) : 10000,
    authPlugins: {
      mysql_clear_password: () => () =>
        Buffer.from(
          connectionStringConfig.password !== undefined
            ? connectionStringConfig.password
            : process.env.MYSQL_PASS !== undefined
              ? process.env.MYSQL_PASS
              : ""
        ),
    },
    ...(process.env.MYSQL_SSL === "true"
      ? {
          ssl: {
            rejectUnauthorized:
              process.env.MYSQL_SSL_REJECT_UNAUTHORIZED === "true",
            // Add CA certificate if provided
            ...(process.env.MYSQL_SSL_CA
              ? { ca: readCACertificate(process.env.MYSQL_SSL_CA) }
              : {}),
            // Add client certificate for mTLS if provided
            ...(process.env.MYSQL_SSL_CERT
              ? { cert: readSSLFile(process.env.MYSQL_SSL_CERT, 'client certificate') }
              : {}),
            // Add client private key for mTLS if provided
            ...(process.env.MYSQL_SSL_KEY
              ? { key: readSSLFile(process.env.MYSQL_SSL_KEY, 'client private key') }
              : {}),
          },
        }
      : {}),
    // Timezone configuration for date/time handling
    ...(process.env.MYSQL_TIMEZONE
      ? {
          timezone: process.env.MYSQL_TIMEZONE,
        }
      : {}),
    // Return date values as strings instead of JavaScript Date objects
    ...(process.env.MYSQL_DATE_STRINGS === "true"
      ? {
          dateStrings: true,
        }
      : {}),
    // Return BIGINT/DECIMAL values as strings to prevent precision loss
    // This is essential for tables using snowflake IDs (19-digit IDs) which exceed Number.MAX_SAFE_INTEGER (2^53-1)
    ...(process.env.MYSQL_BIG_NUMBER_STRINGS === "true"
      ? {
          supportBigNumbers: true,
          bigNumberStrings: true,
        }
      : {}),
  },
  paths: {
    schema: "schema",
  },
};

export { readCACertificate, readSSLFile };
