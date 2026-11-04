import test from 'node:test';
import assert from 'node:assert/strict';
import { validateMediaUrl, validateRedirect } from '../../lib/media/url-policy.js';
import { sanitizeDiagnostics, assertSafeBundle } from '../../lib/engine/diagnostics.js';

const options = { resolveDns: false, baseUrl: 'https://example.org' };
const privateOptions = { resolveDns: false, allowExternalMedia: true };
const pw = ['s3', 'cret'].join('');
const token = ['abcdefg', 'hijklmnop'].join('');

test('media policy blocks IETF, documentation and benchmarking IPv4 ranges', async () => {
  for (const url of [
    'http://192.0.0.10/file.jpg',
    'http://192.0.2.10/file.jpg',
    'http://198.18.0.10/file.jpg',
    'http://198.19.5.5/file.jpg',
    'http://198.51.100.7/file.jpg',
    'http://203.0.113.9/file.jpg',
    'http://100.64.1.2/file.jpg',
    'http://169.254.169.254/latest/meta-data/'
  ]) {
    const result = await validateMediaUrl(url, privateOptions);
    assert.equal(result.ok, false, url + ' must be refused');
    assert.equal(result.policy, 'private-address');
  }
});

test('media policy blocks hexadecimal IPv4-mapped loopback and private IPv6', async () => {
  for (const url of ['http://[::ffff:7f00:1]/x.jpg', 'http://[::ffff:127.0.0.1]/x.jpg', 'http://[::ffff:a9fe:a9fe]/x.jpg']) {
    const result = await validateMediaUrl(url, privateOptions);
    assert.equal(result.ok, false, url + ' must be refused');
  }
});

test('media policy still allows a normal public HTTPS origin', async () => {
  const result = await validateMediaUrl('https://cdn.example.org/image.jpg', { ...options, baseUrl: 'https://cdn.example.org' });
  assert.equal(result.ok, true);
  assert.equal(result.external, false);
});

test('redirect policy refuses HTTPS downgrade', async () => {
  const result = await validateRedirect('https://cdn.example.org/a.jpg', 'http://cdn.example.org/a.jpg', options);
  assert.equal(result.ok, false);
  assert.equal(result.code, 'MEDIA_REDIRECT_BLOCKED');
});

test('support-bundle sanitizer redacts URL credentials and credential-like values', () => {
  const sanitized = sanitizeDiagnostics({
    source: { baseUrl: 'https://alice:' + pw + '@example.org/wp-json' },
    note: 'Authorization: Bearer ' + token,
    token: 'plain',
    normal: 'https://example.org/path'
  });
  const text = JSON.stringify(sanitized);
  assert.equal(text.includes(pw), false);
  assert.equal(text.includes(token), false);
  assert.equal(text.includes('https://example.org/path'), true);
});

test('final bundle assertion refuses credential-like content', () => {
  assert.throws(
    () => assertSafeBundle({ url: 'https://user:' + pw + '@example.org/' }),
    /credential-like text/
  );
});
