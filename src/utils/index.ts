import { SchemaPermissions } from "../types/index.js";
type LogType = "info" | "error";

// @INFO: Enable logging if ENABLE_LOGGING is true
const ENABLE_LOGGING =
  process.env.ENABLE_LOGGING === "true" || process.env.ENABLE_LOGGING === "1";

export function log(type: LogType = "info", ...args: any[]): void {
  if (!ENABLE_LOGGING) return;

  switch (type) {
    case "info":
      console.error(...args);
      break;
    case "error":
      console.error(...args);
      break;
    default:
      console.error(...args);
  }
}

// Function to parse schema-specific permissions from environment variables
export function parseSchemaPermissions(
  permissionsString?: string,
): SchemaPermissions {
  const permissions: SchemaPermissions = {};

  if (!permissionsString) {
    return permissions;
  }

  // Format: "schema1:true,schema2:false"
  const permissionPairs = permissionsString.split(",");

  for (const pair of permissionPairs) {
    const [schema, value] = pair.split(":");
    if (schema && value) {
      permissions[schema.trim()] = value.trim() === "true";
    }
  }

  return permissions;
}

// MySQL connection configuration type
export interface MySQLConnectionConfig {
  host?: string;
  port?: number;
  user?: string;
  password?: string;
  database?: string;
  socketPath?: string;
}

// Function to parse MySQL connection string (mysql CLI format)
// Example: mysql --default-auth=mysql_native_password -A -hrdsproxy.staging.luno.com -P3306 -uUSER -pPASS database_name
export function parseMySQLConnectionString(
  connectionString: string,
): MySQLConnectionConfig {
  const config: MySQLConnectionConfig = {};

  // Remove 'mysql' command at the start if present
  let cleanedString = connectionString.trim().replace(/^mysql\s+/, '');

  // Parse flags and options
  const tokens = [];
  let currentToken = '';
  let inQuotes = false;
  let quoteChar: string | null = null;

  for (let i = 0; i < cleanedString.length; i++) {
    const char = cleanedString[i];

    if ((char === '"' || char === "'") && (!inQuotes || char === quoteChar)) {
      // Toggle quote state without adding the quote character
      inQuotes = !inQuotes;
      quoteChar = inQuotes ? char : null;
    } else if (char === ' ' && !inQuotes) {
      if (currentToken) {
        tokens.push(currentToken);
        currentToken = '';
      }
    } else {
      currentToken += char;
    }
  }

  if (currentToken) {
    tokens.push(currentToken);
  }

  // Process tokens
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];

    // Check for combined short options (e.g., -uUSER, -pPASS, -hHOST, -PPORT)
    if (token.startsWith('-') && !token.startsWith('--')) {
      const flag = token[1];
      let value = token.substring(2);

      // If no value attached, check next token
      if (!value && i + 1 < tokens.length && !tokens[i + 1].startsWith('-')) {
        value = tokens[i + 1];
        i++;
      }

      switch (flag) {
        case 'h':
          config.host = value;
          break;
        case 'P': {
          const port = parseInt(value, 10);
          if (Number.isNaN(port) || !Number.isFinite(port) || port < 1 || port > 65535) {
            throw new Error(`Invalid port: ${value}`);
          }
          config.port = port;
          break;
        }
        case 'u':
          config.user = value;
          break;
        case 'p':
          config.password = value;
          break;
        case 'S':
          config.socketPath = value;
          break;
      }
    }
    // Check for long options (e.g., --host=HOST, --port=PORT)
    else if (token.startsWith('--')) {
      const [flag, ...valueParts] = token.substring(2).split('=');
      let value = valueParts.join('=');

      // If no value with =, check next token
      if (!value && i + 1 < tokens.length && !tokens[i + 1].startsWith('-')) {
        value = tokens[i + 1];
        i++;
      }

      switch (flag) {
        case 'host':
          config.host = value;
          break;
        case 'port': {
          const port = parseInt(value, 10);
          if (Number.isNaN(port) || !Number.isFinite(port) || port < 1 || port > 65535) {
            throw new Error(`Invalid port: ${value}`);
          }
          config.port = port;
          break;
        }
        case 'user':
          config.user = value;
          break;
        case 'password':
          config.password = value;
          break;
        case 'socket':
          config.socketPath = value;
          break;
      }
    }
    // Last positional argument (not starting with -) is the database name
    else if (!token.startsWith('-')) {
      // Only consider it a database if it's one of the last arguments and not part of a flag
      config.database = token;
    }
  }

  return config;
}
