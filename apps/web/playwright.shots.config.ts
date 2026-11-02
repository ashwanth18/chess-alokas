import { defineConfig } from '@playwright/test';
import base from './playwright.config';

/**
 * Navigation checks and the before-and-after screenshots, on their own port and build folder, so a
 * run of the whole suite elsewhere on this machine doesn't get in the way.
 *
 *   pnpm exec playwright test -c playwright.shots.config.ts navigation
 *   SHOT_PHASE=after pnpm exec playwright test -c playwright.shots.config.ts navShots
 */
const PORT = 4279;

export default defineConfig({
  ...base,
  use: { ...base.use, baseURL: `http://localhost:${PORT}` },
  projects: [
    {
      name: 'nav',
      testMatch: /(navigation|desktopNav|navShots)\.spec\.ts/,
      use: { viewport: { width: 1366, height: 768 }, launchOptions: { args: ['--allow-file-access-from-files'] } },
    },
  ],
  webServer: {
    command: `pnpm exec vite build --mode e2e --outDir dist-e2e-shots --emptyOutDir && pnpm exec vite preview --mode e2e --outDir dist-e2e-shots --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}/`,
    reuseExistingServer: process.env.E2E_REUSE === '1',
    timeout: 240_000,
    stdout: 'ignore',
  },
});
