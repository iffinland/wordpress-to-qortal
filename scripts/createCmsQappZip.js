import { mkdir, readFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const root = process.cwd();
const releaseDir = path.join(root, 'release');

function readProfileId(argv) {
  const inline = argv.find((arg) => arg.startsWith('--profile='));
  return inline ? inline.slice('--profile='.length) : 'generic';
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    ...options
  });

  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed.`);
  }
}

async function main() {
  const rootPackageJson = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  const profileId = readProfileId(process.argv.slice(2));
  const isCorbettReport = profileId === 'corbettreport';
  const appDir = path.join(root, isCorbettReport ? 'corbettreport' : 'qortal-cms');
  const distDir = path.join(appDir, 'dist');
  const packageJson = JSON.parse(await readFile(path.join(appDir, 'package.json'), 'utf8'));
  const profileSuffix = profileId === 'generic' ? '' : `-${profileId}`;
  const version = isCorbettReport ? rootPackageJson.version : packageJson.version;
  const zipName = `qortal-cms-app${profileSuffix}-v${version}.zip`;

  run('npm', ['run', isCorbettReport ? 'corbettreport:build' : 'cms:build'], {
    cwd: root,
    env: { ...process.env, MIGRATION_PROFILE: profileId }
  });

  await mkdir(releaseDir, { recursive: true });
  await rm(path.join(releaseDir, zipName), { force: true });
  run('zip', ['-qr', path.join(releaseDir, zipName), '.', '-x', '*.zip'], { cwd: distDir });

  console.log('');
  console.log('Qortal CMS Q-App zip prepared:');
  console.log(path.join(releaseDir, zipName));
  console.log(`Profile: ${profileId}`);
}

main().catch((error) => {
  console.error('');
  console.error('Failed to prepare Qortal CMS Q-App zip');
  console.error(error.message);
  process.exitCode = 1;
});
