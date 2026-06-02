import assert from 'node:assert/strict';
import test from 'node:test';
import { mergeManifestSources } from '../src/mergeQdnManifests.js';

function manifest(name, mediaName = name) {
  return {
    profile_id: 'corbettreport',
    identifier_prefix: 'cr',
    identifiers: { qdn_manifest: 'cr-qdn-manifest' },
    publisher_names: [name],
    public_author: 'Corbett',
    entrypoints: {
      posts_index: { service: 'DOCUMENT', identifier: 'cr-posts-index', name }
    },
    resources: {
      by_path: {
        'converted/posts-index.json': { service: 'DOCUMENT', identifier: 'cr-posts-index', name },
        'media/video.mp4': { service: 'VIDEO', identifier: `video-${mediaName}`, name: mediaName }
      },
      by_identifier: {},
      by_source_url: {
        'https://example.com/video.mp4': { service: 'VIDEO', identifier: `video-${mediaName}`, name: mediaName }
      }
    },
    linked_only_media: [],
    summary: {}
  };
}

test('merged catalog keeps content paths canonical and lets later media URLs override', () => {
  const merged = mergeManifestSources([
    { name: 'Corbett', manifest: manifest('Corbett') },
    { name: 'CorbettReportMedia', manifest: manifest('CorbettReportMedia') }
  ], 'CorbettReport', 'Corbett', 'Corbett', ['iffi', 'AgoristMarket']);

  assert.equal(merged.qdn_name, 'CorbettReport');
  assert.equal(merged.entrypoints.posts_index.name, 'Corbett');
  assert.equal(merged.resources.by_path['media/video.mp4'].name, 'Corbett');
  assert.equal(merged.resources.by_source_url['https://example.com/video.mp4'].name, 'CorbettReportMedia');
  assert.deepEqual(merged.coauthor_names, ['iffi', 'AgoristMarket']);
});
