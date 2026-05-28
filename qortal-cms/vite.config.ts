import react from '@vitejs/plugin-react';
import { createReadStream, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin, UserConfig } from 'vite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const contentRoot = path.resolve(__dirname, '../wp-qortal-import');

const contentTypes: Record<string, string> = {
  '.json': 'application/json',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.pdf': 'application/pdf'
};

function localContentPlugin(): Plugin {
  return {
    name: 'qortal-cms-local-content',
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

export default {
  base: './',
  plugins: [react(), localContentPlugin()],
  server: {
    port: 5180
  }
} satisfies UserConfig;
