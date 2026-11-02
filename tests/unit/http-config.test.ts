import { describe, it, expect } from 'vitest';
import { resolveHttpOptions } from '../../src/http/index.js';

describe('resolveHttpOptions', () => {
  it('defaults the host to loopback when MCP_HOST is unset or empty', () => {
    expect(resolveHttpOptions({}).host).toBe('127.0.0.1');
    expect(resolveHttpOptions({ MCP_HOST: '' }).host).toBe('127.0.0.1');
  });

  it('uses MCP_HOST when provided', () => {
    expect(resolveHttpOptions({ MCP_HOST: '0.0.0.0' }).host).toBe('0.0.0.0');
  });

  it('reads port and secret from the environment', () => {
    expect(resolveHttpOptions({ PORT: '4000', REMOTE_SECRET_KEY: 's' })).toEqual({
      host: '127.0.0.1',
      port: '4000',
      secret: 's',
    });
    expect(resolveHttpOptions({}).port).toBe(3000);
  });
});
