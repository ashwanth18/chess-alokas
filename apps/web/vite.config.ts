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
      // Desktop loads index.html via file:// (mainWindow.loadFile), where there
      // is no real cross-origin boundary between the HTML and its own built
      // assets — but Chromium can still compute file:// origins per-file
      // rather than per-directory. `crossorigin` on Vite's emitted
      // <script type="module">/<link> tags asks the browser to fetch those
      // assets in CORS mode, which is unnecessary here and a plausible
      // contributor to the BOOT_UI_STUCK reports (the module bundle silently
      // failing to load, so React never mounts). Strip it for the desktop
      // build only; the hosted web build still needs it for CDN-style serving.
      isDesktopBuild && {
        name: 'strip-crossorigin-for-file-protocol',
        transformIndexHtml: {
          order: 'post' as const,
          handler(html: string) {
            // Only the locally-built ./assets/* tags Vite emits — leave the
            // hand-written Google Fonts preconnect/stylesheet tags alone,
            // those are genuinely cross-origin.
            return html.replace(/<(?:script|link)\b[^>]*>/g, (tag) => {
              if (!tag.includes('./assets/')) return tag;
              return tag.replace(/\s+crossorigin(="[^"]*")?/, '');
            });
          },
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
