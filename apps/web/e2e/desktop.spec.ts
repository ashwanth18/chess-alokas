import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test, expect } from '@playwright/test';

/**
 * The desktop renderer as Electron loads it: a `--mode desktop` build opened over file://, with the
 * HashRouter and relative asset URLs. Not Electron itself: run `pnpm run build:desktop` and open the
 * packaged app for the title bar overlay and print checks. All network is blocked, and with no saved
 * session the app makes no call to the real backend named in .env.desktop.
 */
const WEB = join(import.meta.dirname, '..');
const OUT = join(WEB, 'dist-desktop-e2e');

test.beforeAll(() => {
  execFileSync('pnpm', ['exec', 'cross-env', 'VITE_DESKTOP=1', 'vite', 'build', '--mode', 'desktop', '--outDir', 'dist-desktop-e2e', '--emptyOutDir'], {
    cwd: WEB,
    stdio: 'ignore',
    shell: true,
  });
});

test('the build keeps relative URLs, no service worker, no crossorigin', () => {
  const html = readFileSync(join(OUT, 'index.html'), 'utf8');
  expect(html).toContain('./assets/');
  expect(html).not.toMatch(/(src|href)="\/assets/);
  expect(html).not.toMatch(/crossorigin/);
  expect(html).not.toContain('fonts.g');
  expect(existsSync(join(OUT, 'sw.js'))).toBe(false);
  const css = readdirSync(join(OUT, 'assets')).filter((f) => f.endsWith('.css'));
  const main = css.map((f) => readFileSync(join(OUT, 'assets', f), 'utf8')).join('\n');
  expect(main).toMatch(/url\(["']?\.?\/?archivo-latin/);
});

test('over file:// it boots to sign-in with drag regions and Archivo', async ({ page, context }) => {
  const external: string[] = [];
  await context.route(/^https?:/, (route) => {
    external.push(route.request().url());
    return route.abort();
  });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  // The preload bridge, with just enough for the app to see a desktop.
  await page.addInitScript(() => {
    (window as unknown as { desktop: unknown }).desktop = {
      isDesktop: true,
      platform: 'win32',
      getAppVersion: () => '0.0.0-test',
      getApiBaseUrl: () => 'http://127.0.0.1:9',
      getUserDataPath: () => '',
      onUpdateStatus: () => () => undefined,
    };
  });

  await page.goto(`${pathToFileURL(join(OUT, 'index.html')).href}#/login`);
  await page.locator('form').first().waitFor();

  const html = page.locator('html');
  await expect(html).toHaveClass(/is-desktop/);
  await expect(html).toHaveClass(/is-desktop-win/);
  expect(page.url()).toContain('#/login');

  await page.evaluate(() => document.fonts.ready);
  expect(await page.evaluate(() => document.fonts.check('16px Archivo'))).toBe(true);
  const family = await page.locator('body').evaluate((el) => getComputedStyle(el).fontFamily);
  expect(family).toContain('Archivo');
  expect(errors).toEqual([]);
});

test('the desktop top bars keep their drag region and overlay space in the shipped CSS', () => {
  const css = readdirSync(join(OUT, 'assets'))
    .filter((f) => f.endsWith('.css'))
    .map((f) => readFileSync(join(OUT, 'assets', f), 'utf8'))
    .join('\n');
  expect(css).toMatch(/html\.is-desktop \.topbar[^{]*\{-webkit-app-region:drag/);
  expect(css).toMatch(/html\.is-desktop \.topbar a[^{]*\{-webkit-app-region:no-drag/);
  expect(css).toMatch(/html\.is-desktop-win \.topbar[^{]*\{padding-right:140px/);
  expect(css).toMatch(/html\.is-desktop \.ui-topbar\{-webkit-app-region:drag/);
  expect(css).toMatch(/html\.is-desktop-win \.ui-topbar[^{]*\{padding-right:140px/);
});
