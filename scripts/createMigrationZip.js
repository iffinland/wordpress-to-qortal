import { readFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const root = process.cwd();
const releaseRoot = path.join(root, 'release');
const packageName = 'corbettreport-wordpress-to-qortal';

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
  const zipName = `${packageName}-v${packageJson.version}.zip`;

  run('node', ['scripts/createMigrationPackage.js'], { cwd: root });

  await rm(path.join(releaseRoot, zipName), { force: true });
  run('zip', ['-qr', zipName, packageName], { cwd: releaseRoot });

  console.log('');
  console.log('Migration zip prepared:');
  console.log(path.join(releaseRoot, zipName));
}

main().catch((error) => {
  console.error('');
  console.error('Failed to prepare migration zip');
  console.error(error.message);
  process.exitCode = 1;
});
