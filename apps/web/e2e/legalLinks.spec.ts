import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { test, expect } from '@playwright/test';

/**
 * Legal links under the desktop app's HashRouter: a `--mode desktop` build over file://, as in
 * desktop.spec.ts. All network is blocked. Settings uses these same components, but needs a session.
 */
const WEB = join(import.meta.dirname, '..');
const OUT = join(WEB, 'dist-desktop-e2e');

test.beforeAll(() => {
  if (existsSync(join(OUT, 'index.html')) && process.env.E2E_REUSE_DESKTOP_BUILD === '1') return;
  execFileSync('pnpm', ['exec', 'cross-env', 'VITE_DESKTOP=1', 'vite', 'build', '--mode', 'desktop', '--outDir', 'dist-desktop-e2e', '--emptyOutDir'], {
    cwd: WEB,
    stdio: 'ignore',
    shell: true,
  });
});

test.beforeEach(async ({ page, context }) => {
  await context.route(/^https?:/, (route) => route.abort());
  await page.addInitScript(() => {
    (window as unknown as { desktop: unknown }).desktop = {
      isDesktop: true,
      platform: 'win32',
      getAppVersion: () => '0.0.0-test',
      getApiBaseUrl: () => 'http://127.0.0.1:9',
      getUserDataPath: () => '',
      onUpdateStatus: () => () => undefined,
      getUpdateStatus: async () => ({ status: 'idle', currentVersion: '0.0.0-test', canInstall: false }),
      getLastError: () => null,
      reportBootIssue: () => undefined,
    };
  });
});

for (const [name, target, heading] of [
  ['Terms', '#/terms', /terms/i],
  ['Privacy Policy', '#/privacy', /privacy/i],
] as const) {
  test(`sign-up's ${name} link stays inside the hash route`, async ({ page }) => {
    await page.goto(`${pathToFileURL(join(OUT, 'index.html')).href}#/signup`);
    const agreement = page.getByTestId('signup-agreement');
    await expect(agreement).toContainText('By creating an account you agree to');
    await agreement.getByRole('link', { name }).click();
    await expect(page).toHaveURL(new RegExp(`${target}$`));
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(heading);
  });
}

test('the retention link reaches that section under the hash route', async ({ page }) => {
  await page.goto(`${pathToFileURL(join(OUT, 'index.html')).href}#/privacy#retention`);
  await expect(page).toHaveURL(/#\/privacy#retention$/);
  await expect(page.locator('#retention')).toBeInViewport();
});
