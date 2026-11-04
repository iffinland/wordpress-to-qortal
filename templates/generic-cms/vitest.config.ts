import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cmsConfig = JSON.parse(readFileSync(path.resolve(__dirname, 'cms.config.json'), 'utf8'));

export default defineConfig({
  define: {
    __CMS_CONFIG__: JSON.stringify(cmsConfig),
    __CMS_TEMPLATE_VERSION__: JSON.stringify('test')
  },
  plugins: [react()],
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    globals: false,
    restoreMocks: true
  }
});
