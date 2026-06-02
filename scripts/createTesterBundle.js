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
  const bundleName = `wordpress-to-qortal-toolkit-v${version}`;
  const bundleDir = path.join(releaseDir, bundleName);
  const bundleZip = path.join(releaseDir, `${bundleName}.zip`);

  run('npm', ['run', 'package:zip'], { cwd: root });
  run('npm', ['run', 'package:migration-qapp'], { cwd: root });
  run('npm', ['run', 'package:cms-qapp'], { cwd: root });

  await rm(bundleDir, { recursive: true, force: true });
  await mkdir(path.join(bundleDir, 'apps'), { recursive: true });
  await mkdir(path.join(bundleDir, 'docs'), { recursive: true });

  await cp(
    path.join(releaseDir, `wordpress-to-qortal-migrator-v${version}.zip`),
    path.join(bundleDir, `wordpress-to-qortal-migrator-v${version}.zip`)
  );
  await cp(
    path.join(releaseDir, `wordpress-to-qortal-migration-app-v${version}.zip`),
    path.join(bundleDir, 'apps', `wordpress-to-qortal-migration-app-v${version}.zip`)
  );
  await cp(
    path.join(releaseDir, `qortal-cms-app-v${version}.zip`),
    path.join(bundleDir, 'apps', `qortal-cms-app-v${version}.zip`)
  );
  await cp(path.join(root, 'TESTER_GUIDE.md'), path.join(bundleDir, 'START_HERE.md'));
  await cp(path.join(root, 'QUICKSTART.md'), path.join(bundleDir, 'docs', 'IMPORTER_QUICKSTART.md'));
  await cp(path.join(root, 'docs', 'PROFILES.md'), path.join(bundleDir, 'docs', 'MIGRATION_PROFILES.md'));
  await cp(path.join(root, 'docs', 'QDN_RESOURCE_STRATEGY.md'), path.join(bundleDir, 'docs', 'QDN_RESOURCE_STRATEGY.md'));
  await cp(path.join(root, 'qortal-cms', 'README.md'), path.join(bundleDir, 'docs', 'QORTAL_CMS.md'));

  await writeFile(
    path.join(bundleDir, 'VERSION.txt'),
    `WordPress to Qortal Toolkit ${version}\n`
  );

  await rm(bundleZip, { force: true });
  run('zip', ['-qr', path.basename(bundleZip), bundleName], { cwd: releaseDir });

  console.log('');
  console.log('Tester bundle prepared:');
  console.log(bundleZip);
  console.log('');
  console.log('Share this ZIP with testers. They should open START_HERE.md first.');
}

main().catch((error) => {
  console.error('');
  console.error('Failed to prepare tester bundle');
  console.error(error.message);
  process.exitCode = 1;
});
