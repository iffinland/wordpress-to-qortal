import { cp, mkdir, readFile, readdir, rm, stat, unlink, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const repo = path.resolve(root, '..');
const stage = path.join(root, 'engine-runtime');
const templateRoot = path.join(repo, 'templates/generic-cms');
const templateStage = path.join(stage, 'templates/generic-cms');

const desktopPackage = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const version = desktopPackage.version;

async function exists(target) {
  try { await stat(target); return true; } catch { return false; }
}

async function hashTree(directory, prefix = '') {
  const entries = [];
  async function walk(current, relative) {
    const children = await readdir(current, { withFileTypes: true });
    for (const child of children.sort((a, b) => a.name.localeCompare(b.name))) {
      const absolute = path.join(current, child.name);
      const rel = relative ? relative + '/' + child.name : child.name;
      if (child.isDirectory()) {
        await walk(absolute, rel);
      } else if (child.isFile()) {
        const body = await readFile(absolute);
        entries.push({
          path: prefix + rel,
          bytes: body.length,
          sha256: createHash('sha256').update(body).digest('hex')
        });
      }
    }
  }
  await walk(directory, '');
  entries.sort((a, b) => a.path.localeCompare(b.path));
  return entries;
}

await rm(stage, { recursive: true, force: true });
await mkdir(stage, { recursive: true });

await cp(path.join(repo, 'lib'), path.join(stage, 'lib'), { recursive: true });
await cp(path.join(repo, 'src/profile.js'), path.join(stage, 'src/profile.js'));
await cp(path.join(repo, 'src/utils'), path.join(stage, 'src/utils'), { recursive: true });
await mkdir(path.join(stage, 'bin'), { recursive: true });
await cp(path.join(repo, 'bin/qms-host.js'), path.join(stage, 'bin/qms-host.js'));

await cp(path.join(root, 'engine-package/package.json'), path.join(stage, 'package.json'));
await cp(path.join(root, 'engine-package/package-lock.json'), path.join(stage, 'package-lock.json'));

const templateDist = path.join(templateRoot, 'dist');
if (!(await exists(path.join(templateDist, 'index.html')))) {
  throw new Error('generic CMS template is not built; run npm --prefix templates/generic-cms run build first.');
}
await mkdir(templateStage, { recursive: true });
await cp(templateDist, path.join(templateStage, 'dist'), { recursive: true });
await cp(path.join(templateRoot, 'cms.config.json'), path.join(templateStage, 'cms.config.json'));
await cp(path.join(templateRoot, 'README.md'), path.join(templateStage, 'README.md'));
const templatePackage = JSON.parse(await readFile(path.join(templateRoot, 'package.json'), 'utf8'));
const templateFiles = await hashTree(templateStage);
await writeFile(path.join(templateStage, 'template.json'), JSON.stringify({
  schema: 'qms-bundled-template@1',
  id: 'generic-cms',
  name: 'QMS Generic CMS',
  version: templatePackage.version,
  source: 'templates/generic-cms',
  files: templateFiles,
  bytes: templateFiles.reduce((total, entry) => total + entry.bytes, 0)
}, null, 2) + '\n');

execFileSync('npm', ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], {
  cwd: stage,
  stdio: 'inherit'
});

async function removePackagingNoise(directory) {
  const children = await readdir(directory, { withFileTypes: true });
  for (const child of children) {
    const absolute = path.join(directory, child.name);
    if (child.isDirectory()) {
      if (child.name === '.bin') {
        await rm(absolute, { recursive: true, force: true });
      } else {
        await removePackagingNoise(absolute);
      }
    } else if (child.isFile() && (
      child.name.endsWith('.map') ||
      child.name.startsWith('.') ||
      /^(README|CHANGELOG|CHANGES|HISTORY|SECURITY)([-_][A-Za-z0-9._-]*)?\.(md|markdown|txt|rst)$/i.test(child.name) ||
      /^(README|CHANGELOG|CHANGES|HISTORY|SECURITY)$/i.test(child.name)
    )) {
      await unlink(absolute);
    }
  }
}
await removePackagingNoise(stage);

for (const required of [
  'lib/engine/index.js',
  'lib/engine/history.js',
  'lib/engine/cleanup.js',
  'bin/qms-host.js',
  'node_modules/cheerio/package.json',
  'node_modules/dotenv/package.json',
  'templates/generic-cms/dist/index.html'
]) {
  if (!(await exists(path.join(stage, required)))) {
    throw new Error('engine runtime is missing ' + required);
  }
}

const engineFiles = await hashTree(stage);
const manifest = {
  schema: 'qms-engine-runtime@1',
  version,
  engineVersion: version,
  template: {
    id: 'generic-cms',
    version: templatePackage.version
  },
  files: engineFiles,
  bytes: engineFiles.reduce((total, entry) => total + entry.bytes, 0)
};
await writeFile(path.join(stage, 'engine-runtime.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log('engine runtime prepared at ' + stage + ' (' + engineFiles.length + ' files, ' + manifest.bytes + ' bytes)');
