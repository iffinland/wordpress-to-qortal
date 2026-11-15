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
const changelog = '# Changelog\n\n## 0.8.0-beta.2 — 2026-11-15\n';
const readme = '## Download Qortal Migration Studio 0.8.0 beta.2\n\n' +
  Object.values(names).map((name) => '[' + name + '](https://github.com/iffinland/wordpress-to-qortal/releases/download/v0.8.0-beta.2/' + name + ')').join('\n') +
  '\n\n## Next\n';
const quickstart = '# Quick Start\n\n1. Download [' + names.desktop + '](https://github.com/iffinland/wordpress-to-qortal/releases/download/v0.8.0-beta.2/' + names.desktop + ')\n';
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
  return evaluateActiveDocs({ release, changelog, readme, quickstart, manifest, ...overrides });
}
test('accepts current active documentation', () => {
  const result = valid();
  assert.equal(result.ok, true, result.errors.join(' '));
});
test('rejects a changelog without the current release', () => {
  const result = valid({ changelog: '# Changelog\n\n## 0.8.0-beta.1\n' });
  assert.match(result.errors.join(' '), /CHANGELOG/);
});
test('rejects a QUICKSTART pointing at rc.7', () => {
  const result = valid({ quickstart: '# Quick Start\n\n[qortal-migration-studio_0.8.0-rc.7_amd64.deb](https://github.com/iffinland/wordpress-to-qortal/releases/download/v0.8.0-rc.7/qortal-migration-studio_0.8.0-rc.7_amd64.deb)\n' });
  assert.match(result.errors.join(' '), /QUICKSTART/);
});
test('rejects README links from another release', () => {
  const result = valid({ readme: readme.replaceAll('v0.8.0-beta.2', 'v0.8.0-beta.1') });
  assert.match(result.errors.join(' '), /README/);
});
test('rejects a manifest with a mismatched component version', () => {
  const wrong = structuredClone(manifest);
  wrong.artifacts[2].componentVersion = '0.8.0-beta.1';
  const result = valid({ manifest: wrong });
  assert.match(result.errors.join(' '), /componentVersion/);
});
