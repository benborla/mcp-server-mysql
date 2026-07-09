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
}

export type NamedConnections = Map<string, NamedConnection>;
