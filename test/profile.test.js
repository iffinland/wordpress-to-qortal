import assert from 'node:assert/strict';
import test from 'node:test';
import { createQdnIdentifiers, loadProfile } from '../src/profile.js';

test('generic profile uses shareable wpq identifiers', () => {
  const profile = loadProfile('generic');
  assert.equal(profile.resourcePrefix, 'wpq');
  assert.equal(profile.qdnIdentifiers.qdn_manifest, 'wpq-qdn-manifest');
  assert.equal(profile.publicAuthorName, 'Site Author');
  assert.equal(profile.cmsTrustedCoauthorsCanAdoptImports, false);
  assert.equal(profile.cmsTrustedCoauthorsCanPublishMedia, false);
});

test('Corbett Report profile keeps site-specific names outside the universal engine', () => {
  const profile = loadProfile('corbettreport');
  assert.equal(profile.resourcePrefix, 'cr');
  assert.equal(profile.qdnIdentifiers.qdn_manifest, 'cr-qdn-manifest');
  assert.equal(profile.qortalSiteName, 'Corbett');
  assert.equal(profile.qortalContentName, '');
  assert.equal(profile.qortalMediaName, '');
  assert.deepEqual(profile.qortalPublisherNames, ['Corbett']);
  assert.deepEqual(profile.qortalSysopNames, ['Corbett']);
  assert.deepEqual(profile.qortalCoauthorNames, []);
  assert.equal(profile.cmsTrustedCoauthorsCanAdoptImports, true);
  assert.equal(profile.cmsTrustedCoauthorsCanPublishMedia, true);
});

test('identifier generation rejects unsafe profile prefixes', () => {
  assert.throws(() => createQdnIdentifiers('Bad Prefix'), /resource_prefix/);
});
