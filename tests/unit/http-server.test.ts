import { describe, it, expect, afterEach } from 'vitest';
import type { AddressInfo } from 'net';
import type { Server as HttpServer } from 'http';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { startHttpServer, DEFAULT_HOST } from '../../src/http/index.js';

const SECRET = 'test-secret';

let created = 0;
let live: HttpServer[] = [];

// Each call builds a fresh MCP server whose tool list echoes a per-instance id.
const serverFactory = () => {
  const id = ++created;
  const server = new Server(
    { name: 'test', version: '0.0.0' },
    { capabilities: { tools: {} } },
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    // Keep requests in flight long enough to overlap.
    await new Promise((r) => setTimeout(r, 100));
    return { tools: [{ name: `tool_${id}`, inputSchema: { type: 'object' as const } }] };
  });
  return server;
};

const start = async (host?: string) => {
  const httpServer = await startHttpServer({
    port: 0,
    host,
    secret: SECRET,
    createServer: serverFactory,
  });
  live.push(httpServer);
  return httpServer;
};

const post = (httpServer: HttpServer, id: number, token: string | null = SECRET) => {
  const { port } = httpServer.address() as AddressInfo;
  return fetch(`http://127.0.0.1:${port}/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/list', params: {} }),
  });
};

// The stateless transport answers with either plain JSON or a single SSE event.
const parseBody = async (res: Response) => {
  const text = await res.text();
  const data = text.split('\n').find((l) => l.startsWith('data: '));
  return JSON.parse(data ? data.slice(6) : text);
};

afterEach(async () => {
  await Promise.all(
    live.map((s) => {
      const closed = new Promise((r) => s.close(() => r(null)));
      // Drop idle keep-alive sockets so close() does not wait for them.
      s.closeAllConnections();
      return closed;
    }),
  );
  live = [];
});

describe('HTTP mode', () => {
  it('binds to loopback by default', async () => {
    const httpServer = await start();
    expect(DEFAULT_HOST).toBe('127.0.0.1');
    expect((httpServer.address() as AddressInfo).address).toBe('127.0.0.1');
  });

  it('binds to the host given explicitly', async () => {
    const httpServer = await start('::1');
    expect((httpServer.address() as AddressInfo).address).toBe('::1');
  });

  it('answers concurrent requests independently', async () => {
    const httpServer = await start();
    const results = await Promise.all([1, 2, 3, 4].map((id) => post(httpServer, id)));
    const bodies = await Promise.all(results.map(parseBody));

    expect(results.map((r) => r.status)).toEqual([200, 200, 200, 200]);
    expect(bodies.map((b) => b.id)).toEqual([1, 2, 3, 4]);
    for (const b of bodies) {
      expect(b.error).toBeUndefined();
      expect(b.result.tools).toHaveLength(1);
    }
    // One server instance per request.
    const names = bodies.map((b) => b.result.tools[0].name);
    expect(new Set(names).size).toBe(4);
  });

  it('keeps a pending request alive when another one is aborted', async () => {
    const httpServer = await start();
    const { port } = httpServer.address() as AddressInfo;
    const ac = new AbortController();
    const aborted = fetch(`http://127.0.0.1:${port}/mcp`, {
      method: 'POST',
      signal: ac.signal,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        Authorization: `Bearer ${SECRET}`,
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    }).catch((e) => e);
    const pending = post(httpServer, 2);
    await new Promise((r) => setTimeout(r, 30));
    ac.abort();

    expect((await aborted).name).toBe('AbortError');
    const res = await pending;
    const body = await parseBody(res);
    expect(res.status).toBe(200);
    expect(body.id).toBe(2);
    expect(body.result.tools).toHaveLength(1);
  });

  it('rejects requests without a valid bearer token with 401', async () => {
    const httpServer = await start();
    expect((await post(httpServer, 1, null)).status).toBe(401);
    expect((await post(httpServer, 2, 'wrong')).status).toBe(401);
  });
});
