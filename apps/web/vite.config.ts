import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

const isDesktopBuild = process.env.VITE_DESKTOP === '1';

export default defineConfig({
  base: isDesktopBuild ? './' : '/',
  build: {
    // Use esbuild instead of terser so the build works in restricted envs
    minify: 'esbuild',
  },
  plugins: [
    react(),
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
          start_url: '/',
          icons: [],
        },
      }),
  ].filter(Boolean),
});
