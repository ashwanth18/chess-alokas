import { defineConfig } from '@playwright/test';

/**
 * Visual and behaviour checks, against a real production build (`vite build --mode e2e`).
 * See docs/design/COMPONENTS.md for how to run them.
 *
 * E2E_PARITY=1 swaps every font for one fixed system font and writes to e2e/.parity (not committed).
 * It proves a CSS refactor changed nothing but the font: capture on the old code, compare on the new.
 */
const parity = process.env.E2E_PARITY === '1';
const PORT = 4179;

const viewports = [
  { name: 'w360', viewport: { width: 360, height: 780 }, deviceScaleFactor: 1, hasTouch: true },
  { name: 'w390', viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true },
  { name: 'w1366', viewport: { width: 1366, height: 768 }, deviceScaleFactor: 1 },
  { name: 'w1920', viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 },
];

export default defineConfig({
  testDir: './e2e',
  outputDir: './test-results',
  // One worker: the build is shared and baselines must not depend on machine load.
  workers: 1,
  fullyParallel: false,
  retries: 0,
  reporter: [['list']],
  timeout: 60_000,
  snapshotPathTemplate: parity
    ? 'e2e/.parity/{projectName}/{arg}{ext}'
    : 'e2e/__screenshots__/{projectName}/{arg}{ext}',
  expect: {
    toHaveScreenshot: {
      animations: 'disabled',
      caret: 'hide',
      // Zero tolerance: the fixtures are frozen, so any pixel that moves is a real change.
      maxDiffPixels: 0,
    },
  },
  use: {
    baseURL: `http://localhost:${PORT}`,
    locale: 'en-MY',
    timezoneId: 'Asia/Kuala_Lumpur',
    reducedMotion: 'reduce',
    colorScheme: 'light',
    serviceWorkers: 'block',
    trace: 'off',
  },
  projects: [
    ...viewports.map((v) => ({ name: v.name, testMatch: /visual\.spec\.ts/, use: v })),
    { name: 'checks', testMatch: /(audit|contrast|shells|ui|legacy|navigation)\.spec\.ts/, use: viewports[2] },
    // Electron grants file:// module loading itself; stock Chromium needs telling.
    {
      name: 'desktop',
      testMatch: /(desktop|desktopNav|legalLinks)\.spec\.ts/,
      use: { ...viewports[2], launchOptions: { args: ['--allow-file-access-from-files'] } },
    },
  ],
  webServer: {
    command: `pnpm exec vite build --mode e2e --outDir dist-e2e --emptyOutDir && pnpm exec vite preview --mode e2e --outDir dist-e2e --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}/`,
    reuseExistingServer: process.env.E2E_REUSE === '1',
    timeout: 240_000,
    stdout: 'ignore',
  },
});
