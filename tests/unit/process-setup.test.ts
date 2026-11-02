import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runProcessSetup, resetProcessSetup } from '../../src/setup/index.js';

describe('runProcessSetup', () => {
  beforeEach(() => resetProcessSetup());

  it('runs the connection test and handler registration at most once', async () => {
    const testConnection = vi.fn().mockResolvedValue(undefined);
    const registerHandlers = vi.fn();
    const deps = { testConnection, registerHandlers, exit: vi.fn() };

    await runProcessSetup(deps);
    await runProcessSetup(deps);
    await Promise.all([runProcessSetup(deps), runProcessSetup(deps)]);

    expect(testConnection).toHaveBeenCalledTimes(1);
    expect(registerHandlers).toHaveBeenCalledTimes(1);
  });

  it('exits with code 1 when the connection test fails', async () => {
    const exit = vi.fn();
    await runProcessSetup({
      testConnection: vi.fn().mockRejectedValue(new Error('unreachable')),
      registerHandlers: vi.fn(),
      exit,
    });
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('resolves only after the connection test settles', async () => {
    let finish!: () => void;
    const testConnection = vi.fn(() => new Promise<void>((r) => (finish = r)));
    let done = false;
    const p = runProcessSetup({ testConnection, registerHandlers: vi.fn(), exit: vi.fn() })
      .then(() => (done = true));
    await new Promise((r) => setTimeout(r, 20));
    expect(done).toBe(false);
    finish();
    await p;
    expect(done).toBe(true);
  });
});
