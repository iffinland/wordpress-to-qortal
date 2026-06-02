import assert from 'node:assert/strict';
import test from 'node:test';
import {
  convertPost,
  createContentFileName,
  createPostIndexItem,
  createUrlMap
} from '../src/convert.js';
import { rewriteInternalLinks } from '../src/utils/html.js';

const config = {
  wordpressBaseUrl: 'https://example.com',
  importerVersion: 'test',
  publicAuthorName: 'Corbett'
};

function rawPost(overrides = {}) {
  return {
    id: 101,
    slug: 'shared-slug',
    link: 'https://example.com/shared-slug/',
    date: '2020-01-01T10:00:00',
    date_gmt: '2020-01-01T08:00:00',
    modified: '2020-01-02T10:00:00',
    modified_gmt: '2020-01-02T08:00:00',
    status: 'publish',
    title: { rendered: 'Shared slug' },
    excerpt: { rendered: '<p>Excerpt</p>' },
    content: { rendered: '<p>Content</p>' },
    ...overrides
  };
}

test('content filenames remain unique when slugs collide', () => {
  const first = convertPost(rawPost(), config);
  const second = convertPost(rawPost({ id: 102 }), config);
  assert.equal(createContentFileName(first), 'shared-slug--wp-101.json');
  assert.equal(createContentFileName(second), 'shared-slug--wp-102.json');
  assert.notEqual(createPostIndexItem(first).file, createPostIndexItem(second).file);
});

test('WordPress GMT timestamps become explicit published and modified timestamps', () => {
  const post = convertPost(rawPost(), config);
  assert.equal(post.published_at, '2020-01-01T08:00:00Z');
  assert.equal(post.modified_at, '2020-01-02T08:00:00Z');
});

test('public editorial author stays separate from the technical QDN publisher', () => {
  const post = convertPost(rawPost(), config);
  assert.equal(post.public_author, 'Corbett');
  assert.equal(createPostIndexItem(post).public_author, 'Corbett');
});

test('WordPress HTML entities are decoded in display titles', () => {
  const post = convertPost(rawPost({ title: { rendered: 'AI Line &#8211; #SolutionsWatch' } }), config);
  assert.equal(post.title, 'AI Line – #SolutionsWatch');
});

test('known internal WordPress links become Q-App hash routes', () => {
  const post = convertPost(rawPost(), config);
  const urlMap = createUrlMap({ convertedPosts: [post] });
  const html = rewriteInternalLinks(
    '<a href="https://example.com/shared-slug/">Internal</a><a href="https://qortal.org/">External</a>',
    config.wordpressBaseUrl,
    urlMap
  );
  assert.match(html, /href="#\/posts\/shared-slug"/);
  assert.match(html, /data-web2-href="https:\/\/example.com\/shared-slug\/"/);
  assert.match(html, /href="https:\/\/qortal.org\/"/);
});

test('unknown internal posts receive future Q-App routes while media links stay untouched', () => {
  const html = rewriteInternalLinks(
    '<a href="https://example.com/future-post/">Future</a><a href="https://example.com/mp4/video.mp4">Video</a>',
    config.wordpressBaseUrl,
    {}
  );
  assert.match(html, /href="#\/posts\/future-post"/);
  assert.match(html, /href="https:\/\/example.com\/mp4\/video.mp4"/);
});
