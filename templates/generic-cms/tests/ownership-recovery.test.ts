import { afterEach, describe, expect, it, vi } from 'vitest';
import { canMutate, evaluateOwnership } from '../src/lib/ownership.js';
import {
  connectOwnerAccount,
  resolveNodeBase,
  resolveViewerIdentity
} from '../src/lib/qortal.js';

const OWNER = 'QipPqwJeLtx89dXcSkY7vimMUNT8Gy5k2E';
const OTHER = 'QReaderAddress1111111111111111111';
const NAME = 'developer iffi';

function record(overrides: Record<string, unknown> = {}) {
  return { name: NAME, owner: OWNER, ...overrides };
}

function bridge(overrides: Record<string, unknown> = {}) {
  return async (payload: any) => {
    if (payload.action === 'GET_USER_ACCOUNT') return { address: OWNER };
    if (payload.action === 'GET_ACCOUNT_NAMES') return [{ name: NAME, owner: OWNER }];
    if (payload.action === 'GET_PRIMARY_NAME') return NAME;
    if (payload.action === 'GET_NAME_DATA') return record();
    if (overrides[payload.action]) return overrides[payload.action];
    throw new Error('unexpected action ' + payload.action);
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  delete (window as any).qortalRequest;
  delete (window as any)._qdnName;
  window.history.pushState({}, '', '/');
  localStorage.clear();
});

describe('trusted node resolution (Android Hub regression)', () => {
  it('uses the hosting node origin in a release build, never the build-time localhost default', () => {
    expect(resolveNodeBase({
      origin: 'http://100.116.185.83:12391',
      envUrl: 'http://localhost:12391',
      isDev: false
    })).toBe('http://100.116.185.83:12391');
  });

  it('keeps the explicit env override for local development only', () => {
    expect(resolveNodeBase({
      origin: 'http://localhost:5191',
      envUrl: 'http://localhost:12391',
      isDev: true
    })).toBe('http://localhost:12391');
  });

  it('falls back to the configured node when no hosted origin exists', () => {
    expect(resolveNodeBase({ origin: '', envUrl: 'http://node.example:12391', isDev: false })).toBe('http://node.example:12391');
    expect(resolveNodeBase({ origin: '', envUrl: '', isDev: false })).toBe('http://localhost:12391');
  });
});

describe('owner verification failure matrix stays fail-closed', () => {
  const base = { qdnName: NAME, account: { address: OWNER }, accountNames: [NAME], nameRecord: record(), bridgeAvailable: true };

  it('grants owner only when record, address and name list all agree exactly', () => {
    const identity = evaluateOwnership(base);
    expect(identity.owner).toBe(true);
    expect(identity.nameRecordStatus).toBe('verified');
    expect(canMutate(identity)).toBe(true);
  });

  it('offers connect when no active account is available', () => {
    const identity = evaluateOwnership({ ...base, account: null });
    expect(identity.reason).toBe('no-account');
    expect(identity.action).toBe('connect');
    expect(canMutate(identity)).toBe(false);
  });

  it('distinguishes an unreadable name list from a real non-owner', () => {
    const identity = evaluateOwnership({ ...base, accountNames: [] });
    expect(identity.reason).toBe('name-list-unavailable');
    expect(identity.action).toBe('retry');
    expect(identity.nameRecordStatus).toBe('verified');
    expect(canMutate(identity)).toBe(false);
  });

  it('denies a signed-in non-owner whose name list lacks the site name', () => {
    const identity = evaluateOwnership({ ...base, account: { address: OTHER }, accountNames: ['other'] });
    expect(identity.reason).toBe('owner-address-mismatch');
    expect(identity.action).toBe('none');
    expect(canMutate(identity)).toBe(false);
  });

  it('denies a signed-in owner account that is not registered to the site name', () => {
    const identity = evaluateOwnership({ ...base, accountNames: ['other name'] });
    expect(identity.reason).toBe('name-not-owned');
    expect(identity.action).toBe('none');
    expect(canMutate(identity)).toBe(false);
  });

  it('denies when the registry is unreachable and asks for a retry', () => {
    const identity = evaluateOwnership({ ...base, nameRecord: null });
    expect(identity.reason).toBe('name-record-unavailable');
    expect(identity.action).toBe('retry');
    expect(canMutate(identity)).toBe(false);
  });

  it('denies when the bridge is unavailable and points to Hub', () => {
    const identity = evaluateOwnership({ ...base, bridgeAvailable: false });
    expect(identity.reason).toBe('bridge-unavailable');
    expect(identity.action).toBe('open-in-hub');
    expect(canMutate(identity)).toBe(false);
  });

  it('never grants owner from name case differences or a transferred name', () => {
    expect(evaluateOwnership({ ...base, qdnName: NAME.toUpperCase() }).reason).toBe('name-record-mismatch');
    expect(evaluateOwnership({ ...base, nameRecord: record({ owner: OTHER }) }).reason).toBe('owner-address-mismatch');
  });
});

describe('live identity resolution and recovery', () => {
  it('reads the name record from the hosting node when reachable', async () => {
    (window as any)._qdnName = 'developer%20iffi';
    (window as any).qortalRequest = bridge();
    const urls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      urls.push(String(url));
      return { ok: true, json: async () => record() };
    }));
    const identity = await resolveViewerIdentity({ qdnName: 'developer iffi' }) as any;
    expect(identity.owner).toBe(true);
    expect(identity.nameRecordSource).toBe('node');
    expect(urls[0]).toContain('/names/');
    expect(urls[0]).not.toContain('%2520');
  });

  it('falls back to the bridge GET_NAME_DATA when the direct node read fails', async () => {
    const calls: any[] = [];
    (window as any).qortalRequest = async (payload: any) => {
      calls.push(payload);
      return bridge()(payload);
    };
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('local node unreachable'); }));
    const identity = await resolveViewerIdentity({ qdnName: NAME }) as any;
    expect(identity.owner).toBe(true);
    expect(identity.nameRecordSource).toBe('bridge');
    expect(calls.some((call) => call.action === 'GET_NAME_DATA' && call.name === NAME)).toBe(true);
  });

  it('stays read-only with a retry action when both the node and bridge record fail', async () => {
    (window as any).qortalRequest = async (payload: any) => {
      if (payload.action === 'GET_NAME_DATA') throw new Error('name lookup unavailable');
      return bridge()(payload);
    };
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down'); }));
    const identity = await resolveViewerIdentity({ qdnName: NAME }) as any;
    expect(identity.owner).toBe(false);
    expect(identity.reason).toBe('name-record-unavailable');
    expect(identity.action).toBe('retry');
    expect(identity.message).toContain('registry');
  });

  it('connectOwnerAccount requests the account, then re-verifies ownership', async () => {
    const calls: any[] = [];
    (window as any).qortalRequest = async (payload: any) => { calls.push(payload); return bridge()(payload); };
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => record() })));
    const identity = await connectOwnerAccount(NAME) as any;
    expect(calls[0].action).toBe('GET_USER_ACCOUNT');
    expect(identity.owner).toBe(true);
    expect(identity.address).toBe(OWNER);
  });

  it('connectOwnerAccount does not grant owner when the account request is declined', async () => {
    (window as any).qortalRequest = async (payload: any) => {
      if (payload.action === 'GET_USER_ACCOUNT') throw new Error('User declined request');
      return bridge()(payload);
    };
    const identity = await connectOwnerAccount(NAME) as any;
    expect(identity.owner).toBe(false);
    expect(identity.reason).toBe('no-account');
    expect(identity.action).toBe('connect');
    expect(canMutate(identity)).toBe(false);
  });

  it('reports bridge-unavailable when connect is attempted outside Hub', async () => {
    const identity = await connectOwnerAccount(NAME) as any;
    expect(identity.reason).toBe('bridge-unavailable');
    expect(identity.action).toBe('open-in-hub');
  });

  it('does not accept a record from the wrong name', async () => {
    (window as any).qortalRequest = bridge();
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => record({ name: 'other name' }) })));
    const identity = await resolveViewerIdentity({ qdnName: NAME }) as any;
    expect(identity.owner).toBe(false);
    expect(identity.reason).toBe('name-record-mismatch');
  });
});
