import { cp, mkdir, rm, writeFile, access } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const repo = path.resolve(root, '..');
const stage = path.join(root, 'engine-runtime');

await rm(stage, { recursive: true, force: true });
await mkdir(stage, { recursive: true });
await cp(path.join(repo, 'lib'), path.join(stage, 'lib'), { recursive: true });
await cp(path.join(repo, 'src/profile.js'), path.join(stage, 'src/profile.js'));
await cp(path.join(repo, 'src/utils'), path.join(stage, 'src/utils'), { recursive: true });
await mkdir(path.join(stage, 'bin'), { recursive: true });
await cp(path.join(repo, 'bin/qms-host.js'), path.join(stage, 'bin/qms-host.js'));
await writeFile(path.join(stage, 'package.json'), JSON.stringify({
  name: 'qortal-migration-studio-engine',
  version: '0.5.0',
  private: true,
  type: 'module',
  dependencies: {
    cheerio: '^1.0.0',
    dotenv: '^16.4.7'
  }
}, null, 2) + '\n');

execFileSync('npm', ['install', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], {
  cwd: stage,
  stdio: 'inherit'
});

for (const required of ['lib/engine/index.js', 'bin/qms-host.js', 'node_modules/cheerio/package.json']) {
  await access(path.join(stage, required));
}
console.log('engine runtime prepared at ' + stage);

