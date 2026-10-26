import react from '@vitejs/plugin-react';
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import type { Plugin } from 'vite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

const contentTypes: Record<string, string> = {
  '.css': 'text/css',
  '.gif': 'image/gif',
  '.html': 'text/html',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.m4a': 'audio/mp4',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.ogg': 'audio/ogg',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain',
  '.webm': 'video/webm',
  '.webp': 'image/webp'
};

function qortalContentPlugin(contentRoot: string): Plugin {
  return {
    name: 'qortal-local-content',
    configureServer(server) {
      server.middlewares.use('/qortal-content', (request, response, next) => {
        if (!request.url) {
          next();
          return;
        }

        const requestPath = decodeURIComponent(request.url.split('?')[0] || '/');
        const resolved = path.resolve(contentRoot, `.${requestPath}`);

        if (!resolved.startsWith(contentRoot) || !existsSync(resolved)) {
          response.statusCode = 404;
          response.end('Not found');
          return;
        }

        const fileStat = statSync(resolved);
        if (!fileStat.isFile()) {
          next();
          return;
        }

        response.setHeader('Content-Type', contentTypes[path.extname(resolved).toLowerCase()] || 'application/octet-stream');
        response.setHeader('Content-Length', fileStat.size);
        createReadStream(resolved).pipe(response);
      });
    }
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, rootDir, '');
  const profileId = process.env.MIGRATION_PROFILE || env.MIGRATION_PROFILE || 'corbettreport';
  const profilePath = path.resolve(rootDir, 'profiles', profileId, 'profile.json');
  const profile = JSON.parse(readFileSync(profilePath, 'utf8')) as {
    resource_prefix: string;
    default_output_dir?: string;
  };
  const outputDir = process.env.OUTPUT_DIR
    || env.OUTPUT_DIR
    || profile.default_output_dir
    || `./workspaces/${profileId}/wp-qortal-import`;
  const contentRoot = path.resolve(rootDir, outputDir);

  return {
    base: './',
    define: {
      'import.meta.env.VITE_QDN_MANIFEST_IDENTIFIER': JSON.stringify(`${profile.resource_prefix}-qdn-manifest`)
    },
    plugins: [react(), qortalContentPlugin(contentRoot)],
    server: {
      port: 5174
    }
  };
});
