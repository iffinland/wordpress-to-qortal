import assert from 'node:assert/strict';
import test from 'node:test';
import { createQdnIdentifiers, loadProfile } from '../src/profile.js';

test('the default profile is the Corbett Report profile', () => {
  const profile = loadProfile();
  assert.equal(profile.id, 'corbettreport');
  assert.equal(profile.resourcePrefix, 'cr');
  assert.equal(profile.qdnIdentifiers.qdn_manifest, 'cr-qdn-manifest');
  assert.equal(profile.publicAuthorName, 'Corbett');
  assert.equal(profile.cmsTrustedCoauthorsCanAdoptImports, true);
  assert.equal(profile.cmsTrustedCoauthorsCanPublishMedia, true);
});

test('Corbett Report content uses the registered Corbett name', () => {
  const profile = loadProfile('corbettreport');
  assert.equal(profile.resourcePrefix, 'cr');
  assert.equal(profile.qdnIdentifiers.qdn_manifest, 'cr-qdn-manifest');
  assert.equal(profile.qortalSiteName, 'Corbett');
  assert.equal(profile.qortalContentName, 'Corbett');
  assert.equal(profile.qortalMediaName, '');
  assert.deepEqual(profile.qortalPublisherNames, ['Corbett']);
  assert.deepEqual(profile.qortalSysopNames, ['Corbett', 'CorbettReport']);
  assert.deepEqual(profile.qortalCoauthorNames, ['AgoristMarket', 'iffi']);
});

test('identifier generation rejects unsafe profile prefixes', () => {
  assert.throws(() => createQdnIdentifiers('Bad Prefix'), /resource_prefix/);
});
