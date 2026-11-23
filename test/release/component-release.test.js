import { test } from 'node:test';
import assert from 'node:assert/strict';
import { latestComponentAssets, parseChecksums } from '../../scripts/release/component-release.mjs';
const bundle = { tag_name: 'v0.8.0-beta.4', published_at: '2026-11-23T09:00:00Z', assets: ['qortal-migration-studio_0.8.0-beta.2_amd64.deb', 'qortal-migration-publisher-v0.8.0-beta.1.zip', 'qortal-migration-generic-cms-v0.9.0-beta.1.zip'].map((name) => ({ name })) };
const cms = { tag_name: 'cms-v0.9.0-beta.2', published_at: '2026-11-23T12:00:00Z', assets: [{ name: 'qortal-migration-generic-cms-v0.9.0-beta.2.zip' }] };
test('an independent CMS release keeps desktop and Publisher on their original bundle', () => {
 const picked = latestComponentAssets([bundle, cms, { ...cms, draft: true, published_at: '2027-01-01', tag_name: 'draft' }]);
 assert.equal(picked.desktop.release.tag_name, bundle.tag_name);
 assert.equal(picked.publisher.release.tag_name, bundle.tag_name);
 assert.equal(picked.cms.release.tag_name, cms.tag_name);
});
test('missing or ambiguous component assets block publication', () => {
 assert.throws(() => latestComponentAssets([cms]), /desktop/);
 assert.throws(() => latestComponentAssets([{ ...bundle, assets: [...bundle.assets, { name: 'qortal-migration-studio_other_amd64.deb' }] }]), /Ambiguous/);
});
test('checksum parsing requires a SHA256 digest', () => {
 assert.equal(parseChecksums('a'.repeat(64) + '  file.zip\nbad  other.zip').get('file.zip'), 'a'.repeat(64));
 assert.equal(parseChecksums('bad  other.zip').size, 0);
});
