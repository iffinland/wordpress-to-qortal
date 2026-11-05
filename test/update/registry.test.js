import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assessUpdate,
  channelOfVersion,
  compareSemver,
  createUpdateChecker,
  isChannelAllowed,
  parseRegistryDocument,
  pickArtifact,
  REGISTRY_IDENTITY
} from '../../lib/update/registry.js';
import { componentFor, registryFixture, TAG } from './support/registry-fixture.js';

test('SemVer precedence is numeric and prerelease-aware', () => {
  assert.equal(compareSemver('0.8.0', '0.8.0-rc.1'), 1);
  assert.equal(compareSemver('0.8.0-rc.1', '0.8.0-beta.9'), 1);
  assert.equal(compareSemver('0.8.0-beta.2', '0.8.0-alpha.99'), 1);
  assert.equal(compareSemver('0.8.0-alpha.2', '0.8.0-alpha.10'), -1);
  assert.equal(compareSemver('0.8.0-alpha.10', '0.8.0-beta.1'), -1);
  assert.equal(compareSemver('0.10.0', '0.9.99'), 1);
  assert.equal(compareSemver('1.0.0+build.9', '1.0.0+build.2'), 0);
  assert.equal(compareSemver('1.0.0-alpha', '1.0.0-alpha.1'), -1);
  assert.throws(() => compareSemver('1.0', '1.0.0'));
  assert.equal(channelOfVersion('0.8.0-alpha.2'), 'alpha');
  assert.equal(channelOfVersion('0.8.0-beta.2'), 'beta');
  assert.equal(channelOfVersion('0.8.0-rc.2'), 'rc');
  assert.equal(channelOfVersion('0.8.0'), 'stable');
  assert.equal(isChannelAllowed('alpha', 'beta'), true);
  assert.equal(isChannelAllowed('beta', 'alpha'), false);
  assert.equal(isChannelAllowed('stable', 'rc'), false);
});

test('a valid registry parses with exact pinned identity', () => {
  const result = parseRegistryDocument(registryFixture());
  assert.equal(result.ok, true, result.errors.join('; '));
  assert.equal(result.registry.schema, 'qms-update-registry@1');
  assert.deepEqual(result.registry.registry, REGISTRY_IDENTITY);
  assert.equal(result.registry.sequence, 3);
});

test('malformed JSON and malformed structures never throw', () => {
  const malformed = parseRegistryDocument('{not json');
  assert.equal(malformed.ok, false);
  assert.equal(malformed.code, 'registry_malformed');
  assert.equal(parseRegistryDocument(null).ok, false);
  assert.equal(parseRegistryDocument([]).ok, false);
  const missing = registryFixture();
  delete missing.components.cms;
  assert.equal(parseRegistryDocument(missing).ok, false);
  const empty = registryFixture();
  empty.components = {};
  assert.equal(parseRegistryDocument(empty).ok, false);
});

test('registry schema migration is explicit and future schemas are rejected', () => {
  const legacy = {
    schema: 'qms-update-registry@0',
    product: 'Qortal Migration Studio',
    generatedAt: '2026-11-05T05:10:00.000Z',
    sequence: 1,
    version: '0.7.0-alpha.1',
    channel: 'alpha',
    tag: 'v0.7.0-alpha.1',
    changelog: { summary: 'First registry.' },
    artifacts: {
      desktop: [componentFor('desktop', '0.7.0-alpha.1').artifacts[0]],
      publisher: [componentFor('publisher', '0.7.0-alpha.1').artifacts[0]],
      cms: [componentFor('cms', '0.7.0-alpha.1').artifacts[0]]
    }
  };
  const migrated = parseRegistryDocument(legacy);
  assert.equal(migrated.ok, true, migrated.errors.join('; '));
  assert.equal(migrated.migrations.length, 1);
  assert.equal(migrated.registry.components.desktop.version, '0.7.0-alpha.1');
  const future = parseRegistryDocument({ schema: 'qms-update-registry@2', components: {} });
  assert.equal(future.ok, false);
  assert.equal(future.code, 'registry_schema_unsupported');
});

test('invalid identity, hash, URL and component channel are rejected', () => {
  const wrongIdentity = registryFixture();
  wrongIdentity.registry.name = 'attacker name';
  const identityResult = parseRegistryDocument(wrongIdentity);
  assert.equal(identityResult.ok, false);
  assert.match(identityResult.errors.join('; '), /registry\.registry\.name/);

  const badHash = registryFixture();
  badHash.components.cms.artifacts[0].sha256 = 'nope';
  assert.equal(parseRegistryDocument(badHash).ok, false);

  const badScheme = registryFixture();
  badScheme.components.cms.artifacts[0].url = 'http://github.com/iffinland/wordpress-to-qortal/releases/download/' + TAG + '/' + badScheme.components.cms.artifacts[0].name;
  const schemeResult = parseRegistryDocument(badScheme);
  assert.equal(schemeResult.ok, false);
  assert.match(schemeResult.errors.join('; '), /https:\/\/github\.com/);

  const wrongHost = registryFixture();
  wrongHost.components.desktop.artifacts[0].url = wrongHost.components.desktop.artifacts[0].url.replace('github.com', 'evil.example');
  assert.equal(parseRegistryDocument(wrongHost).ok, false);

  const wrongChannel = registryFixture();
  wrongChannel.components.publisher.channel = 'stable';
  const channelResult = parseRegistryDocument(wrongChannel);
  assert.equal(channelResult.ok, false);
  assert.match(channelResult.errors.join('; '), /channel must match the version prerelease/);
});

test('artifact name must match the URL and each platform may appear once', () => {
  const mismatch = registryFixture();
  mismatch.components.publisher.artifacts[0].name = 'other.zip';
  const result = parseRegistryDocument(mismatch);
  assert.equal(result.ok, false);
  assert.match(result.errors.join('; '), /does not match the expected release asset URL/);

  const duplicate = registryFixture();
  duplicate.components.desktop.artifacts.push({ ...duplicate.components.desktop.artifacts[0] });
  assert.equal(parseRegistryDocument(duplicate).ok, false);
});

test('only changed components produce an update', () => {
  const registry = registryFixture({ versions: { desktop: '0.9.0-alpha.1', publisher: '0.8.0-alpha.1', cms: '0.8.0-alpha.1' } });
  const desktop = assessUpdate({ registry, componentId: 'desktop', installedVersion: '0.8.0-alpha.1', platform: 'linux-x64' });
  assert.equal(desktop.status, 'update_available');
  assert.equal(desktop.showBadge, true);
  assert.equal(desktop.artifact.format, 'deb');
  const publisher = assessUpdate({ registry, componentId: 'publisher', installedVersion: '0.8.0-alpha.1' });
  assert.equal(publisher.status, 'up_to_date');
  assert.equal(publisher.showBadge, false);
  const cms = assessUpdate({ registry, componentId: 'cms', installedVersion: '0.8.0-alpha.1' });
  assert.equal(cms.status, 'up_to_date');
});

test('publisher-only, cms-only and simultaneous updates are independent', () => {
  const publisherOnly = registryFixture({ versions: { desktop: '0.8.0-alpha.1', publisher: '0.8.1-alpha.1', cms: '0.8.0-alpha.1' } });
  assert.equal(assessUpdate({ registry: publisherOnly, componentId: 'publisher', installedVersion: '0.8.0-alpha.1' }).status, 'update_available');
  assert.equal(assessUpdate({ registry: publisherOnly, componentId: 'cms', installedVersion: '0.8.0-alpha.1' }).status, 'up_to_date');

  const cmsOnly = registryFixture({ versions: { desktop: '0.8.0-alpha.1', publisher: '0.8.0-alpha.1', cms: '0.8.2-alpha.1' } });
  assert.equal(assessUpdate({ registry: cmsOnly, componentId: 'cms', installedVersion: '0.8.0-alpha.1' }).status, 'update_available');

  const all = registryFixture({ versions: { desktop: '0.9.0-alpha.1', publisher: '0.9.0-alpha.1', cms: '0.9.0-alpha.1' } });
  for (const id of ['desktop', 'publisher', 'cms']) {
    assert.equal(assessUpdate({ registry: all, componentId: id, installedVersion: '0.8.0-alpha.1', platform: id === 'desktop' ? 'linux-x64' : null }).status, 'update_available', id);
  }
});

test('channel policy never offers a less stable release', () => {
  const registry = registryFixture({ versions: { cms: '0.9.0-alpha.1' } });
  const betaUser = assessUpdate({ registry, componentId: 'cms', installedVersion: '0.8.0-beta.1' });
  assert.equal(betaUser.status, 'incompatible');
  assert.equal(betaUser.reasonCode, 'channel_not_allowed');
  assert.equal(betaUser.showBadge, false);

  const stableRegistry = registryFixture({ versions: { cms: '0.9.0-rc.1' } });
  const stableUser = assessUpdate({ registry: stableRegistry, componentId: 'cms', installedVersion: '0.8.0' });
  assert.equal(stableUser.status, 'incompatible');

  const newerStable = registryFixture({ versions: { cms: '0.9.0' } });
  assert.equal(assessUpdate({ registry: newerStable, componentId: 'cms', installedVersion: '0.8.0-rc.1' }).status, 'update_available');
});

test('installed newer, missing component and missing platform are non-events', () => {
  const registry = registryFixture();
  assert.equal(assessUpdate({ registry, componentId: 'cms', installedVersion: '9.0.0-alpha.1' }).status, 'up_to_date');
  const missing = parseRegistryDocument(registry);
  delete missing.registry.components.cms;
  const missingResult = parseRegistryDocument(JSON.stringify(missing.registry));
  assert.equal(assessUpdate({ registry: missingResult, componentId: 'cms', installedVersion: '0.8.0-alpha.1' }).status, 'unverified');
  const newerDesktop = registryFixture({ versions: { desktop: '0.9.0-alpha.1' } });
  const noPlatform = assessUpdate({ registry: newerDesktop, componentId: 'desktop', installedVersion: '0.8.0-alpha.1', platform: 'windows-x64' });
  assert.equal(noPlatform.status, 'unverified');
  assert.equal(noPlatform.reasonCode, 'artifact_missing');
});

test('minimum dependency versions block an otherwise newer update', () => {
  const registry = registryFixture({ versions: { desktop: '0.9.0-alpha.1' } });
  registry.components.desktop.minimumDependencies = { engine: '0.9.0-alpha.1' };
  const blocked = assessUpdate({ registry, componentId: 'desktop', installedVersion: '0.8.0-alpha.1', platform: 'linux-x64', dependencies: { engine: '0.8.0-alpha.1' } });
  assert.equal(blocked.status, 'incompatible');
  assert.match(blocked.reason, /requires engine/);
  const allowed = assessUpdate({ registry, componentId: 'desktop', installedVersion: '0.8.0-alpha.1', platform: 'linux-x64', dependencies: { engine: '0.9.0-alpha.1' } });
  assert.equal(allowed.status, 'update_available');
});

test('the update checker retries briefly, then reports unable to check', async () => {
  let calls = 0;
  const checker = createUpdateChecker({
    componentId: 'cms',
    installedVersion: '0.8.0-alpha.1',
    fetchRegistry: async () => { calls += 1; throw new Error('offline'); },
    retries: 2,
    retryDelayMs: 1,
    sleep: async () => {}
  });
  const state = await checker.check();
  assert.equal(calls, 3);
  assert.equal(state.status, 'unable_to_check');
  assert.equal(state.showBadge, false);
});

test('malformed registry does not trigger extra retries and reports unverified', async () => {
  let calls = 0;
  const checker = createUpdateChecker({
    componentId: 'cms',
    installedVersion: '0.8.0-alpha.1',
    fetchRegistry: async () => { calls += 1; return '{"schema":"qms-update-registry@1"}'; },
    retries: 2,
    retryDelayMs: 1,
    sleep: async () => {}
  });
  const state = await checker.check();
  assert.equal(calls, 1);
  assert.equal(state.status, 'unverified');
  assert.equal(state.showBadge, false);
});

test('a stale cache never shows a badge but keeps a safe explanation', async () => {
  let now = 1_000_000;
  let online = true;
  const checker = createUpdateChecker({
    componentId: 'cms',
    installedVersion: '0.8.0-alpha.1',
    fetchRegistry: async () => {
      if (!online) throw new Error('offline');
      return registryFixture({ versions: { cms: '0.9.0-alpha.1' } });
    },
    retries: 0,
    now: () => now,
    staleMs: 60_000,
    cacheMs: 10_000
  });
  const fresh = await checker.check();
  assert.equal(fresh.status, 'update_available');
  assert.equal(fresh.showBadge, true);
  online = false;
  now += 20_000; // beyond cacheMs, still within staleMs
  const stale = await checker.check();
  assert.equal(stale.status, 'update_available');
  assert.equal(stale.stale, true);
  assert.equal(stale.showBadge, false);
  now += 120_000;
  const expired = await checker.check();
  assert.equal(expired.status, 'unable_to_check');
});

test('manual force refresh bypasses the fresh-cache short circuit', async () => {
  let calls = 0;
  const checker = createUpdateChecker({
    componentId: 'publisher',
    installedVersion: '0.8.0-alpha.1',
    fetchRegistry: async () => { calls += 1; return registryFixture(); },
    cacheMs: 60_000,
    retries: 0
  });
  await checker.check();
  await checker.check();
  assert.equal(calls, 1);
  await checker.check(true);
  assert.equal(calls, 2);
});

test('artifact selection prefers the requested platform', () => {
  const component = componentFor('desktop');
  assert.equal(pickArtifact(component, 'linux-x64').format, 'deb');
  assert.equal(pickArtifact(component, 'windows-x64'), null);
});
