import { build } from 'esbuild';
import { build as viteBuild } from 'vite';
import { rm } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const outDir = path.join(root, 'dist-electron');

await rm(path.join(root, 'dist'), { recursive: true, force: true });
await rm(outDir, { recursive: true, force: true });

const common = {
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  external: ['electron'],
  sourcemap: false,
  logLevel: 'info'
};

await build({
  ...common,
  entryPoints: [path.join(root, 'src/main/index.ts')],
  outfile: path.join(outDir, 'main.cjs')
});
await build({
  ...common,
  entryPoints: [path.join(root, 'src/preload/index.ts')],
  outfile: path.join(outDir, 'preload.cjs')
});
await viteBuild({ configFile: path.join(root, 'vite.config.ts') });
console.log('desktop build complete');

