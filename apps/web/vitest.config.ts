import { defineConfig } from 'vitest/config';

// Logic and server-rendered component tests only: kept separate from vite.config.ts so the PWA and
// env plugins never run here. Browser behaviour is covered by Playwright in e2e/.
export default defineConfig({
  esbuild: { jsx: 'automatic' },
  test: { environment: 'node', include: ['src/**/*.test.{ts,tsx}'] },
});
