import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  test: {
    projects: [
      { extends: true, test: { name: 'renderer', include: ['tests/renderer/**/*.spec.{ts,tsx}'], environment: 'jsdom', setupFiles: ['tests/setup.ts'] } },
      { extends: true, test: { name: 'main', include: ['tests/main/**/*.spec.ts', 'tests/*.spec.ts'], environment: 'node', setupFiles: ['tests/setup.ts'] } }
    ],
    testTimeout: 30000,
    hookTimeout: 30000
  }
});
