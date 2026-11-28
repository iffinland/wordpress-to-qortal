import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateActiveDocs, expectedArtifactNames } from '../../scripts/release/docs-consistency.mjs';

const release = {
  version: '0.8.0-beta.2',
  releaseTag: 'v0.8.0-beta.2',
  components: {
    desktop: { version: '0.8.0-beta.1' },
    publisher: { version: '0.8.0-beta.1' },
    cms: { version: '0.8.0-beta.2' }
  }
};
const names = expectedArtifactNames(release);
const changelog = '# Changelog\n\n## 0.8.0-beta.2 — 2026-11-15\n\n## 0.8.0-beta.1 — 2026-11-11\n';
const readme = '## Download Qortal Migration Studio 0.8.0 beta.2\n\n' +
  Object.values(names).map((name) => '[' + name + '](https://github.com/iffinland/wordpress-to-qortal/releases/download/v0.8.0-beta.2/' + name + ')').join('\n') +
  '\n\n[beta.2 prerelease](https://github.com/iffinland/wordpress-to-qortal/releases/tag/v0.8.0-beta.2)\n\n## Next\n';
const quickstart = '# Quick Start\n\n1. Download [' + names.desktop + '](https://github.com/iffinland/wordpress-to-qortal/releases/download/v0.8.0-beta.2/' + names.desktop + ')\n';
const install = 'This is the **0.8.0-beta.1** Desktop package in the **v0.8.0-beta.2** GitHub bundle release.\n' +
  'sudo apt install ./' + names.desktop + '\n';
const manifest = {
  version: '0.8.0-beta.2',
  tag: 'v0.8.0-beta.2',
  artifacts: [
    { kind: 'deb', name: names.desktop, componentVersion: '0.8.0-beta.1' },
    { kind: 'publisher', name: names.publisher, componentVersion: '0.8.0-beta.1' },
    { kind: 'cms', name: names.cms, componentVersion: '0.8.0-beta.2' }
  ]
};
function valid(overrides = {}) {
  return evaluateActiveDocs({
    release, changelog, readme, quickstart, install, manifest,
    strictManifest: true, ...overrides
  });
}

test('accepts current active documentation', () => {
  const result = valid();
  assert.equal(result.ok, true, result.errors.join(' '));
});
test('checks independent Desktop URLs against its component tag rather than the older bundle', () => {
  const next = { ...release, components: { ...release.components, desktop: { version: '0.8.0-beta.5' } }, componentReleases: { desktop: { version: '0.8.0-beta.5', tag: 'desktop-v0.8.0-beta.5' } } };
  const name = expectedArtifactNames(next).desktop;
  const replace = text => text.replaceAll('/download/v0.8.0-beta.2/' + names.desktop, '/download/desktop-v0.8.0-beta.5/' + name).replaceAll(names.desktop, name);
  const componentManifests = { desktop: { version: '0.8.0-beta.5', tag: 'desktop-v0.8.0-beta.5', artifact: { name, componentVersion: '0.8.0-beta.5' } } };
  const input = { release: next, componentManifests, readme: replace(readme), quickstart: replace(quickstart), install: replace(install) + '\nRelease: desktop-v0.8.0-beta.5\n' };
  assert.equal(valid(input).ok, true);
  assert.equal(valid({ ...input, quickstart }).ok, false);
});
test('rejects a changelog without the current release', () => {
  assert.match(valid({ changelog: '# Changelog\n\n## 0.8.0-beta.1\n' }).errors.join(' '), /CHANGELOG/);
});
test('rejects a QUICKSTART pointing at rc.7', () => {
  assert.match(valid({ quickstart: '# Quick Start\n\n[qortal-migration-studio_0.8.0-rc.7_amd64.deb](https://github.com/iffinland/wordpress-to-qortal/releases/download/v0.8.0-rc.7/qortal-migration-studio_0.8.0-rc.7_amd64.deb)\n' }).errors.join(' '), /QUICKSTART/);
});
test('rejects a README label that disagrees with its beta.2 URL', () => {
  const wrong = readme.replace('[beta.2 prerelease]', '[beta.1 prerelease]');
  assert.match(valid({ readme: wrong }).errors.join(' '), /release-link label/);
});
test('rejects INSTALL-LINUX claiming rc.7 is current', () => {
  assert.match(valid({ install: 'This is the **0.8.0 rc.7** release.\n' + install }).errors.join(' '), /INSTALL-LINUX/);
});
test('rejects INSTALL-LINUX naming a different desktop version', () => {
  const wrong = install.replace('qortal-migration-studio_0.8.0-beta.1_amd64.deb', 'qortal-migration-studio_0.8.0-beta.0_amd64.deb');
  assert.match(valid({ install: wrong }).errors.join(' '), /desktop artifact/);
});
test('rejects a stale or missing manifest only under strict validation', () => {
  assert.match(valid({ manifest: null }).errors.join(' '), /manifest is missing/);
  assert.match(valid({ manifest: { ...manifest, version: '0.8.0-beta.1' } }).errors.join(' '), /manifest is stale/);
  const prebuild = valid({ manifest: { ...manifest, version: '0.8.0-beta.1' }, strictManifest: false });
  assert.equal(prebuild.ok, true, prebuild.errors.join(' '));
});
test('does not reject historical examples outside the active sections', () => {
  const historicalQuickstart = quickstart + '\n'.repeat(35) + 'Historical: 0.8.0-rc.7 used an older package.\n';
  assert.equal(valid({ quickstart: historicalQuickstart }).ok, true);
});

test('unpublished trials keep validating public links and require matching trial documentation', async () => {
  const { evaluateDevelopmentDocs } = await import('../../scripts/release/docs-consistency.mjs');
  const staged = { ...release, development: { status: 'unpublished', component: 'desktop', version: '0.8.0-beta.3' }, components: { ...release.components, desktop: { version: '0.8.0-beta.3' } } };
  const note = '\nUnpublished qortal-migration-studio_0.8.0-beta.3_amd64.deb\n';
  const input = { release: staged, publishedRelease: release, changelog, readme: readme + note, quickstart: quickstart + note, install: install + note, manifest, strictManifest: true, developmentNotes: note };
  assert.equal(evaluateDevelopmentDocs(input).ok, true);
  assert.equal(evaluateDevelopmentDocs({ ...input, developmentNotes: '' }).ok, false);
  assert.equal(evaluateDevelopmentDocs({ ...input, publishedRelease: { ...release, releaseTag: 'v0.0.0' } }).ok, false);
  assert.equal(evaluateDevelopmentDocs({ ...input, readme: input.readme + 'https://github.com/iffinland/wordpress-to-qortal/releases/download/v0.8.0-beta.2/qortal-migration-studio_0.8.0-beta.3_amd64.deb' }).ok, false);
});

test('separate CMS release requires its own exact manifest and preserves bundle desktop links', () => {
  const next = { ...release, components: { ...release.components, cms: { version: '0.9.0-beta.2' } }, componentReleases: { cms: { version: '0.9.0-beta.2', tag: 'cms-v0.9.0-beta.2' } } };
  const newName = 'qortal-migration-generic-cms-v0.9.0-beta.2.zip';
  const text = readme.replace('/download/v0.8.0-beta.2/' + names.cms, '/download/cms-v0.9.0-beta.2/' + newName);
  const componentManifests = { cms: { version: '0.9.0-beta.2', tag: 'cms-v0.9.0-beta.2', artifact: { name: newName, componentVersion: '0.9.0-beta.2' } } };
  assert.equal(valid({ release: next, readme: text, componentManifests }).ok, true);
  assert.match(valid({ release: next, readme: text }).errors.join(' '), /component manifest/);
  assert.match(valid({ release: next, readme: text, componentManifests: { cms: { ...componentManifests.cms, tag: 'wrong' } } }).errors.join(' '), /component manifest/);
  assert.equal(valid({ release: next, readme, componentManifests }).ok, false);
});
