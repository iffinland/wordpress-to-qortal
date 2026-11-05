import test from 'node:test';
import assert from 'node:assert/strict';
import { canMutate, evaluateOwnership, requireOwner } from '../../templates/generic-cms/src/lib/ownership.js';
import {
  applyAdoption,
  readAdoptionQueue,
  removeAdoption,
  writeAdoptionQueue
} from '../../templates/generic-cms/src/lib/adoption.js';
import { createMemoryStorage } from './support/fixtures.js';

const OWNER = {
  role: 'owner',
  owner: true,
  address: 'QOwnerAddress111111111111111111111',
  name: 'QortalDemo',
  names: ['QortalDemo'],
  qdnName: 'QortalDemo',
  bridgeAvailable: true,
  nameRecordStatus: 'verified',
  reason: 'name-record-verified',
  message: 'Owner mode is enabled.'
};

const READER = {
  ...OWNER,
  role: 'reader',
  owner: false,
  nameRecordStatus: 'mismatch',
  reason: 'owner-address-mismatch',
  message: 'Read-only.'
};

const ITEM = {
  id: 'wp-900',
  type: 'post',
  title: 'Golden Post',
  slug: 'golden-post',
  contentRef: { service: 'DOCUMENT', name: 'Corbett', identifier: 'cr-post-900' },
  legacy: { sourceId: 900, oldUrl: 'https://corbett.example/golden-post/' }
};

test('owner mode requires the current account to own the configured QDN name', () => {
  const identity = evaluateOwnership({
    qdnName: 'QortalDemo',
    account: { address: OWNER.address },
    accountNames: ['QortalDemo', 'AnotherName'],
    nameRecord: { name: 'QortalDemo', owner: OWNER.address }
  });
  assert.equal(identity.owner, true);
  assert.equal(identity.role, 'owner');
  assert.equal(identity.nameRecordStatus, 'verified');
  assert.equal(identity.reason, 'name-record-verified');
});

test('a name string without current ownership stays read-only', () => {
  const identity = evaluateOwnership({
    qdnName: 'QortalDemo',
    account: { address: OWNER.address },
    accountNames: ['SomeOtherName'],
    nameRecord: { name: 'QortalDemo', owner: OWNER.address }
  });
  assert.equal(identity.owner, false);
  assert.equal(identity.reason, 'name-not-owned');
});

test('an on-chain owner mismatch overrides a matching name string', () => {
  const identity = evaluateOwnership({
    qdnName: 'QortalDemo',
    account: { address: OWNER.address },
    accountNames: ['QortalDemo'],
    nameRecord: { name: 'QortalDemo', owner: 'QDifferentOwnerAddress11111111111111' }
  });
  assert.equal(identity.owner, false);
  assert.equal(identity.reason, 'owner-address-mismatch');
  assert.equal(identity.nameRecordStatus, 'mismatch');
});

test('unavailable name records always fail closed', () => {
  const identity = evaluateOwnership({
    qdnName: 'QortalDemo',
    account: { address: OWNER.address },
    accountNames: ['QortalDemo'],
    nameRecord: null
  });
  assert.equal(identity.owner, false);
  assert.equal(identity.reason, 'name-record-unavailable');
  assert.equal(identity.nameRecordStatus, 'unavailable');
  assert.equal(canMutate(identity), false);
});

test('missing account or name config is read-only', () => {
  assert.equal(evaluateOwnership({ qdnName: 'QortalDemo', account: null }).owner, false);
  assert.equal(evaluateOwnership({ qdnName: '', account: { address: OWNER.address } }).owner, false);
});

test('admin guards reject readers and allow only verified owners', () => {
  assert.equal(canMutate(OWNER), true);
  assert.equal(canMutate(READER), false);
  assert.equal(requireOwner(READER, 'import').ok, false);
  assert.equal(requireOwner(OWNER, 'import').ok, true);
});

test('adoption is owner-only and preserves Corbett legacy identifiers', () => {
  const denied = applyAdoption([], { siteId: 'corbettreport', items: [ITEM], identity: READER, now: 1 });
  assert.equal(denied.ok, false);
  assert.equal(denied.error, 'read-only');

  const allowed = applyAdoption([], { siteId: 'corbettreport', items: [ITEM], identity: OWNER, now: 1 });
  assert.equal(allowed.ok, true);
  assert.equal(allowed.adopted.length, 1);
  const record = allowed.queue[0];
  assert.equal(record.itemId, 'wp-900');
  assert.equal(record.sourceId, 900);
  assert.equal(record.oldUrl, 'https://corbett.example/golden-post/');
  assert.equal(record.contentRef.identifier, 'cr-post-900');
  assert.ok(record.contentRef.identifier.startsWith('cr-'));
});

test('adoption queue persists and removal is owner-only', () => {
  const storage = createMemoryStorage();
  const allowed = applyAdoption([], { siteId: 'corbettreport', items: [ITEM], identity: OWNER, now: 1 });
  assert.equal(writeAdoptionQueue(storage, 'corbettreport', allowed.queue), true);
  const loaded = readAdoptionQueue(storage, 'corbettreport');
  assert.equal(loaded.length, 1);
  assert.equal(loaded[0].contentRef.identifier, 'cr-post-900');
  const denied = removeAdoption(loaded, loaded[0].key, READER);
  assert.equal(denied.queue.length, 1);
  const removed = removeAdoption(loaded, loaded[0].key, OWNER);
  assert.equal(removed.queue.length, 0);
});
