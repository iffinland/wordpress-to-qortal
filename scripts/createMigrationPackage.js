import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const releaseRoot = path.join(root, 'release');
const packageDir = path.join(releaseRoot, 'corbettreport-wordpress-to-qortal');

const pathsToCopy = [
  '.env.example',
  'README.md',
  'QUICKSTART.md',
  'package.json',
  'package-lock.json',
  'scripts',
  'src',
  'profiles/corbettreport',
  'viewer',
  'fixtures',
  'docs'
];

async function copyPath(relativePath) {
  await cp(path.join(root, relativePath), path.join(packageDir, relativePath), {
    recursive: true,
    filter(source) {
      const normalized = source.split(path.sep).join('/');
      const parts = normalized.split('/');
      const fileName = path.basename(normalized);
      return !parts.includes('node_modules')
        && !parts.includes('dist')
        && !parts.includes('workspaces')
        && !normalized.endsWith('/.env')
        && !normalized.endsWith('/wp-qortal-import')
        && !normalized.endsWith('/docs/PROJECT_REPORT.md')
        && ![
          'createCmsQappZip.js',
          'createMigrationPackage.js',
          'createMigrationZip.js',
          'createTesterBundle.js'
        ].includes(fileName);
    }
  });
}

async function main() {
  const packageJson = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  const version = packageJson.version;

  await rm(packageDir, { recursive: true, force: true });
  await mkdir(packageDir, { recursive: true });

  for (const relativePath of pathsToCopy) {
    await copyPath(relativePath);
  }

  const releasePackageJsonPath = path.join(packageDir, 'package.json');
  const releasePackageJson = JSON.parse(await readFile(releasePackageJsonPath, 'utf8'));
  for (const scriptName of [
    'cms:dev',
    'cms:build',
    'cms:preview',
    'migration:build',
    'migration:preview',
    'package:source',
    'package:zip',
    'package:migration-qapp',
    'package:cms-qapp',
    'package:tester-bundle',
    'package:release',
    'check'
  ]) {
    delete releasePackageJson.scripts[scriptName];
  }
  await writeFile(releasePackageJsonPath, `${JSON.stringify(releasePackageJson, null, 2)}\n`);

  await writeFile(
    path.join(packageDir, 'VERSION.txt'),
    `The Corbett Report WordPress to Qortal toolkit ${version}\n`
  );

  await writeFile(
    path.join(releaseRoot, 'README.txt'),
    [
      `The Corbett Report WordPress to Qortal toolkit v${version}`,
      '',
      'Open QUICKSTART.md first.',
      'Then open docs/ZORIN_LINUX_SETUP.md for the detailed Linux walkthrough.',
      'Do not share your .env file or imported WordPress data.',
      ''
    ].join('\n')
  );

  console.log('');
  console.log('Corbett Report migration package prepared:');
  console.log(packageDir);
  console.log('');
  console.log('Open QUICKSTART.md inside that folder for user instructions.');
}

main().catch((error) => {
  console.error('');
  console.error('Failed to prepare migration package');
  console.error(error.message);
  process.exitCode = 1;
});
