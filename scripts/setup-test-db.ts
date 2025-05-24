import * as mysql2 from 'mysql2/promise';
import * as dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load test environment variables
dotenv.config({ path: resolve(__dirname, '../.env.test') });

// Logging configuration
const ENABLE_LOGGING = process.env.ENABLE_LOGGING === '1'

type LogType = 'info' | 'error'

function log(type: LogType = 'info', ...args: any[]): void {
  if (!ENABLE_LOGGING) return

  switch (type) {
    case 'info':
      console.info(...args)
      break
    case 'error':
      console.error(...args)
      break
    default:
      console.log(...args)
  }
}

async function setupTestDatabase() {
  // Create connection config, omitting password if empty
  const config: any = {
    // Use Unix socket if provided, otherwise use host/port
    ...(process.env.MYSQL_SOCKET_PATH
      ? {
          socketPath: process.env.MYSQL_SOCKET_PATH,
        }
      : {
          host: process.env.MYSQL_HOST || '127.0.0.1',
          port: Number(process.env.MYSQL_PORT) || 3306,
        }
    ),
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASS || 'root', // Default to 'root' if not specified
    multipleStatements: true
  };

  // First connect without database to create it if needed
  const connection = await mysql2.createConnection(config);

  // Use a unique database name for tests to avoid conflicts with existing tables
  const dbName = process.env.MYSQL_DB || 'mcp_test_db';

  try {
    // Create database if it doesn't exist
    await connection.query(`CREATE DATABASE IF NOT EXISTS ${dbName}`);
    
    // Switch to the test database
    await connection.query(`USE ${dbName}`);

    // Temporarily disable foreign key checks to allow dropping tables
    await connection.query('SET FOREIGN_KEY_CHECKS = 0');

    // Create test tables
    await connection.query(`
      DROP TABLE IF EXISTS posts;
      DROP TABLE IF EXISTS users;
      DROP TABLE IF EXISTS test_table;

      CREATE TABLE users (
        id INT PRIMARY KEY AUTO_INCREMENT,
        name VARCHAR(255) NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE posts (
        id INT PRIMARY KEY AUTO_INCREMENT,
        user_id INT NOT NULL,
        title VARCHAR(255) NOT NULL,
        content TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id)
      );

      CREATE TABLE test_table (
        id INT PRIMARY KEY AUTO_INCREMENT,
        name VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      -- Insert test users
      INSERT INTO users (name, email) VALUES
        ('Test User 1', 'test1@example.com'),
        ('Test User 2', 'test2@example.com'),
        ('Test User 3', 'test3@example.com');

      -- Insert test posts
      INSERT INTO posts (user_id, title, content) VALUES
        (1, 'First Post', 'Content of first post'),
        (1, 'Second Post', 'Content of second post'),
        (2, 'Another Post', 'Content of another post');

      -- Insert test data
      INSERT INTO test_table (name) VALUES
        ('Test 1'),
        ('Test 2'),
        ('Test 3');
    `);

    // Re-enable foreign key checks
    await connection.query('SET FOREIGN_KEY_CHECKS = 1');

    log('info', 'Test database setup completed successfully');
  } catch (error) {
    log('error', 'Error setting up test database:', error);
    if (process.env.CI) {
      log('error', 'Database setup failed, but continuing with tests:', error.message);
    } else {
      throw error;
    }
  } finally {
    await connection.end();
  }
}

// Run the setup but don't exit on error
setupTestDatabase().catch(error => {
  console.error('Database setup failed, but continuing with tests:', error.message);
}); 