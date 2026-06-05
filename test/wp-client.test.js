import assert from 'node:assert/strict';
import test from 'node:test';
import { WordPressClient } from '../src/wpClient.js';

test('WordPress post batches use a stable descending date order and offset', async () => {
  const originalFetch = globalThis.fetch;
  const requestedUrls = [];
  globalThis.fetch = async (url) => {
    requestedUrls.push(url.toString());
    return new Response(JSON.stringify([{ id: 101 }, { id: 100 }]), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  };

  try {
    const client = new WordPressClient({ baseUrl: 'https://example.com' });
    const posts = await client.fetchPosts({ limit: 2, offset: 15 });
    assert.deepEqual(posts.map((post) => post.id), [101, 100]);
    const url = new URL(requestedUrls[0]);
    assert.equal(url.searchParams.get('per_page'), '2');
    assert.equal(url.searchParams.get('offset'), '15');
    assert.equal(url.searchParams.get('order'), 'desc');
    assert.equal(url.searchParams.get('orderby'), 'date');
    assert.equal(url.searchParams.has('page'), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('WordPress post batches can continue from an immutable date cursor', async () => {
  const originalFetch = globalThis.fetch;
  let requestedUrl = '';
  globalThis.fetch = async (url) => {
    requestedUrl = url.toString();
    return new Response(JSON.stringify([{ id: 99 }]), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  };

  try {
    const client = new WordPressClient({ baseUrl: 'https://example.com' });
    await client.fetchPosts({ limit: 1, before: '2024-01-15T10:00:00.000Z' });
    const url = new URL(requestedUrl);
    assert.equal(url.searchParams.get('before'), '2024-01-15T10:00:00.000Z');
    assert.equal(url.searchParams.get('order'), 'desc');
    assert.equal(url.searchParams.get('orderby'), 'date');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('WordPress post batches can fetch posts newer than the latest imported post', async () => {
  const originalFetch = globalThis.fetch;
  let requestedUrl = '';
  globalThis.fetch = async (url) => {
    requestedUrl = url.toString();
    return new Response(JSON.stringify([{ id: 102 }]), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  };

  try {
    const client = new WordPressClient({ baseUrl: 'https://example.com' });
    await client.fetchPosts({
      limit: 100,
      after: '2026-06-02T02:12:18.000Z',
      order: 'asc'
    });
    const url = new URL(requestedUrl);
    assert.equal(url.searchParams.get('after'), '2026-06-02T02:12:18.000Z');
    assert.equal(url.searchParams.get('order'), 'asc');
    assert.equal(url.searchParams.get('orderby'), 'date');
    assert.equal(url.searchParams.has('before'), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
