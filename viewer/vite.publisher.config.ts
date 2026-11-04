import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Standalone Migration Publisher Q-App.
 *
 * This build has no profile, preview data or local content server. It is a
 * single generic Q-App served from QDN and works for any name owned by the
 * active Qortal Hub account.
 */
export default defineConfig({
  root: path.resolve(__dirname, 'publisher'),
  base: './',
  publicDir: false,
  plugins: [react()],
  build: {
    outDir: path.resolve(__dirname, 'dist-publisher'),
    emptyOutDir: true,
    assetsDir: 'assets',
    target: 'es2020',
    sourcemap: false
  },
  server: { port: 5175 }
});
