import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  executeQuery,
  executeReadOnlyQuery,
  executeWriteQuery,
} from "../../dist/src/db/index.js";

// Mock environment variables for write operation flags
vi.stubEnv("ALLOW_INSERT_OPERATION", "false");
vi.stubEnv("ALLOW_UPDATE_OPERATION", "false");
vi.stubEnv("ALLOW_DELETE_OPERATION", "false");

// Mock mysql2/promise
vi.mock("mysql2/promise", () => {
  const mockConnection = {
    query: vi.fn(),
    beginTransaction: vi.fn(),
    commit: vi.fn(),
    rollback: vi.fn(),
    release: vi.fn(),
  };

  const mockPool = {
    getConnection: vi.fn().mockResolvedValue(mockConnection),
  };

  return {
    createPool: vi.fn().mockReturnValue(mockPool),
    ResultSetHeader: class ResultSetHeader {
      constructor(data = {}) {
        Object.assign(this, data);
      }
    },
  };
});

describe("Query Functions", () => {
  let mockPool;
  let mockConnection;

  beforeEach(async () => {
    // Clear all mocks
    vi.clearAllMocks();

    // Get the mock pool and connection
    mockPool = (await import("mysql2/promise")).createPool({
      host: "localhost",
      user: "test",
      database: "test",
    });
    mockConnection = await mockPool.getConnection();
  });

  describe("executeQuery", () => {
    // The timeout probe (first acquire of a connection) and the SET run before
    // each query: answer them, and hand every other statement to `run`.
    const routeQueries = (run: (sql: string) => unknown) =>
      mockConnection.query.mockImplementation(async (sql: string) =>
        /max_execution_time/.test(sql) ? [[{ v: 0 }], null] : run(sql),
      );

    afterEach(() => {
      mockConnection.query.mockReset();
    });

    it("should execute a query and return results", async () => {
      const mockResults = [{ id: 1, name: "Test" }];
      routeQueries(() => [mockResults, null]);

      const result = await executeQuery("SELECT * FROM test", []);

      expect(mockConnection.query).toHaveBeenCalledWith(
        "SET SESSION max_execution_time = ?",
        [30000],
      );
      expect(mockConnection.query).toHaveBeenCalledWith(
        "SELECT * FROM test",
        [],
      );
      expect(mockConnection.release).toHaveBeenCalled();
      expect(result).toEqual(mockResults);
    });

    it("should handle query parameters correctly", async () => {
      const params = ["test", 123];
      routeQueries(() => [[{ id: 1 }], null]);

      await executeQuery(
        "SELECT * FROM test WHERE name = ? AND id = ?",
        params,
      );

      expect(mockConnection.query).toHaveBeenCalledWith(
        "SELECT * FROM test WHERE name = ? AND id = ?",
        params,
      );
    });

    it("should release connection even if query fails", async () => {
      routeQueries(() => {
        throw new Error("Query failed");
      });

      await expect(executeQuery("SELECT * FROM test", [])).rejects.toThrow(
        "Query failed",
      );
      expect(mockConnection.release).toHaveBeenCalled();
    });
  });

  describe("executeReadOnlyQuery", () => {
    it("should execute a read-only query in a transaction and return results", async () => {
      const mockResults = [{ id: 1, name: "Test" }];
      mockConnection.query.mockResolvedValue([mockResults, null]);

      const result = await executeReadOnlyQuery("SELECT * FROM test");

      expect(mockConnection.query).toHaveBeenCalledWith(
        "SET SESSION TRANSACTION READ ONLY",
      );
      expect(mockConnection.beginTransaction).toHaveBeenCalled();
      expect(mockConnection.query).toHaveBeenCalledWith("SELECT * FROM test");
      expect(mockConnection.rollback).toHaveBeenCalled();
      expect(mockConnection.query).toHaveBeenCalledWith(
        "SET SESSION TRANSACTION READ WRITE",
      );
      expect(mockConnection.release).toHaveBeenCalled();

      expect(result).toEqual({
        content: [
          {
            type: "text",
            text: JSON.stringify(mockResults, null, 2),
          },
        ],
        isError: false,
      });
    });

    it("should block INSERT operations when not allowed", async () => {
      const result = await executeReadOnlyQuery(
        'INSERT INTO test (name) VALUES ("test")',
      );

      expect(mockConnection.beginTransaction).not.toHaveBeenCalled();
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain(
        "INSERT operations are not allowed",
      );
    });

    it("should block UPDATE operations when not allowed", async () => {
      const result = await executeReadOnlyQuery(
        'UPDATE test SET name = "updated" WHERE id = 1',
      );

      expect(mockConnection.beginTransaction).not.toHaveBeenCalled();
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain(
        "UPDATE operations are not allowed",
      );
    });

    it("should block DELETE operations when not allowed", async () => {
      const result = await executeReadOnlyQuery(
        "DELETE FROM test WHERE id = 1",
      );

      expect(mockConnection.beginTransaction).not.toHaveBeenCalled();
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain(
        "DELETE operations are not allowed",
      );
    });
  });

  describe("executeWriteQuery", () => {
    it("should execute an INSERT query and format the result correctly", async () => {
      // Mock ResultSetHeader for an insert operation
      const resultHeader = { affectedRows: 1, insertId: 123 };
      mockConnection.query.mockResolvedValueOnce([resultHeader, null]);

      const result = await executeWriteQuery(
        'INSERT INTO test (name) VALUES ("test")',
      );

      expect(mockConnection.beginTransaction).toHaveBeenCalled();
      expect(mockConnection.query).toHaveBeenCalledWith(
        'INSERT INTO test (name) VALUES ("test")',
      );
      expect(mockConnection.commit).toHaveBeenCalled();
      expect(mockConnection.release).toHaveBeenCalled();

      expect(result.isError).toBe(false);
      expect(result.content[0].text).toContain("Insert successful");
      expect(result.content[0].text).toContain("Affected rows: 1");
      expect(result.content[0].text).toContain("Last insert ID: 123");
    });

    it("should execute an UPDATE query and format the result correctly", async () => {
      // Mock ResultSetHeader for an update operation
      const resultHeader = { affectedRows: 2, changedRows: 1 };
      mockConnection.query.mockResolvedValueOnce([resultHeader, null]);

      const result = await executeWriteQuery(
        'UPDATE test SET name = "updated" WHERE id > 0',
      );

      expect(mockConnection.beginTransaction).toHaveBeenCalled();
      expect(mockConnection.query).toHaveBeenCalledWith(
        'UPDATE test SET name = "updated" WHERE id > 0',
      );
      expect(mockConnection.commit).toHaveBeenCalled();

      expect(result.isError).toBe(false);
      expect(result.content[0].text).toContain("Update successful");
      expect(result.content[0].text).toContain("Affected rows: 2");
      expect(result.content[0].text).toContain("Changed rows: 1");
    });

    it("should execute a DELETE query and format the result correctly", async () => {
      // Mock ResultSetHeader for a delete operation
      const resultHeader = { affectedRows: 3 };
      mockConnection.query.mockResolvedValueOnce([resultHeader, null]);

      const result = await executeWriteQuery("DELETE FROM test WHERE id > 0");

      expect(mockConnection.beginTransaction).toHaveBeenCalled();
      expect(mockConnection.query).toHaveBeenCalledWith(
        "DELETE FROM test WHERE id > 0",
      );
      expect(mockConnection.commit).toHaveBeenCalled();

      expect(result.isError).toBe(false);
      expect(result.content[0].text).toContain("Delete successful");
      expect(result.content[0].text).toContain("Affected rows: 3");
    });

    it("should rollback transaction and return error if query fails", async () => {
      mockConnection.query.mockImplementation((sql) => {
        if (sql === 'INSERT INTO test (name) VALUES ("test")') {
          throw new Error("Insert failed");
        }
        return [[], null];
      });

      const result = await executeWriteQuery(
        'INSERT INTO test (name) VALUES ("test")',
      );

      expect(mockConnection.beginTransaction).toHaveBeenCalled();
      expect(mockConnection.rollback).toHaveBeenCalled();
      expect(mockConnection.commit).not.toHaveBeenCalled();

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain(
        "Error executing write operation",
      );
    });
  });
});

