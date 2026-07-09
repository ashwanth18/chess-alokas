import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  build: {
    // Use esbuild instead of terser so the build works in restricted envs
    minify: 'esbuild',
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        // Disable workbox's own terser minification to avoid sandbox issues
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
  ],
});
