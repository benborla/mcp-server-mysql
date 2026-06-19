# Testing

## Setup

**1. Create test database and user:**

```sql
CREATE DATABASE IF NOT EXISTS mcp_test;
CREATE USER IF NOT EXISTS 'mcp_test'@'localhost' IDENTIFIED BY 'mcp_test_password';
GRANT ALL PRIVILEGES ON mcp_test.* TO 'mcp_test'@'localhost';
FLUSH PRIVILEGES;
```

**2. Create `.env.test`:**

```env
MYSQL_HOST=127.0.0.1
MYSQL_PORT=3306
MYSQL_USER=mcp_test
MYSQL_PASS=mcp_test_password
MYSQL_DB=mcp_test
```

**3. Run setup script:**

```bash
pnpm run setup:test:db
```

## Running Tests

```bash
pnpm test                # all tests (runs setup:test:db first)
pnpm test:unit           # unit tests only
pnpm test:integration    # integration tests (requires MySQL)
pnpm test:e2e            # end-to-end tests
pnpm test:socket         # socket connection tests
pnpm test:watch          # watch mode
pnpm test:coverage       # coverage report
```

## Evals

```bash
OPENAI_API_KEY=your-key npx mcp-eval evals.ts index.ts
```

No rebuild needed — evals load `index.ts` directly via MCP client. See [MCP Evals docs](https://www.mcpevals.io/docs).
