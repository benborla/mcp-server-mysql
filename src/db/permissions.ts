import {
  ALLOW_DELETE_OPERATION,
  ALLOW_DDL_OPERATION,
  ALLOW_INSERT_OPERATION,
  ALLOW_UPDATE_OPERATION,
  SCHEMA_DELETE_PERMISSIONS,
  SCHEMA_DDL_PERMISSIONS,
  SCHEMA_INSERT_PERMISSIONS,
  SCHEMA_UPDATE_PERMISSIONS,
  resolveInsertPermission,
  resolveUpdatePermission,
  resolveDeletePermission,
  resolveDDLPermission,
} from "../config/index.js";

// Schema permission checking functions
function isInsertAllowedForSchema(schema: string | null, connectionName: string = "default"): boolean {
  if (!schema) {
    return resolveInsertPermission(connectionName);
  }
  return schema in SCHEMA_INSERT_PERMISSIONS
    ? SCHEMA_INSERT_PERMISSIONS[schema]
    : resolveInsertPermission(connectionName);
}

function isUpdateAllowedForSchema(schema: string | null, connectionName: string = "default"): boolean {
  if (!schema) {
    return resolveUpdatePermission(connectionName);
  }
  return schema in SCHEMA_UPDATE_PERMISSIONS
    ? SCHEMA_UPDATE_PERMISSIONS[schema]
    : resolveUpdatePermission(connectionName);
}

function isDeleteAllowedForSchema(schema: string | null, connectionName: string = "default"): boolean {
  if (!schema) {
    return resolveDeletePermission(connectionName);
  }
  return schema in SCHEMA_DELETE_PERMISSIONS
    ? SCHEMA_DELETE_PERMISSIONS[schema]
    : resolveDeletePermission(connectionName);
}

function isDDLAllowedForSchema(schema: string | null, connectionName: string = "default"): boolean {
  if (!schema) {
    return resolveDDLPermission(connectionName);
  }
  return schema in SCHEMA_DDL_PERMISSIONS
    ? SCHEMA_DDL_PERMISSIONS[schema]
    : resolveDDLPermission(connectionName);
}

export {
  isInsertAllowedForSchema,
  isUpdateAllowedForSchema,
  isDeleteAllowedForSchema,
  isDDLAllowedForSchema,
};
