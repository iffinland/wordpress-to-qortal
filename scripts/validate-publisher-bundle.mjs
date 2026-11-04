import { createHash } from 'node:crypto';
import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'viewer', 'dist-publisher');
const pkg = JSON.parse(await readFile(path.join(root, 'viewer', 'package.json'), 'utf8'));
const MAX_BYTES = 20 * 1024 * 1024;
const errors = [];
const files = [];

async function walk(directory, prefix = '') {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const absolute = path.join(directory, entry.name);
    const relative = prefix ? prefix + '/' + entry.name : entry.name;
    if (entry.isSymbolicLink()) {
      errors.push('Symbolic link is not allowed: ' + relative);
      continue;
    }
    if (entry.isDirectory()) {
      await walk(absolute, relative);
    } else if (entry.isFile()) {
      const bytes = await readFile(absolute);
      files.push({
        path: relative,
        bytes: bytes.length,
        sha256: 'sha256:' + createHash('sha256').update(bytes).digest('hex')
      });
    }
  }
}

try {
  const info = await stat(dist);
  if (!info.isDirectory()) errors.push('Publisher build output is not a directory.');
} catch {
  errors.push('Publisher build output is missing. Run npm run publisher:build first.');
}

if (errors.length === 0) {
  await walk(dist);
  const total = files.reduce((sum, file) => sum + file.bytes, 0);
  if (total > MAX_BYTES) errors.push('Publisher bundle exceeds ' + MAX_BYTES + ' bytes.');
  const index = files.find((file) => file.path === 'index.html');
  if (!index) errors.push('Publisher bundle must have index.html at its root.');
  if (!files.some((file) => file.path.startsWith('assets/') && file.path.endsWith('.js'))) {
    errors.push('Publisher bundle has no JavaScript asset.');
  }
  if (files.some((file) => file.path.endsWith('.map'))) errors.push('Publisher bundle must not include source maps.');
  if (index) {
    const html = await readFile(path.join(dist, 'index.html'), 'utf8');
    if (/(?:src|href)="\/(?!\/)/.test(html)) errors.push('Publisher index.html must use relative asset URLs.');
    if (!html.includes('./assets/')) errors.push('Publisher index.html does not load a relative asset bundle.');
    if (!/<title>[^<]*Migration Publisher[^<]*<\/title>/i.test(html)) errors.push('Publisher index.html has no Migration Publisher title.');
  }
  const js = await Promise.all(files.filter((file) => file.path.endsWith('.js')).map((file) => readFile(path.join(dist, file.path), 'utf8')));
  const joined = js.join('\n');
  for (const forbidden of ['developer iffi', 'Corbett Report', 'corbettreport', 'profiles/corbettreport']) {
    if (joined.includes(forbidden)) errors.push('Publisher bundle contains a hardcoded identity or profile: ' + forbidden);
  }
  if (/window\.(?:parent|top)\.qortalRequest/.test(joined)) {
    errors.push('Publisher bundle assumes a parent/top frame bridge.');
  }
  const manifest = {
    schema: 'qms-publisher-bundle@1',
    id: 'qortal-migration-publisher',
    version: pkg.version,
    files,
    bytes: total,
    checks: {
      rootIndex: Boolean(index),
      relativeAssets: Boolean(index),
      noProfileIdentity: true,
      noSourceMaps: true
    }
  };
  if (errors.length === 0) {
    await writeFile(path.join(dist, 'publisher-bundle.json'), JSON.stringify(manifest, null, 2) + '\n');
  }
}

if (errors.length > 0) {
  console.error('Publisher bundle validation failed:');
  for (const error of errors) console.error('- ' + error);
  process.exit(1);
}
console.log(JSON.stringify({ ok: true, version: pkg.version, files: files.length, bytes: files.reduce((sum, file) => sum + file.bytes, 0), dist }, null, 2));
