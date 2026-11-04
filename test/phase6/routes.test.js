import test from 'node:test';
import assert from 'node:assert/strict';
import {
  archiveHref,
  categoryHref,
  pageHref,
  parseHashRoute,
  postHref,
  routeKey,
  searchHref,
  tagHref
} from '../../templates/generic-cms/src/lib/routes.js';
import { paginate } from '../../templates/generic-cms/src/lib/archive.js';

test('generic CMS routes cover home, posts, pages, terms, archive, search and admin', () => {
  assert.deepEqual(parseHashRoute(''), { kind: 'home' });
  assert.deepEqual(parseHashRoute('#/'), { kind: 'home' });
  assert.deepEqual(parseHashRoute('#/posts'), { kind: 'posts', page: 1 });
  assert.deepEqual(parseHashRoute('#/posts?page=2'), { kind: 'posts', page: 2 });
  assert.deepEqual(parseHashRoute('#/posts/hello-qortal'), { kind: 'post', slug: 'hello-qortal' });
  assert.deepEqual(parseHashRoute('#/pages/about'), { kind: 'page', slug: 'about' });
  assert.deepEqual(parseHashRoute('#/category/news'), { kind: 'category', slug: 'news', page: 1 });
  assert.deepEqual(parseHashRoute('#/tag/design?page=3'), { kind: 'tag', slug: 'design', page: 3 });
  assert.deepEqual(parseHashRoute('#/archive'), { kind: 'archive', year: undefined, month: undefined, page: 1 });
  assert.deepEqual(parseHashRoute('#/archive/2024/05'), { kind: 'archive', year: 2024, month: 5, page: 1 });
  assert.deepEqual(parseHashRoute('#/archive/2024/99'), { kind: 'archive', year: 2024, month: undefined, page: 1 });
  assert.deepEqual(parseHashRoute('#/search?q=qortal'), { kind: 'search', query: 'qortal' });
  assert.deepEqual(parseHashRoute('#/admin'), { kind: 'admin' });
  assert.deepEqual(parseHashRoute('#/unknown'), { kind: 'not-found' });
});

test('route hrefs round-trip encoded slugs', () => {
  assert.deepEqual(parseHashRoute(postHref('a b/c')), { kind: 'post', slug: 'a b/c' });
  assert.deepEqual(parseHashRoute(pageHref('about us')), { kind: 'page', slug: 'about us' });
  assert.deepEqual(parseHashRoute(categoryHref('news', 2)), { kind: 'category', slug: 'news', page: 2 });
  assert.deepEqual(parseHashRoute(tagHref('design', 2)), { kind: 'tag', slug: 'design', page: 2 });
  assert.deepEqual(parseHashRoute(archiveHref(2024, 5, 2)), { kind: 'archive', year: 2024, month: 5, page: 2 });
  assert.deepEqual(parseHashRoute(searchHref('hello world')), { kind: 'search', query: 'hello world' });
});

test('route keys are stable for effect dependencies', () => {
  assert.equal(routeKey(parseHashRoute('#/posts/hello')), 'post:hello');
  assert.equal(routeKey(parseHashRoute('#/category/news?page=2')), 'category:news:2');
  assert.equal(routeKey(parseHashRoute('#/search?q=x')), 'search:x');
  assert.equal(routeKey(parseHashRoute('#/admin')), 'admin');
});

test('pagination clamps pages and reports bounds', () => {
  const page = paginate([1, 2, 3, 4, 5], 2, 2);
  assert.deepEqual(page.items, [3, 4]);
  assert.equal(page.totalPages, 3);
  assert.equal(page.hasPrevious, true);
  assert.equal(page.hasNext, true);
  const clamped = paginate([1, 2, 3], 99, 2);
  assert.equal(clamped.page, 2);
  assert.equal(clamped.hasNext, false);
});
