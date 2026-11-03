import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    include: ['tests/**/*.spec.{ts,tsx}'],
    environment: 'node',
    environmentMatchGlobs: [['tests/renderer/**', 'jsdom']],
    setupFiles: ['tests/setup.ts'],
    testTimeout: 30000,
    hookTimeout: 30000
  }
});

