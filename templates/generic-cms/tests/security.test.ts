import { afterEach, describe, expect, it, vi } from 'vitest';
import { canMutate, evaluateOwnership, evaluateRevalidation } from '../src/lib/ownership.js';
import { discoverQdnName, fetchNameRecord, openQortalLink, resolveViewerIdentity, revalidateViewerIdentity } from '../src/lib/qortal.js';

const OWNER = 'QipPqwJeLtx89dXcSkY7vimMUNT8Gy5k2E';
const OTHER = 'QReaderAddress1111111111111111111';
const NAME = 'developer iffi';

function record(overrides = {}) {
  return { name: NAME, owner: OWNER, ...overrides };
}

function account(address: string) {
  return address ? { address } : null;
}

function ownerIdentity(overrides = {}) {
  return {
    role: 'owner', owner: true, address: OWNER, name: NAME, names: [NAME],
    qdnName: NAME, bridgeAvailable: true, nameRecordStatus: 'verified',
    reason: 'name-record-verified', message: 'owner', ...overrides
  };
}

describe('authorization matrix', () => {
  it('grants owner mode only to the active account that the name record names as owner', () => {
    const identity = evaluateOwnership({ qdnName: NAME, account: account(OWNER), accountNames: [NAME], nameRecord: record(), bridgeAvailable: true });
    expect(identity.owner).toBe(true);
    expect(identity.role).toBe('owner');
    expect(identity.nameRecordStatus).toBe('verified');
    expect(canMutate(identity)).toBe(true);
  });

  it('denies a different registered name even when the account owns that other name', () => {
    const identity = evaluateOwnership({ qdnName: 'attacker name', account: account(OWNER), accountNames: ['attacker name'], nameRecord: record({ name: NAME }), bridgeAvailable: true });
    expect(identity.owner).toBe(false);
    expect(identity.reason).toBe('name-record-mismatch');
  });

  it('denies a different account that is signed in', () => {
    const identity = evaluateOwnership({ qdnName: NAME, account: account(OTHER), accountNames: ['other'], nameRecord: record(), bridgeAvailable: true });
    expect(identity.owner).toBe(false);
    expect(identity.reason).toBe('owner-address-mismatch');
  });

  it('denies when there is no authenticated account', () => {
    const identity = evaluateOwnership({ qdnName: NAME, account: null, accountNames: [], nameRecord: record(), bridgeAvailable: true });
    expect(identity.owner).toBe(false);
    expect(identity.reason).toBe('no-account');
  });

  it('denies when the Qortal bridge is unavailable', () => {
    const identity = evaluateOwnership({ qdnName: NAME, account: account(OWNER), accountNames: [NAME], nameRecord: record(), bridgeAvailable: false });
    expect(identity.owner).toBe(false);
    expect(identity.reason).toBe('bridge-unavailable');
  });

  it('fails closed when the ownership service is unavailable', () => {
    const identity = evaluateOwnership({ qdnName: NAME, account: account(OWNER), accountNames: [NAME], nameRecord: null, bridgeAvailable: true });
    expect(identity.owner).toBe(false);
    expect(identity.nameRecordStatus).toBe('unavailable');
    expect(canMutate(identity)).toBe(false);
  });

  it('denies after a name transfer', () => {
    const identity = evaluateOwnership({ qdnName: NAME, account: account(OWNER), accountNames: [NAME], nameRecord: record({ owner: OTHER }), bridgeAvailable: true });
    expect(identity.owner).toBe(false);
    expect(identity.reason).toBe('owner-address-mismatch');
  });

  it('does not grant mutation from a forged owner flag', () => {
    expect(canMutate({ role: 'owner', owner: true, address: OWNER, qdnName: NAME, nameRecordStatus: 'unavailable' })).toBe(false);
    expect(canMutate({ role: 'reader', owner: true, address: OWNER, qdnName: NAME, nameRecordStatus: 'verified' })).toBe(false);
    expect(canMutate({ role: 'owner', owner: true, address: '', qdnName: NAME, nameRecordStatus: 'verified' })).toBe(false);
  });

  it('rejects a stale account and an ownership change at mutation time', () => {
    const identity = ownerIdentity();
    expect(evaluateRevalidation(identity, { account: account(OTHER), accountNames: [NAME], nameRecord: record() }).error).toBe('account-changed');
    expect(evaluateRevalidation(identity, { account: account(OWNER), accountNames: [NAME], nameRecord: record({ owner: OTHER }) }).ok).toBe(false);
    expect(evaluateRevalidation(identity, { account: account(OWNER), accountNames: [NAME], nameRecord: null }).ok).toBe(false);
    expect(evaluateRevalidation(identity, { account: account(OWNER), accountNames: [NAME], nameRecord: record() }).ok).toBe(true);
    expect(evaluateRevalidation(identity, { account: account(OWNER), accountNames: ['other'], nameRecord: record() }).ok).toBe(false);
  });
});

describe('browser-side forgery cannot choose the authorization target', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    window.history.pushState({}, '', '/');
    delete (window as any)._qdnName;
    delete (window as any).qortalRequest;
    localStorage.clear();
  });

  it('ignores ?name= and uses the hosted QDN name', () => {
    window.history.pushState({}, '', '/?name=attacker%20name&qdnName=attacker%20name');
    (window as any)._qdnName = NAME;
    expect(discoverQdnName('config name')).toBe(NAME);
  });

  it('keeps the hosted name when localStorage claims another owner', async () => {
    localStorage.setItem('qms-cms-owner', JSON.stringify({ owner: true, qdnName: 'attacker name', address: OWNER }));
    window.history.pushState({}, '', '/?name=attacker%20name');
    (window as any)._qdnName = NAME;
    const calls: any[] = [];
    (window as any).qortalRequest = async (payload: any) => {
      calls.push(payload);
      if (payload.action === 'GET_USER_ACCOUNT') return { address: OWNER, name: NAME };
      if (payload.action === 'GET_ACCOUNT_NAMES') return [{ name: NAME, owner: OWNER }];
      if (payload.action === 'GET_PRIMARY_NAME') return NAME;
      throw new Error('unexpected action');
    };
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).includes('/names/')) return { ok: true, json: async () => record() };
      throw new Error('unexpected fetch ' + url);
    }));
    const identity = await resolveViewerIdentity({ qdnName: discoverQdnName('') });
    expect(identity.qdnName).toBe(NAME);
    expect(identity.owner).toBe(true);
    expect(calls.some((call) => call.action === 'GET_USER_ACCOUNT')).toBe(true);
  });

  it('fails revalidation when the active account changed after page load', async () => {
    const identity = ownerIdentity();
    (window as any).qortalRequest = async (payload: any) => {
      if (payload.action === 'GET_USER_ACCOUNT') return { address: OTHER };
      if (payload.action === 'GET_ACCOUNT_NAMES') return [{ name: 'other', owner: OTHER }];
      if (payload.action === 'GET_PRIMARY_NAME') return 'other';
      throw new Error('unexpected');
    };
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => record() })));
    const result = await revalidateViewerIdentity(identity);
    expect(result.ok).toBe(false);
    expect(result.error).toBe('account-changed');
  });

  it('ignores a visitor-supplied ?node= for ownership lookups', async () => {
    window.history.pushState({}, '', '/?node=http://attacker.invalid:12391');
    const urls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      urls.push(String(url));
      return { ok: true, json: async () => record() };
    }));
    const result = await fetchNameRecord(NAME);
    expect(result.error).toBeNull();
    expect(urls[0]).not.toContain('attacker.invalid');
    expect(urls[0]).toContain('/names/');
  });

  it('opens attribution through the Hub OPEN_NEW_TAB action with qortalLink', async () => {
    const calls: any[] = [];
    (window as any).qortalRequest = async (payload: any) => { calls.push(payload); return true; };
    const result = await openQortalLink('qortal://WEBSITE/Qortal%20Web%20Builders/');
    expect(result.ok).toBe(true);
    expect(calls[0]).toEqual({ action: 'OPEN_NEW_TAB', qortalLink: 'qortal://WEBSITE/Qortal%20Web%20Builders/' });
    delete (window as any).qortalRequest;
    const fallback = await openQortalLink('qortal://WEBSITE/Qortal%20Web%20Builders/');
    expect(fallback.ok).toBe(false);
    expect(fallback.message).toContain('Qortal Hub');
  });

  it('fails revalidation when the name record is unavailable', async () => {
    const identity = ownerIdentity();
    (window as any).qortalRequest = async (payload: any) => {
      if (payload.action === 'GET_USER_ACCOUNT') return { address: OWNER };
      if (payload.action === 'GET_ACCOUNT_NAMES') return [{ name: NAME, owner: OWNER }];
      if (payload.action === 'GET_PRIMARY_NAME') return NAME;
      throw new Error('unexpected');
    };
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('node offline'); }));
    const result = await revalidateViewerIdentity(identity);
    expect(result.ok).toBe(false);
    expect(result.message).toContain('node offline');
  });
});

