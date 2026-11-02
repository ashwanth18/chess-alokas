import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Page } from '@playwright/test';

const WEB = join(import.meta.dirname, '..', '..');
const OUT = 'dist-desktop-nav';

/**
 * A `--mode desktop` build whose backends are the two fake ones in mockApi.ts, so a signed-in session
 * can be tested over file:// with nothing real named in the bundle.
 */
export function buildDesktopWithFakeBackends() {
  execFileSync('pnpm', ['exec', 'cross-env', 'VITE_DESKTOP=1', 'vite', 'build', '--mode', 'desktop', '--outDir', OUT, '--emptyOutDir'], {
    cwd: WEB,
    stdio: 'ignore',
    shell: true,
    env: {
      ...process.env,
      VITE_API_URL: 'http://localhost:3999',
      VITE_SUPABASE_URL: 'http://localhost:3998',
      VITE_SUPABASE_ANON_KEY: 'e2e-not-a-real-key',
      VITE_SENTRY_DSN: '',
    },
  });
}

export const desktopUrl = (route: string) => `${pathToFileURL(join(WEB, OUT, 'index.html')).href}#${route}`;

/** The preload bridge, with just enough for the app to see a Windows desktop. */
export async function installDesktopBridge(page: Page) {
  await page.addInitScript(() => {
    (window as unknown as { desktop: unknown }).desktop = {
      isDesktop: true,
      platform: 'win32',
      getAppVersion: () => '0.0.0-test',
      getApiBaseUrl: () => 'http://localhost:3999',
      getUserDataPath: () => '',
      onUpdateStatus: () => () => undefined,
      getUpdateStatus: async () => ({ status: 'idle', currentVersion: '0.0.0-test', canInstall: false }),
      getLastError: () => null,
      reportBootIssue: () => undefined,
    };
  });
}
