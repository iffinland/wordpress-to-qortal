import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createSanitizer, sanitizeUrl } from '../../templates/generic-cms/src/lib/sanitize.js';
import { rewriteMediaUrls } from '../../templates/generic-cms/src/lib/media.js';

const dom = new JSDOM('<!doctype html><html><body></body></html>');
const sanitizer = createSanitizer(dom.window);

function clean(value) {
  return sanitizer.sanitize(value);
}

test('script tags and event handlers are removed', () => {
  const output = clean('<p>Safe</p><script>alert(1)</script><div onclick="alert(2)">Text</div><img src="x" onerror="alert(3)">');
  assert.equal(output.includes('<script'), false);
  assert.equal(output.includes('onclick'), false);
  assert.equal(output.includes('onerror'), false);
  assert.match(output, /<p>Safe<\/p>/);
  assert.match(output, /<img src="x"/);
});

test('dangerous URL schemes are removed from links and media', () => {
  const output = clean('<a href="javascript:alert(1)">bad</a><a href="data:text/html;base64,PHNjcmlwdD4=">data</a><a href="vbscript:msgbox(1)">vb</a><img src="javascript:alert(4)">');
  assert.equal(/href="javascript:/i.test(output), false);
  assert.equal(/href="data:/i.test(output), false);
  assert.equal(/href="vbscript:/i.test(output), false);
  assert.equal(output.includes('<img'), false);
  assert.match(output, /bad/);
});

test('whitespace and control-character scheme obfuscation is blocked', () => {
  const output = clean('<a href="java&#x0A;script:alert(1)">newline</a><a href="  javascript:alert(2)">spaces</a>');
  assert.equal(/javascript:/i.test(output), false);
  assert.match(output, /newline/);
  assert.match(output, /spaces/);
});

test('embedded, form and style attack surfaces are removed', () => {
  const output = clean('<iframe src="https://example.org"></iframe><svg onload="alert(1)"><circle /></svg><form action="https://evil.example"><input name="x"></form><div style="background:url(javascript:alert(1))">styled</div>');
  assert.equal(output.includes('<iframe'), false);
  assert.equal(output.includes('<svg'), false);
  assert.equal(output.includes('<form'), false);
  assert.equal(output.includes('<input'), false);
  assert.equal(output.includes('style='), false);
  assert.match(output, /styled/);
});

test('valid content and relative QDN URLs are preserved', () => {
  const output = clean('<h2>Heading</h2><p>Text with <a href="#/pages/about">internal</a> and <a href="/arbitrary/DOCUMENT/QortalDemo/posts">QDN</a>.</p><ul><li>One</li></ul><img src="/arbitrary/IMAGE/QortalDemo/hero" alt="Hero">');
  assert.match(output, /<h2>Heading<\/h2>/);
  assert.match(output, /href="#\/pages\/about"/);
  assert.match(output, /href="\/arbitrary\/DOCUMENT\/QortalDemo\/posts"/);
  assert.match(output, /alt="Hero"/);
  assert.match(output, /loading="lazy"/);
  assert.match(output, /decoding="async"/);
});

test('external links receive safe rel attributes', () => {
  const output = clean('<a href="https://example.org/out">outside</a>');
  assert.match(output, /rel="[^"]*noopener[^"]*"/);
  assert.match(output, /rel="[^"]*noreferrer[^"]*"/);
});

test('sanitizeUrl enforces the scheme policy', () => {
  assert.equal(sanitizeUrl('https://example.org/a'), 'https://example.org/a');
  assert.equal(sanitizeUrl('http://example.org/a'), 'http://example.org/a');
  assert.equal(sanitizeUrl('mailto:editor@example.org'), 'mailto:editor@example.org');
  assert.equal(sanitizeUrl('tel:+123456'), 'tel:+123456');
  assert.equal(sanitizeUrl('/arbitrary/DOCUMENT/Name/id'), '/arbitrary/DOCUMENT/Name/id');
  assert.equal(sanitizeUrl('#/posts/hello'), '#/posts/hello');
  assert.equal(sanitizeUrl('javascript:alert(1)'), '');
  assert.equal(sanitizeUrl('jav\tascript:alert(1)'), '');
  assert.equal(sanitizeUrl('data:text/html,<script>alert(1)</script>'), '');
  assert.equal(sanitizeUrl('file:///etc/passwd'), '');
  assert.equal(sanitizeUrl('https://'), '');
});

test('media URLs are rewritten to QDN references before rendering', () => {
  const originalParser = globalThis.DOMParser;
  globalThis.DOMParser = dom.window.DOMParser;
  try {
    const html = '<p><img src="/wp-content/uploads/featured.jpg" alt="Featured"><a href="https://example.org/out">outside</a></p>';
    const rewritten = rewriteMediaUrls(html, {
      bySourceUrl: {
        'https://corbett.example/wp-content/uploads/featured.jpg': { service: 'IMAGE', name: 'Corbett', identifier: 'cr-media-301' }
      },
      createUrl: (service, name, identifier) => 'https://qdn.example/' + service + '/' + name + '/' + identifier
    });
    assert.match(rewritten, /src="https:\/\/qdn.example\/IMAGE\/Corbett\/cr-media-301"/);
    assert.match(rewritten, /href="https:\/\/example.org\/out"/);
    const output = clean(rewritten);
    assert.match(output, /cr-media-301/);
  } finally {
    globalThis.DOMParser = originalParser;
  }
});
