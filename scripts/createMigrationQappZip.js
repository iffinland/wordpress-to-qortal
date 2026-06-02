import { mkdir, readFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const root = process.cwd();
const viewerDir = path.join(root, 'viewer');
const distDir = path.join(viewerDir, 'dist');
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
  const packageJson = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  const profileId = readProfileId(process.argv.slice(2));
  const profileSuffix = profileId === 'generic' ? '' : `-${profileId}`;
  const zipName = `wordpress-to-qortal-migration-app${profileSuffix}-v${packageJson.version}.zip`;

  run('npm', ['run', 'migration:build'], {
    cwd: root,
    env: { ...process.env, MIGRATION_PROFILE: profileId }
  });

  await mkdir(releaseDir, { recursive: true });
  await rm(path.join(releaseDir, zipName), { force: true });
  run('zip', ['-qr', path.join(releaseDir, zipName), '.'], { cwd: distDir });

  console.log('');
  console.log('Migration Q-App zip prepared:');
  console.log(path.join(releaseDir, zipName));
  console.log(`Profile: ${profileId}`);
  console.log('');
  console.log('Publish this small zip in Qortal as APP or WEBSITE.');
  console.log('Inside the app, open Publish to QDN and select your local wp-qortal-import folder.');
}

main().catch((error) => {
  console.error('');
  console.error('Failed to prepare migration Q-App zip');
  console.error(error.message);
  process.exitCode = 1;
});
