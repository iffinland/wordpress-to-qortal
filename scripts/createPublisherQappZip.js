#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipSync } from 'fflate';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'viewer', 'dist-publisher');
const release = path.join(root, 'release');
const pkg = JSON.parse(await readFile(path.join(root, 'viewer', 'package.json'), 'utf8'));

async function walk(directory, prefix = '', out = []) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    const relative = prefix ? prefix + '/' + entry.name : entry.name;
    if (entry.isSymbolicLink()) throw new Error('Refusing to package a symbolic link: ' + relative);
    if (entry.isDirectory()) await walk(absolute, relative, out);
    else if (entry.isFile()) out.push(relative);
  }
  return out;
}

try {
  await stat(path.join(dist, 'index.html'));
} catch {
  throw new Error('Publisher build is missing. Run npm run publisher:build first.');
}

const files = await walk(dist);
if (!files.includes('index.html')) throw new Error('Publisher bundle has no root index.html.');
if (files.some((file) => file.endsWith('.map'))) throw new Error('Publisher bundle contains source maps.');
const entries = {};
const mtime = new Date('1980-01-01T00:00:00.000Z');
for (const relative of files) {
  entries[relative] = [new Uint8Array(await readFile(path.join(dist, relative))), { level: 6, mtime }];
}
const zip = Buffer.from(zipSync(entries, { level: 6, mtime }));
await mkdir(release, { recursive: true });
const target = path.join(release, 'qortal-migration-publisher-v' + pkg.version + '.zip');
await writeFile(target, zip);
const sha256 = createHash('sha256').update(zip).digest('hex');
await writeFile(target + '.sha256', sha256 + '  ' + path.basename(target) + '\n');
console.log(JSON.stringify({ ok: true, version: pkg.version, zip: target, bytes: zip.length, sha256 }, null, 2));
