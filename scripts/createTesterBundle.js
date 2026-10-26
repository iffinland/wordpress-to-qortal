import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const root = process.cwd();
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
  const packageJson = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  const version = packageJson.version;
  const packageZipName = `corbettreport-wordpress-to-qortal-v${version}.zip`;
  const bundleName = `corbettreport-wordpress-to-qortal-release-v${version}`;
  const bundleDir = path.join(releaseDir, bundleName);
  const bundleZip = path.join(releaseDir, `${bundleName}.zip`);

  run('npm', ['run', 'package:zip'], { cwd: root });
  run('npm', ['run', 'package:migration-qapp'], { cwd: root });
  run('npm', ['run', 'package:cms-qapp'], { cwd: root });

  await rm(bundleDir, { recursive: true, force: true });
  await mkdir(path.join(bundleDir, 'apps'), { recursive: true });
  await mkdir(path.join(bundleDir, 'docs'), { recursive: true });

  await cp(
    path.join(releaseDir, packageZipName),
    path.join(bundleDir, packageZipName)
  );
  await cp(
    path.join(releaseDir, `wordpress-to-qortal-migration-app-corbettreport-v${version}.zip`),
    path.join(bundleDir, 'apps', `wordpress-to-qortal-migration-app-corbettreport-v${version}.zip`)
  );
  await cp(
    path.join(releaseDir, `corbettreport-website-cms-app-v${version}.zip`),
    path.join(bundleDir, 'apps', `corbettreport-website-cms-app-v${version}.zip`)
  );
  await cp(path.join(root, 'QUICKSTART.md'), path.join(bundleDir, 'START_HERE.md'));
  await cp(path.join(root, 'docs', 'ZORIN_LINUX_SETUP.md'), path.join(bundleDir, 'docs', 'ZORIN_LINUX_SETUP.md'));
  await cp(path.join(root, 'docs', 'CORBETT_MIGRATION_RUNBOOK.md'), path.join(bundleDir, 'docs', 'CORBETT_MIGRATION_RUNBOOK.md'));
  await cp(path.join(root, 'docs', 'QDN_RESOURCE_STRATEGY.md'), path.join(bundleDir, 'docs', 'QDN_RESOURCE_STRATEGY.md'));

  await writeFile(
    path.join(bundleDir, 'VERSION.txt'),
    `The Corbett Report WordPress to Qortal toolkit ${version}\n`
  );

  await rm(bundleZip, { force: true });
  run('zip', ['-qr', path.basename(bundleZip), bundleName], { cwd: releaseDir });

  console.log('');
  console.log('Corbett Report release bundle prepared:');
  console.log(bundleZip);
  console.log('');
  console.log('The recipient should open START_HERE.md first.');
}

main().catch((error) => {
  console.error('');
  console.error('Failed to prepare release bundle');
  console.error(error.message);
  process.exitCode = 1;
});
