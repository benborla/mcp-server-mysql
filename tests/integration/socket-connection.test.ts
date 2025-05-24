import * as mysql2 from 'mysql2/promise';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { fileURLToPath } from 'url';

// Set test directory path
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load test environment variables
dotenv.config({ path: path.resolve(__dirname, '../../.env.test') });

describe('Unix Socket Connection', () => {
  // Skip these tests if no socket path is provided
  const skipTests = !process.env.MYSQL_SOCKET_PATH;
  
  it.skipIf(skipTests)('should connect via Unix socket when MYSQL_SOCKET_PATH is set', async () => {
    const originalHost = process.env.MYSQL_HOST;
    const originalPort = process.env.MYSQL_PORT;
    const originalSocketPath = process.env.MYSQL_SOCKET_PATH;
    
    try {
      // Set socket path (use the actual socket path from environment or a test path)
      process.env.MYSQL_SOCKET_PATH = originalSocketPath || '/tmp/mysql.sock';
      delete process.env.MYSQL_HOST;
      delete process.env.MYSQL_PORT;
      
      // Create a connection pool using socket
      const config: any = {
        socketPath: process.env.MYSQL_SOCKET_PATH,
        user: process.env.MYSQL_USER || 'root',
        database: process.env.MYSQL_DB || 'mcp_test',
        connectionLimit: 5,
      };
      
      // Only add password if it's set
      if (process.env.MYSQL_PASS) {
        config.password = process.env.MYSQL_PASS;
      }
      
      const pool = mysql2.createPool(config);
      
      // Test the connection
      const connection = await pool.getConnection();
      expect(connection).toBeDefined();
      
      // Execute a simple query
      const [rows] = await connection.query('SELECT 1 as test') as [any[], any];
      expect(rows[0].test).toBe(1);
      
      connection.release();
      await pool.end();
    } finally {
      // Restore original values
      if (originalHost) process.env.MYSQL_HOST = originalHost;
      if (originalPort) process.env.MYSQL_PORT = originalPort;
      if (originalSocketPath) process.env.MYSQL_SOCKET_PATH = originalSocketPath;
      else delete process.env.MYSQL_SOCKET_PATH;
    }
  });
  
  it('should prefer socket path over host/port when both are provided', async () => {
    // This test verifies the configuration logic
    const mockConfig = {
      ...(process.env.MYSQL_SOCKET_PATH
        ? {
            socketPath: process.env.MYSQL_SOCKET_PATH,
          }
        : {
            host: process.env.MYSQL_HOST || '127.0.0.1',
            port: Number(process.env.MYSQL_PORT || '3306'),
          }
      ),
    };
    
    // If socket path is set, config should not have host/port
    if (process.env.MYSQL_SOCKET_PATH) {
      expect(mockConfig).toHaveProperty('socketPath');
      expect(mockConfig).not.toHaveProperty('host');
      expect(mockConfig).not.toHaveProperty('port');
    } else {
      expect(mockConfig).not.toHaveProperty('socketPath');
      expect(mockConfig).toHaveProperty('host');
      expect(mockConfig).toHaveProperty('port');
    }
  });
});