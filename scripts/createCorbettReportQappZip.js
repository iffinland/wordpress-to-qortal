import { mkdir, readFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const root = process.cwd();
const appDir = path.join(root, 'corbettreport');
const distDir = path.join(appDir, 'dist');
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
  const packageJson = JSON.parse(await readFile(path.join(appDir, 'package.json'), 'utf8'));
  const zipName = `corbettreport-qapp-v${packageJson.version}.zip`;

  run('npm', ['run', 'corbettreport:build'], { cwd: root });

  await mkdir(releaseDir, { recursive: true });
  await rm(path.join(releaseDir, zipName), { force: true });
  run('zip', ['-qr', path.join(releaseDir, zipName), '.', '-x', '*.zip'], { cwd: distDir });

  console.log('');
  console.log('Corbett Report Q-App zip prepared:');
  console.log(path.join(releaseDir, zipName));
}

main().catch((error) => {
  console.error('');
  console.error('Failed to prepare Corbett Report Q-App zip');
  console.error(error.message);
  process.exitCode = 1;
});
