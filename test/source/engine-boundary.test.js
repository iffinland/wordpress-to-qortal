import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');

async function sourceFiles(directory) {
  const entries = await readdir(directory, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.js'))
    .map((entry) => path.join(entry.parentPath ?? entry.path, entry.name));
}

test('engine and model modules do not import WordPress-specific fields', async () => {
  const files = [
    ...(await sourceFiles(path.join(REPO_ROOT, 'lib', 'engine'))),
    ...(await sourceFiles(path.join(REPO_ROOT, 'lib', 'model')))
  ];
  assert.ok(files.length > 10);
  for (const file of files) {
    const source = await readFile(file, 'utf8');
    const relative = path.relative(REPO_ROOT, file);
    assert.equal(/source\/wordpress/.test(source), false, `${relative} imports WordPress adapter internals`);
    assert.equal(/extra\.wordpress/.test(source), false, `${relative} reads WordPress-specific fields`);
  }
});
