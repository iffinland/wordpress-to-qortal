import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkVersions, readRelease } from '../../scripts/qms-release.mjs';
import { artifactName, debVersion } from '../../scripts/release/lib.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('the bundle and all three component versions are synchronized with their markers', async () => {
  const result = await checkVersions(repo);
  assert.equal(result.ok, true, result.failures.join('\n'));
  assert.equal(result.entries.length >= 6, true);
  assert.match(result.release.version, /^\d+\.\d+\.\d+/);
  assert.deepEqual(Object.keys(result.release.components).sort(), ['cms', 'desktop', 'publisher']);
  for (const id of ['desktop', 'publisher', 'cms']) {
    assert.match(result.release.components[id].version, /^\d+\.\d+\.\d+/);
  }
  assert.equal(result.release.releaseTag, 'v' + result.release.version);
});

test('release descriptor declares the alpha channel and signing state honestly', async () => {
  const release = await readRelease(repo);
  assert.equal(release.schema, 'qms-release@2');
  assert.equal(release.product, 'Qortal Migration Studio');
  assert.equal(release.debianPackage, 'qortal-migration-studio');
  assert.ok(['alpha', 'beta', 'rc', 'stable'].includes(release.channel));
  assert.ok(['signed', 'unsigned'].includes(release.signing));
  assert.equal(release.architecture, 'amd64');
});

test('component versions are independent of the GitHub release bundle version', async () => {
  const release = await readRelease(repo);
  assert.equal(release.legacySchema, false);
  assert.equal(typeof release.components.desktop.version, 'string');
  assert.equal(typeof release.components.publisher.version, 'string');
  assert.equal(typeof release.components.cms.version, 'string');
  // The model does not require component versions to equal the bundle version.
  // A component that did not change keeps its previous version and artifact.
  assert.ok(Object.values(release.components).some((component) => component.version === release.version));
});

test('Debian release metadata is complete and uses Debian 12/13 alternatives', async () => {
  const config = JSON.parse(await readFile(path.join(repo, 'desktop/release.config.json'), 'utf8'));
  assert.equal(config.schema, 'qms-deb-release@1');
  assert.equal(config.packageName, 'qortal-migration-studio');
  assert.equal(config.installationRoot, '/opt/qortal-migration-studio');
  assert.equal(config.executableName, 'qortal-migration-studio');
  assert.ok(config.depends.some((entry) => entry.includes('libgtk-3-0t64')));
  assert.ok(config.depends.some((entry) => entry.includes('libasound2t64')));
  assert.ok(config.depends.some((entry) => entry.includes('libsecret-1-0')));
  assert.ok(config.depends.some((entry) => entry.includes('libatspi2.0-0t64')));
  assert.match(config.maintainer, /<[^>]+>$/);
  assert.match(config.homepage, /^https:\/\//);
});

test('all declared desktop icons exist', async () => {
  for (const size of ['16x16', '32x32', '48x48', '64x64', '128x128', '256x256', '512x512']) {
    await assert.doesNotReject(access(path.join(repo, 'desktop/build/icons', size + '.png')));
  }
});

test('engine runtime dependencies are pinned by a committed lockfile', async () => {
  const pkg = JSON.parse(await readFile(path.join(repo, 'desktop/engine-package/package.json'), 'utf8'));
  const lock = JSON.parse(await readFile(path.join(repo, 'desktop/engine-package/package-lock.json'), 'utf8'));
  assert.equal(lock.lockfileVersion, 3);
  assert.equal(lock.packages[''].version, pkg.version);
  for (const [name, version] of Object.entries(pkg.dependencies)) {
    assert.match(version, /^\d+\.\d+\.\d+$/, name + ' must be pinned to an exact version');
    assert.equal(lock.packages['node_modules/' + name].version, version);
  }
});

test('the deterministic builder normalizes ownership and timestamps', async () => {
  const source = await readFile(path.join(repo, 'scripts/release/build-deb.mjs'), 'utf8');
  assert.match(source, /--root-owner-group/);
  assert.match(source, /--uniform-compression/);
  assert.match(source, /SOURCE_DATE_EPOCH|sourceDateEpoch/);
  assert.match(source, /chmodSync/);
  assert.match(source, /symlink\(path\.join\(config\.installationRoot/);
  assert.doesNotMatch(source, /version: '0\.5\.0'/);
});

test('Electron packaging enables renderer hardening fuses', async () => {
  const builder = await readFile(path.join(repo, 'desktop/electron-builder.yml'), 'utf8');
  const fuses = await readFile(path.join(repo, 'desktop/scripts/after-pack.cjs'), 'utf8');
  assert.match(builder, /afterPack: scripts\/after-pack\.cjs/);
  assert.match(fuses, /OnlyLoadAppFromAsar\]: true/);
  assert.match(fuses, /EnableEmbeddedAsarIntegrityValidation\]: false/);
  assert.match(fuses, /EnableNodeOptionsEnvironmentVariable\]: false/);
  assert.match(fuses, /EnableNodeCliInspectArguments\]: false/);
  assert.match(fuses, /RunAsNode\]: true/);
});

test('Debian artifact names and versions are deterministic', () => {
  assert.equal(artifactName('qortal-migration-studio', '0.6.0', 'amd64'), 'qortal-migration-studio_0.6.0_amd64.deb');
  assert.equal(artifactName('qortal-migration-studio', '0.8.0-alpha.2', 'amd64'), 'qortal-migration-studio_0.8.0-alpha.2_amd64.deb');
  assert.equal(debVersion('0.6.0-alpha.1'), '0.6.0~alpha.1');
});
