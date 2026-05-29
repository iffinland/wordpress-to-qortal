import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const releaseRoot = path.join(root, 'release');
const packageDir = path.join(releaseRoot, 'wordpress-to-qortal-migrator');

const pathsToCopy = [
  '.env.example',
  'README.md',
  'QUICKSTART.md',
  'ROADMAP.md',
  'package.json',
  'package-lock.json',
  'scripts',
  'src',
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
      return !parts.includes('node_modules')
        && !parts.includes('dist')
        && !normalized.endsWith('/.env')
        && !normalized.endsWith('/wp-qortal-import')
        && !parts.includes('qortal-cms');
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

  await writeFile(
    path.join(packageDir, 'VERSION.txt'),
    `wordpress-to-qortal-migrator ${version}\n`
  );

  await writeFile(
    path.join(releaseRoot, 'README.txt'),
    [
      `WordPress to Qortal Migrator package v${version}`,
      '',
      'Open QUICKSTART.md first.',
      'Run npm install before using the tool.',
      'Do not copy real .env files or imported site data into public repositories.',
      ''
    ].join('\n')
  );

  console.log('');
  console.log('Migration package prepared:');
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
