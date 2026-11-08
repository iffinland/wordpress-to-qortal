import http from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_NODE_URL, normalizeNodeUrl, testNodeConnectivity } from '../../src/main/nodes.js';

const servers: http.Server[] = [];

function listen(handler: http.RequestListener): Promise<{ server: http.Server; url: string }> {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    servers.push(server);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      resolve({ server, url: 'http://127.0.0.1:' + port });
    });
  });
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

describe('Qortal node configuration', () => {
  it('accepts a custom SSH-forwarded port and normalises trailing slashes', () => {
    expect(normalizeNodeUrl('http://127.0.0.1:24991/')).toBe('http://127.0.0.1:24991');
    expect(normalizeNodeUrl('http://127.0.0.1:24992')).toBe('http://127.0.0.1:24992');
    expect(normalizeNodeUrl(DEFAULT_NODE_URL)).toBe(DEFAULT_NODE_URL);
  });

  it('rejects credentials, non-http schemes and query strings', () => {
    expect(() => normalizeNodeUrl('http://user:pass@127.0.0.1:12391')).toThrow(/credentials/);
    expect(() => normalizeNodeUrl('file:///etc/passwd')).toThrow(/http/);
    expect(() => normalizeNodeUrl('http://127.0.0.1:12391/?apikey=1')).toThrow(/query/);
  });

  it('reports a reachable node with its chain height from the public endpoint', async () => {
    const { url } = await listen((req, res) => {
      if (req.url === '/blocks/last') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ height: 987654, signature: 'abc' }));
        return;
      }
      res.writeHead(404); res.end();
    });
    const result = await testNodeConnectivity(url + '/');
    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
    expect(result.height).toBe(987654);
    expect(result.url).toBe(url);
  });

  it('returns an actionable failure instead of throwing when the node is offline', async () => {
    const result = await testNodeConnectivity('http://127.0.0.1:1', { timeoutMs: 1500 });
    expect(result.ok).toBe(false);
    expect(result.status).toBeNull();
    expect(result.message).toMatch(/offline|works offline|Could not reach/i);
  });

  it('shows HTTP failures clearly', async () => {
    const { url } = await listen((_req, res) => { res.writeHead(503); res.end('busy'); });
    const result = await testNodeConnectivity(url);
    expect(result.ok).toBe(false);
    expect(result.status).toBe(503);
    expect(result.message).toMatch(/HTTP 503/);
  });
});
