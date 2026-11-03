import { readFile, access, readdir, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const repo = path.resolve(root, '..');
const failures = [];

async function exists(target) {
  try { await access(target); return true; } catch { return false; }
}

const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
if (pkg.name !== 'qortal-migration-studio') failures.push('desktop package name must be qortal-migration-studio');
if (pkg.productName !== 'Qortal Migration Studio') failures.push('productName mismatch');
if (pkg.main !== 'dist-electron/main.cjs') failures.push('main entry mismatch');

const builder = await readFile(path.join(root, 'electron-builder.yml'), 'utf8');
for (const needle of ['appId: org.iffinland.qortal-migration-studio', 'target:', 'deb:', 'extraResources:', 'build/icons']) {
  if (!builder.includes(needle)) failures.push('electron-builder.yml missing ' + needle);
}

for (const size of ['16x16', '32x32', '48x48', '64x64', '128x128', '256x256', '512x512']) {
  if (!(await exists(path.join(root, 'build/icons', size + '.png')))) failures.push('missing icon ' + size);
}

for (const required of ['dist/index.html', 'dist-electron/main.cjs', 'dist-electron/preload.cjs']) {
  if (!(await exists(path.join(root, required)))) failures.push('missing build output ' + required);
}

const engineStage = path.join(root, 'engine-runtime');
if (await exists(engineStage)) {
  for (const required of ['lib/engine/index.js', 'bin/qms-host.js', 'node_modules/cheerio/package.json']) {
    if (!(await exists(path.join(engineStage, required)))) failures.push('engine runtime missing ' + required);
  }
  for (const forbidden of ['profiles', 'fixtures', '.env', 'corbettreport', 'test']) {
    if (await exists(path.join(engineStage, forbidden))) failures.push('engine runtime contains forbidden path ' + forbidden);
  }
} else {
  failures.push('engine runtime is not prepared');
}

const releaseDir = path.join(root, 'release');
let artifacts = [];
try {
  artifacts = (await readdir(releaseDir)).filter((name) => name.endsWith('.deb'));
} catch {}
for (const artifact of artifacts) {
  const file = path.join(releaseDir, artifact);
  const info = await stat(file);
  const hash = createHash('sha256').update(await readFile(file)).digest('hex');
  console.log('artifact ' + artifact + ' bytes=' + info.size + ' sha256=' + hash);
}

if (failures.length > 0) {
  console.error('package verification failed:');
  for (const failure of failures) console.error(' - ' + failure);
  process.exit(1);
}
console.log('package verification passed');

