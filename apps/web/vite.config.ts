import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

const DESKTOP_ENV_KEYS = ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY', 'VITE_API_URL'] as const;

export default defineConfig(({ mode }) => {
  // Empty process env (e.g. unset GitHub Actions secrets) must not blank .env.[mode].
  for (const key of DESKTOP_ENV_KEYS) {
    if (process.env[key] === '') delete process.env[key];
  }

  const isDesktopBuild = process.env.VITE_DESKTOP === '1';

  return {
    base: isDesktopBuild ? './' : '/',
    build: {
      // Use esbuild instead of terser so the build works in restricted envs
      minify: 'esbuild',
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
          const env = loadEnv(mode, process.cwd(), 'VITE_');
          const url = env.VITE_SUPABASE_URL || process.env.VITE_SUPABASE_URL;
          const anon = env.VITE_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
          if (!url || !anon) {
            throw new Error(
              'Desktop build missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY. ' +
                'Ensure apps/web/.env.desktop is present (or set non-empty env vars).',
            );
          }
        },
      },
      // Service workers interfere with Electron file:// / loadFile — skip for desktop builds
      !isDesktopBuild &&
        VitePWA({
          registerType: 'autoUpdate',
          workbox: {
            globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
            maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
            disableDevLogs: true,
          },
          devOptions: {
            enabled: false,
          },
          manifest: {
            name: 'Chess Alokas',
            short_name: 'Chess Alokas',
            description: 'Offline-first chess tournament pairing system',
            theme_color: '#0f3d2e',
            background_color: '#0f3d2e',
            display: 'standalone',
            start_url: '/app',
            icons: [
              {
                src: '/favicon.svg',
                sizes: 'any',
                type: 'image/svg+xml',
                purpose: 'any',
              },
              {
                src: '/icon-512.svg',
                sizes: '512x512',
                type: 'image/svg+xml',
                purpose: 'any maskable',
              },
            ],
          },
        }),
    ].filter(Boolean),
  };
});
