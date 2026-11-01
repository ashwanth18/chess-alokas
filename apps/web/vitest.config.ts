import { defineConfig } from 'vitest/config';

// Pure-logic tests only: kept separate from vite.config.ts so the PWA and env plugins never run here.
export default defineConfig({
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
});
