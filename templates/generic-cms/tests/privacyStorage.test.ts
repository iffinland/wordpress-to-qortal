import { beforeEach, describe, expect, it } from 'vitest';
import { createScopedStorage, scopedKey, storageScope } from '../src/lib/storageScope.js';
import { deleteLegacyDrafts, legacyDraftCount, readDrafts, writeDrafts } from '../src/lib/drafts.js';
import { readAdoptionQueue, writeAdoptionQueue } from '../src/lib/adoption.js';
import { PENDING_KEY, PENDING_SCHEMA, readPending } from '../src/lib/publish.js';
import { ownerIdentity, readerIdentity } from './support/fixtures';

const deployment = { service: 'APP', name: 'QortalDemo', identifier: 'default' };
const ownerB = { ...ownerIdentity, address: 'QOwnerAddress222222222222222222222' };
const scopeA = storageScope({ deployment, identity: ownerIdentity, siteId: 'site-fixture' })!;
const scopeB = storageScope({ deployment, identity: ownerB, siteId: 'site-fixture' })!;
const readerScope = storageScope({ deployment, identity: readerIdentity, siteId: 'site-fixture' });

beforeEach(() => localStorage.clear());

describe('per-account local storage scope', () => {
  it('keeps two owners in the same browser apart', () => {
    expect(scopeA && scopeA.key).toBeTruthy();
    expect(scopeB && scopeB.key).toBeTruthy();
    expect(scopeA.key).not.toBe(scopeB.key);
    writeDrafts(localStorage, scopeA, [{ id: 'a', title: 'Account A draft' }]);
    expect(readDrafts(localStorage, scopeA).map((item: any) => item.id)).toEqual(['a']);
    expect(readDrafts(localStorage, scopeB)).toEqual([]);
  });

  it('gives a reader no scope and no drafts', () => {
    expect(readerScope).toBeNull();
    expect(readDrafts(localStorage, null)).toEqual([]);
    expect(createScopedStorage(localStorage, null)).toBeNull();
  });

  it('hides old unscoped drafts, counts them and deletes only them', () => {
    writeDrafts(localStorage, scopeA, [{ id: 'scoped', title: 'Scoped' }]);
    localStorage.setItem('qms-cms-post-drafts:site-fixture', JSON.stringify({
      schema: 'qms-cms-post-drafts@1',
      drafts: [{ id: 'legacy', title: 'Old account draft', html: '<p>secret</p>' }]
    }));
    expect(readDrafts(localStorage, scopeA).map((item: any) => item.id)).toEqual(['scoped']);
    expect(legacyDraftCount(localStorage, 'site-fixture')).toBe(1);
    expect(deleteLegacyDrafts(localStorage, 'site-fixture')).toBe(true);
    expect(legacyDraftCount(localStorage, 'site-fixture')).toBe(0);
    expect(readDrafts(localStorage, scopeA).map((item: any) => item.id)).toEqual(['scoped']);
  });

  it('scopes pending publication records', () => {
    const storageA = createScopedStorage(localStorage, scopeA)!;
    const storageB = createScopedStorage(localStorage, scopeB)!;
    storageA.setItem(PENDING_KEY, JSON.stringify({ schema: PENDING_SCHEMA, entries: [{ key: 'a', name: 'QortalDemo' }] }));
    expect(readPending(storageA)).toHaveLength(1);
    expect(readPending(storageB)).toEqual([]);
  });

  it('scopes adoption records and settings keys by deployment and owner', () => {
    writeAdoptionQueue(localStorage, scopeA, [{ key: 'a' }]);
    expect(readAdoptionQueue(localStorage, scopeA)).toHaveLength(1);
    expect(readAdoptionQueue(localStorage, scopeB)).toEqual([]);
    expect(scopedKey('qms-cms-settings-draft@1', scopeA)).not.toBe(scopedKey('qms-cms-settings-draft@1', scopeB));
  });
});
