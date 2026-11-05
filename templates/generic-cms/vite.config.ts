import react from '@vitejs/plugin-react';
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import type { Plugin } from 'vite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const configPath = process.env.CMS_TEMPLATE_CONFIG
  ? path.resolve(process.env.CMS_TEMPLATE_CONFIG)
  : path.resolve(__dirname, 'cms.config.json');
const cmsConfig = JSON.parse(readFileSync(configPath, 'utf8'));
const fixturesRoot = path.resolve(__dirname, 'fixtures');
const packageJson = JSON.parse(readFileSync(path.resolve(__dirname, 'package.json'), 'utf8'));

const contentTypes: Record<string, string> = {
  '.json': 'application/json; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.pdf': 'application/pdf'
};

function fixtureHost(requestPath: string) {
  const decoded = decodeURIComponent(requestPath.split('?')[0] || '/');
  const resolved = path.resolve(fixturesRoot, '.' + decoded);
  if (!resolved.startsWith(fixturesRoot) || !existsSync(resolved)) return null;
  const info = statSync(resolved);
  return info.isFile() ? resolved : null;
}

function fixturePlugin(): Plugin {
  const middleware = (
    request: { url?: string },
    response: {
      statusCode: number;
      setHeader: (name: string, value: string | number) => void;
      end: (body?: string) => void;
    },
    next: () => void
  ) => {
    if (!request.url || !request.url.startsWith('/cms-fixture/')) {
      next();
      return;
    }
    const file = fixtureHost(request.url.slice('/cms-fixture'.length));
    if (!file) {
      response.statusCode = 404;
      response.end('Fixture not found');
      return;
    }
    response.setHeader('Content-Type', contentTypes[path.extname(file).toLowerCase()] || 'application/octet-stream');
    response.setHeader('Cache-Control', 'no-store');
    createReadStream(file).pipe(response as never);
  };
  return {
    name: 'qms-generic-cms-fixtures',
    configureServer(server) {
      server.middlewares.use(middleware as never);
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware as never);
    }
  };
}

export default defineConfig({
  base: './',
  define: {
    __CMS_CONFIG__: JSON.stringify(cmsConfig),
    __CMS_TEMPLATE_VERSION__: JSON.stringify(packageJson.version),
    // Empty in release builds: the hosting node origin is authoritative at
    // runtime. A localhost default here would make every Android Hub device
    // try to reach its own loopback address for ownership checks.
    'import.meta.env.VITE_QORTAL_NODE_URL': JSON.stringify(process.env.VITE_QORTAL_NODE_URL || '')
  },
  plugins: [react(), fixturePlugin()],
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    emptyOutDir: true,
    target: 'es2020',
    sourcemap: false
  },
  server: { port: 5191 },
  preview: { port: 5191 }
});
