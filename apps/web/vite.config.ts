import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { sentryVitePlugin } from '@sentry/vite-plugin';

const DESKTOP_ENV_KEYS = [
  'VITE_SUPABASE_URL',
  'VITE_SUPABASE_ANON_KEY',
  'VITE_API_URL',
  'VITE_SENTRY_DSN',
  'VITE_SENTRY_ORG_URL',
] as const;

export default defineConfig(({ mode }) => {
  // Empty process env (e.g. unset GitHub Actions secrets) must not blank .env.[mode].
  for (const key of DESKTOP_ENV_KEYS) {
    if (process.env[key] === '') delete process.env[key];
  }

  const isDesktopBuild = process.env.VITE_DESKTOP === '1';
  const env = loadEnv(mode, process.cwd(), '');
  const sentryAuth = (process.env.SENTRY_AUTH_TOKEN || env.SENTRY_AUTH_TOKEN || '').trim();
  const sentryOrg = (process.env.SENTRY_ORG || env.SENTRY_ORG || '').trim();
  const sentryProject = (process.env.SENTRY_PROJECT || env.SENTRY_PROJECT || '').trim();
  const uploadSourceMaps = Boolean(sentryAuth && sentryOrg && sentryProject);

  return {
    base: isDesktopBuild ? './' : '/',
    build: {
      // Use esbuild instead of terser so the build works in restricted envs
      minify: 'esbuild',
      sourcemap: uploadSourceMaps ? 'hidden' : false,
      rollupOptions: {
        output: {
          // pdf.js worker must not ship as .mjs — many proxies/nginx map that to octet-stream
          assetFileNames(assetInfo) {
            const name = assetInfo.names?.[0] ?? assetInfo.name ?? '';
            if (name.includes('pdf.worker')) {
              return 'assets/pdf.worker-[hash].js';
            }
            return 'assets/[name]-[hash][extname]';
          },
        },
      },
    },
    plugins: [
      react(),
      {
        name: 'assert-desktop-auth-env',
        configResolved() {
          if (!isDesktopBuild) return;
          const viteEnv = loadEnv(mode, process.cwd(), 'VITE_');
          const url = viteEnv.VITE_SUPABASE_URL || process.env.VITE_SUPABASE_URL;
          const anon = viteEnv.VITE_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
          if (!url || !anon) {
            throw new Error(
              'Desktop build missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY. ' +
                'Ensure apps/web/.env.desktop is present (or set non-empty env vars).',
            );
          }
        },
      },
      // Emit a self-destroying sw.js so existing installs uninstall themselves.
      // Offline data lives in IndexedDB; a caching SW was intercepting /api (Failed to fetch)
      // while Supabase auth (other origin) still worked.
      !isDesktopBuild &&
        VitePWA({
          selfDestroying: true,
          injectRegister: false,
          manifest: false,
        }),
      uploadSourceMaps &&
        sentryVitePlugin({
          org: sentryOrg,
          project: sentryProject,
          authToken: sentryAuth,
          disable: false,
          sourcemaps: {
            filesToDeleteAfterUpload: ['./dist/**/*.map'],
          },
        }),
    ].filter(Boolean),
  };
});
