import { spawn } from 'node:child_process';
import { build } from 'esbuild';
import { createServer } from 'vite';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const common = {
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  external: ['electron'],
  sourcemap: true
};

async function compile() {
  await build({ ...common, entryPoints: [path.join(root, 'src/main/index.ts')], outfile: path.join(root, 'dist-electron/main.cjs') });
  await build({ ...common, entryPoints: [path.join(root, 'src/preload/index.ts')], outfile: path.join(root, 'dist-electron/preload.cjs') });
}

await compile();
const server = await createServer({ configFile: path.join(root, 'vite.config.ts') });
await server.listen();
const url = server.resolvedUrls.local[0];
const child = spawn(path.join(root, 'node_modules/.bin/electron'), ['.', '--dev-server=' + url], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, QMS_DEV_SERVER: url }
});
child.on('exit', async (code) => {
  await server.close();
  process.exit(code ?? 0);
});

