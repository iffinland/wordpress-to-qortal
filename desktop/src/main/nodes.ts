/**
 * Preferred Qortal/Qortium node configuration.
 *
 * The desktop app never needs a node to prepare a migration: WordPress
 * discovery, planning and media download are fully local. A node is only used
 * for optional read-only QDN verification. Users commonly reach their node
 * through an SSH tunnel on a non-default port (for example
 * http://127.0.0.1:24991), so the node URL is user-configurable and tested
 * explicitly instead of being hardcoded.
 *
 * Security: only http(s) origins without credentials, query or fragment are
 * accepted. This app never enables, exposes or modifies a node's private API;
 * connectivity is probed with the public read-only /blocks/last endpoint.
 */

export const DEFAULT_NODE_URL = 'http://127.0.0.1:12391';

export function normalizeNodeUrl(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw Object.assign(new Error('Enter a node URL such as http://127.0.0.1:24991.'), { code: 'NODE_URL_INVALID' });
  }
  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    throw Object.assign(new Error('Node URL must be a valid http:// or https:// URL.'), { code: 'NODE_URL_INVALID' });
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw Object.assign(new Error('Node URL must use http or https.'), { code: 'NODE_URL_INVALID' });
  }
  if (parsed.username || parsed.password) {
    throw Object.assign(new Error('Node URL must not contain credentials.'), { code: 'NODE_URL_INVALID' });
  }
  if (parsed.search || parsed.hash) {
    throw Object.assign(new Error('Node URL must not contain a query or fragment.'), { code: 'NODE_URL_INVALID' });
  }
  return (parsed.origin + parsed.pathname).replace(/\/+$/, '');
}

export interface NodeTestResult {
  ok: boolean;
  url: string;
  status: number | null;
  latencyMs: number;
  height: number | null;
  message: string;
  checkedAt: string;
}

/**
 * Probe a node with a public, read-only endpoint. /blocks/last is available on
 * a default Qortal/Qortium Core without admin credentials and reveals only the
 * chain height. Network errors are returned as data, never thrown, so the UI
 * can show a visible result.
 */
export async function testNodeConnectivity(
  value: unknown,
  { timeoutMs = 8000, fetchImpl = fetch }: { timeoutMs?: number; fetchImpl?: typeof fetch } = {}
): Promise<NodeTestResult> {
  const startedAt = Date.now();
  const checkedAt = new Date().toISOString();
  let url: string;
  try {
    url = normalizeNodeUrl(value);
  } catch (error) {
    return {
      ok: false,
      url: typeof value === 'string' ? value : '',
      status: null,
      latencyMs: 0,
      height: null,
      message: error instanceof Error ? error.message : 'Node URL is invalid.',
      checkedAt
    };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url + '/blocks/last', {
      method: 'GET',
      headers: { accept: 'application/json' },
      signal: controller.signal
    });
    const latencyMs = Date.now() - startedAt;
    let height: number | null = null;
    if (response.ok) {
      try {
        const body = (await response.json()) as { height?: unknown };
        if (Number.isInteger(Number(body?.height))) height = Number(body.height);
      } catch {
        // A non-JSON body still proves reachability at the HTTP layer.
      }
    }
    return {
      ok: response.ok,
      url,
      status: response.status,
      latencyMs,
      height,
      message: response.ok
        ? 'Node reachable' + (height === null ? '.' : ' at block ' + height + '.')
        : 'Node answered HTTP ' + response.status + '. Check that this is a Qortal/Qortium Core API port and that it allows read-only API access.',
      checkedAt
    };
  } catch (error) {
    const latencyMs = Date.now() - startedAt;
    const reason = error instanceof Error && error.name === 'AbortError'
      ? 'connection timed out'
      : error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      url,
      status: null,
      latencyMs,
      height: null,
      message: 'Could not reach the node (' + reason + '). The desktop app still works offline for WordPress preparation.',
      checkedAt
    };
  } finally {
    clearTimeout(timer);
  }
}
