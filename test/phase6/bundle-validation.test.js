import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { validateBundle } from '../../templates/generic-cms/scripts/validate-bundle.mjs';
import { TEMPLATE_ROOT } from './support/fixtures.js';

function makeBundle(indexHtml, script) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'qms-bundle-'));
  mkdirSync(path.join(root, 'assets'), { recursive: true });
  writeFileSync(path.join(root, 'index.html'), indexHtml);
  if (script) writeFileSync(path.join(root, 'assets', 'app.js'), script);
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test('a valid root-layout bundle passes validation', () => {
  const bundle = makeBundle('<!doctype html><html><body><div id="root"></div><script src="./assets/app.js"></script></body></html>', 'console.log("ok");');
  try {
    const result = validateBundle(bundle.root);
    assert.equal(result.ok, true);
    assert.deepEqual(result.errors, []);
  } finally {
    bundle.cleanup();
  }
});

test('absolute asset paths and engine markers fail validation', () => {
  const absolute = makeBundle('<!doctype html><html><body><div id="root"></div><script src="/assets/app.js"></script></body></html>', 'console.log("ok");');
  try {
    const result = validateBundle(absolute.root);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((error) => error.includes('absolute asset path')));
  } finally {
    absolute.cleanup();
  }
  const marker = makeBundle('<!doctype html><html><body><div id="root"></div><script src="./assets/app.js"></script></body></html>', 'import "../lib/engine/index.js";');
  try {
    const result = validateBundle(marker.root);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((error) => error.includes('forbidden engine marker')));
  } finally {
    marker.cleanup();
  }
});

test('the built generic CMS bundle passes validation', { skip: !existsSync(path.join(TEMPLATE_ROOT, 'dist', 'index.html')) }, () => {
  const result = validateBundle(path.join(TEMPLATE_ROOT, 'dist'));
  assert.equal(result.ok, true);
  assert.ok(result.checks.some((check) => check.includes('no engine internals')));
});
