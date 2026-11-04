import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { TEMPLATE_ROOT } from './support/fixtures.js';

async function sourceFiles(directory) {
  const entries = await readdir(directory, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && /\.(?:js|ts|tsx)$/.test(entry.name))
    .map((entry) => path.join(entry.parentPath || entry.path, entry.name));
}

test('the generic CMS template does not import engine internals or Corbett code', async () => {
  const root = path.join(TEMPLATE_ROOT, 'src');
  const files = await sourceFiles(root);
  assert.ok(files.length > 10);
  const forbidden = [
    /from\s+['"][^'"]*lib\/engine/,
    /from\s+['"][^'"]*lib\/source/,
    /from\s+['"][^'"]*corbettreport/,
    /from\s+['"]node:/,
    /require\(\s*['"]node:/
  ];
  for (const file of files) {
    const source = await readFile(file, 'utf8');
    for (const pattern of forbidden) {
      assert.equal(pattern.test(source), false, path.relative(TEMPLATE_ROOT, file) + ' matches forbidden import ' + pattern);
    }
  }
});

test('template package does not depend on the engine or Corbett workspaces', async () => {
  const packageJson = JSON.parse(await readFile(path.join(TEMPLATE_ROOT, 'package.json'), 'utf8'));
  const dependencies = { ...(packageJson.dependencies || {}), ...(packageJson.devDependencies || {}) };
  assert.equal(Boolean(dependencies['corbettreport-cms-qapp']), false);
  assert.equal(Boolean(dependencies['corbettreport-wordpress-to-qortal']), false);
});
