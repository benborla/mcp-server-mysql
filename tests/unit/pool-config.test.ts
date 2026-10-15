import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Keep the repository's .env out of the configuration under test
vi.mock('dotenv', () => ({ config: () => ({}) }));

const NAME = 'MYSQL_POOL_IDLE_TIMEOUT';

async function loadMysqlConfig(idleTimeout: string | undefined) {
  if (idleTimeout === undefined) {
    delete process.env[NAME];
  } else {
    process.env[NAME] = idleTimeout;
  }
  vi.resetModules();
  const { mcpConfig } = await import('../../src/config/index.js');
  return mcpConfig.mysql;
}

describe('MYSQL_POOL_IDLE_TIMEOUT', () => {
  let envBefore: NodeJS.ProcessEnv;

  beforeEach(() => {
    envBefore = { ...process.env };
  });

  afterEach(() => {
    process.env = envBefore;
    vi.restoreAllMocks();
  });

  it('should keep the mysql2 defaults when unset', async () => {
    const config = await loadMysqlConfig(undefined);

    expect(config).not.toHaveProperty('maxIdle');
    expect(config).not.toHaveProperty('idleTimeout');
  });

  it.each([['60000', 60000], ['1', 1]])('should make the pool close connections idle longer than %s ms', async (value, expected) => {
    const config = await loadMysqlConfig(value);

    expect(config.idleTimeout).toBe(expected);
    // mysql2 runs its idle-eviction timer only when maxIdle is below connectionLimit
    expect(config.maxIdle).toBeLessThan(config.connectionLimit);
  });

  it.each(['0', '-1', '60s', '6e4', 'abc'])('should ignore invalid value %s', async (value) => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});

    const config = await loadMysqlConfig(value);

    expect(config).not.toHaveProperty('idleTimeout');
    expect(errors).toHaveBeenCalledWith(expect.stringContaining(NAME));
  });
});
