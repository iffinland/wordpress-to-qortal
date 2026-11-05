import test from 'node:test';
import assert from 'node:assert/strict';
import { MediaDownloader } from '../../lib/media/downloader.js';

function downloader(fetchImpl) {
  return new MediaDownloader({
    fetchImpl,
    mediaSettings: {
      timeoutMs: 2000,
      maxRedirects: 3,
      allowExternalMedia: true,
      allowLoopback: false
    },
    baseUrl: 'https://example.com'
  });
}

test('a HEAD 405 falls back to a one-byte ranged GET and recovers the total size', async () => {
  const calls = [];
  const fetchImpl = async (_url, options) => {
    calls.push(options.method);
    if (options.method === 'HEAD') {
      return new Response(null, { status: 405 });
    }
    return new Response('x', {
      status: 206,
      headers: { 'content-range': 'bytes 0-0/123456', 'content-type': 'image/jpeg' }
    });
  };
  const result = await downloader(fetchImpl).estimate('https://example.com/photo.jpg');
  assert.equal(result.status, 'known');
  assert.equal(result.bytes, 123456);
  assert.equal(result.contentType, 'image/jpeg');
  assert.equal(result.recoveredFrom, 'head-unsupported');
  assert.deepEqual(calls, ['HEAD', 'GET']);
});

test('a HEAD response without Content-Length also recovers the size', async () => {
  const fetchImpl = async (_url, options) => {
    if (options.method === 'HEAD') {
      return new Response(null, { status: 200, headers: { 'content-type': 'image/png' } });
    }
    return new Response('x', {
      status: 206,
      headers: { 'content-range': 'bytes 0-0/4096', 'content-type': 'image/png' }
    });
  };
  const result = await downloader(fetchImpl).estimate('https://example.com/picture.png');
  assert.equal(result.status, 'known');
  assert.equal(result.bytes, 4096);
  assert.equal(result.recoveredFrom, 'no-content-length');
});

test('an unknown size stays explicitly unknown and is never reported as zero', async () => {
  const fetchImpl = async () => new Response(null, { status: 405 });
  const result = await downloader(fetchImpl).estimate('https://example.com/unknown.jpg');
  assert.equal(result.status, 'unknown');
  assert.equal(result.bytes, undefined);
  assert.equal(result.reason, 'head-unsupported');
});
