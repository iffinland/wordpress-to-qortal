import react from '@vitejs/plugin-react';
import { createReadStream, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin, UserConfig } from 'vite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const contentRoot = path.resolve(__dirname, '../wp-qortal-import');

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

function qortalContentPlugin(): Plugin {
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

export default {
  plugins: [react(), qortalContentPlugin()],
  server: {
    port: 5174
  }
} satisfies UserConfig;
