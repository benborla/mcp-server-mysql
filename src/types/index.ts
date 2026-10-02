export interface SchemaPermissions {
  [schema: string]: boolean;
}

export interface TableRow {
  table_name: string;
  name: string;
  database: string;
  description?: string;
  rowCount?: number;
  dataSize?: number;
  indexSize?: number;
  createTime?: string;
  updateTime?: string;
}

export interface ColumnRow {
  column_name: string;
  data_type: string;
}

export interface NamedConnection {
  name: string;
  host: string;
  port: number;
  user: string;
  password: string;
  database?: string;
  socketPath?: string;
  connectionLimit?: number;
  connectTimeout?: number;
  // Per-connection write permission overrides. When undefined, the global
  // ALLOW_*_OPERATION flag is used as the fallback.
  allowInsert?: boolean;
  allowUpdate?: boolean;
  allowDelete?: boolean;
  allowDDL?: boolean;
}

export type NamedConnections = Map<string, NamedConnection>;
