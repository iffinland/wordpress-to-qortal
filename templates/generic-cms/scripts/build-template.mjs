import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipSync } from 'fflate';
import { validateCmsConfig } from '../src/lib/config.js';
import { validateBundle } from './validate-bundle.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const templateRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(templateRoot, '..', '..');
const packageJson = JSON.parse(readFileSync(path.join(templateRoot, 'package.json'), 'utf8'));

function argument(name, fallback) {
  const prefix = '--' + name + '=';
  const inline = process.argv.find((value) => value.startsWith(prefix));
  return inline ? inline.slice(prefix.length) : fallback;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: templateRoot, stdio: 'inherit', ...options });
  if (result.status !== 0) throw new Error(command + ' ' + args.join(' ') + ' failed with status ' + result.status);
}

const configPath = path.resolve(argument('config', process.env.CMS_TEMPLATE_CONFIG || path.join(templateRoot, 'cms.config.json')));
const config = JSON.parse(readFileSync(configPath, 'utf8'));
const validation = validateCmsConfig(config);
if (!validation.ok) {
  console.error('Invalid CMS template configuration:');
  for (const error of validation.errors) console.error('- ' + error);
  process.exit(1);
}
console.log('Validated template configuration: ' + configPath);

const env = { ...process.env, CMS_TEMPLATE_CONFIG: configPath };
const bin = (name) => path.join(templateRoot, 'node_modules', '.bin', name);
run(bin('tsc'), ['--noEmit'], { env });
run(bin('vite'), ['build'], { env });

const distDir = path.join(templateRoot, 'dist');
const bundle = validateBundle(distDir);
if (!bundle.ok) {
  console.error('Validated Q-App bundle failed:');
  for (const error of bundle.errors) console.error('- ' + error);
  process.exit(1);
}
console.log('Validated root-layout Q-App bundle: ' + distDir);

if (process.argv.includes('--zip')) {
  const releaseDir = path.join(repoRoot, 'release');
  mkdirSync(releaseDir, { recursive: true });
  const zipPath = path.join(releaseDir, 'qms-generic-cms-template-v' + packageJson.version + '.zip');
  rmSync(zipPath, { force: true });
  const entries = {};
  for (const entry of readdirSync(distDir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const absolute = path.join(entry.parentPath || entry.path, entry.name);
    const relative = path.relative(distDir, absolute).split(path.sep).join('/');
    entries[relative] = new Uint8Array(readFileSync(absolute));
  }
  writeFileSync(zipPath, zipSync(entries, { level: 6 }));
  console.log('Q-App zip: ' + zipPath);
}

console.log(JSON.stringify({
  ok: true,
  config: configPath,
  dist: distDir,
  files: bundle.files,
  bytes: bundle.bytes,
  checks: bundle.checks
}, null, 2));
