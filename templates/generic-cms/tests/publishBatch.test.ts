import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { publishBatch, readPending } from '../src/lib/publish.js';
import { ownerIdentity } from './support/fixtures';

type Mode = 'ok' | 'decline' | 'partial' | 'timeout' | 'unsupported' | 'unsupported-then-decline';

function install(mode: Mode) {
  const calls: any[] = [];
  const stored = new Map<string, string>();
  (window as any).qortalRequest = vi.fn(async (payload: any) => {
    calls.push(payload);
    switch (payload.action) {
      case 'GET_USER_ACCOUNT': return { address: ownerIdentity.address };
      case 'GET_ACCOUNT_NAMES': return [{ name: 'QortalDemo' }];
      case 'GET_PRIMARY_NAME': return 'QortalDemo';
      case 'GET_QDN_RESOURCE_STATUS': return { status: 'NOT_FOUND' };
      case 'PUBLISH_MULTIPLE_QDN_RESOURCES': {
        if (mode === 'decline') throw new Error('User declined request');
        if (mode === 'timeout') throw new Error('The Qortal request timed out.');
        if (mode === 'unsupported' || mode === 'unsupported-then-decline') throw new Error('Unknown action: PUBLISH_MULTIPLE_QDN_RESOURCES');
        const failed = mode === 'partial' ? ['res-b'] : [];
        for (const item of payload.resources) if (!failed.includes(item.identifier)) stored.set(item.identifier, item.data64);
        if (failed.length) { const error: any = new Error('Some resources failed'); error.unsuccessfulPublishes = failed.map((identifier) => ({ identifier })); throw error; }
        return { ok: true };
      }
      case 'PUBLISH_QDN_RESOURCE':
        if (mode === 'unsupported-then-decline') throw new Error('User declined request');
        stored.set(payload.identifier, payload.data64);
        return { signature: 's' };
      case 'FETCH_QDN_RESOURCE': return stored.get(payload.identifier) ?? null;
      default: return null;
    }
  });
  return calls;
}

const resources = () => [
  { stage: 'content', identifier: 'res-a', document: { a: 1 } },
  { stage: 'index', identifier: 'res-b', document: { b: 2 } },
  { stage: 'search', identifier: 'res-c', document: { c: 3 } }
];
const run = () => publishBatch({ identity: ownerIdentity, name: 'QortalDemo', resources: resources(), storage: localStorage, verifyTimeoutMs: 800 });
const count = (calls: any[], action: string) => calls.filter((entry) => entry.action === action).length;

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('fetch', vi.fn(async (url: string) => String(url).includes('/names/')
    ? { ok: true, status: 200, json: async () => ({ name: 'QortalDemo', owner: ownerIdentity.address }) }
    : { ok: false, status: 404, json: async () => ({}) }));
});
afterEach(() => { delete (window as any).qortalRequest; vi.unstubAllGlobals(); localStorage.clear(); });

describe('publishBatch (one Hub approval)', () => {
  it('sends one batch request and verifies every resource', async () => {
    const calls = install('ok');
    const result = await run();
    expect(result.ok).toBe(true);
    expect(count(calls, 'PUBLISH_MULTIPLE_QDN_RESOURCES')).toBe(1);
    expect(count(calls, 'PUBLISH_QDN_RESOURCE')).toBe(0);
    expect(result.results.map((entry: any) => entry.state)).toEqual(['remote-verified', 'remote-verified', 'remote-verified']);
    expect(readPending(localStorage)).toHaveLength(0);
  });

  it('records a decline, clears pending entries and never falls back', async () => {
    const calls = install('decline');
    const result = await run();
    expect(result.ok).toBe(false);
    expect(result.state).toBe('declined');
    expect(count(calls, 'PUBLISH_QDN_RESOURCE')).toBe(0);
    expect(readPending(localStorage)).toHaveLength(0);
  });

  it('maps unsuccessfulPublishes to per-resource states (partial)', async () => {
    const calls = install('partial');
    const result = await run();
    expect(result.ok).toBe(false);
    expect(result.state).toBe('partial');
    expect(result.results.map((entry: any) => entry.state)).toEqual(['remote-verified', 'failed', 'remote-verified']);
    expect(count(calls, 'PUBLISH_MULTIPLE_QDN_RESOURCES')).toBe(1);
    expect(count(calls, 'PUBLISH_QDN_RESOURCE')).toBe(0);
  });

  it('treats a timeout as ambiguous, keeps pending entries and does not resend or fall back', async () => {
    const calls = install('timeout');
    const result = await run();
    expect(result.state).toBe('ambiguous');
    expect(count(calls, 'PUBLISH_MULTIPLE_QDN_RESOURCES')).toBe(1);
    expect(count(calls, 'PUBLISH_QDN_RESOURCE')).toBe(0);
    expect(readPending(localStorage)).toHaveLength(3);
    const again = await run();
    expect(again.state).toBe('ambiguous');
    expect(count(calls, 'PUBLISH_MULTIPLE_QDN_RESOURCES')).toBe(1);
  });

  it('falls back to sequential single publishing only when the action is unsupported', async () => {
    const calls = install('unsupported');
    const result = await run();
    expect(result.ok).toBe(true);
    expect((result as any).fallbackUsed).toBe(true);
    expect(count(calls, 'PUBLISH_MULTIPLE_QDN_RESOURCES')).toBe(1);
    expect(count(calls, 'PUBLISH_QDN_RESOURCE')).toBe(3);
  });

  it('stops the fallback after a decline and publishes nothing further', async () => {
    const calls = install('unsupported-then-decline');
    const result = await run();
    expect(result.ok).toBe(false);
    expect(count(calls, 'PUBLISH_QDN_RESOURCE')).toBe(1);
    expect(readPending(localStorage)).toHaveLength(0);
  });

  it('rejects a concurrent second run of the same batch (no double publish)', async () => {
    const calls = install('ok');
    const [first, second] = await Promise.all([run(), run()]);
    expect([first.state, second.state].sort()).toEqual(['in-flight', 'remote-verified']);
    expect(count(calls, 'PUBLISH_MULTIPLE_QDN_RESOURCES')).toBe(1);
  });
});
