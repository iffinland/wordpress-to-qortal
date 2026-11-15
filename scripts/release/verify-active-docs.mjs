#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { evaluateActiveDocs } from './docs-consistency.mjs';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const read = async (file) => readFile(path.join(root, file), 'utf8').catch(() => '');
const release = JSON.parse(await readFile(path.join(root, 'qms-release.json'), 'utf8'));
const manifest = JSON.parse(await readFile(path.join(root, 'release/release-manifest.json'), 'utf8').catch(() => 'null'));
const result = evaluateActiveDocs({
  release,
  changelog: await read('CHANGELOG.md'),
  readme: await read('README.md'),
  quickstart: await read('QUICKSTART.md'),
  manifest
});
if (!result.ok) {
  console.error('ACTIVE_DOCS_FAILED:');
  for (const error of result.errors) console.error(' - ' + error);
  process.exit(1);
}
console.log('active documentation is consistent with ' + release.releaseTag);
