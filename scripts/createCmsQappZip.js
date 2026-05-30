import { mkdir, readFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const root = process.cwd();
const cmsDir = path.join(root, 'qortal-cms');
const distDir = path.join(cmsDir, 'dist');
const releaseDir = path.join(root, 'release');

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
  const packageJson = JSON.parse(await readFile(path.join(cmsDir, 'package.json'), 'utf8'));
  const zipName = `qortal-cms-app-v${packageJson.version}.zip`;

  run('npm', ['run', 'cms:build'], { cwd: root });

  await mkdir(releaseDir, { recursive: true });
  await rm(path.join(releaseDir, zipName), { force: true });
  run('zip', ['-qr', path.join(releaseDir, zipName), '.', '-x', '*.zip'], { cwd: distDir });

  console.log('');
  console.log('Qortal CMS Q-App zip prepared:');
  console.log(path.join(releaseDir, zipName));
}

main().catch((error) => {
  console.error('');
  console.error('Failed to prepare Qortal CMS Q-App zip');
  console.error(error.message);
  process.exitCode = 1;
});
