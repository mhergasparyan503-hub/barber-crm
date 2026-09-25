import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      // No offline cache: avoids phones sticking to an old version after deploys.
      selfDestroying: true,
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'Барбер CRM',
        short_name: 'Барбер',
        description: 'Журнал записи барбера',
        theme_color: '#ff7900',
        background_color: '#f0f2f5',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        icons: [
          { src: '/pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/pwa-512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
    }),
  ],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  server: { host: '0.0.0.0', port: 8080, allowedHosts: true },
  preview: { host: '0.0.0.0', port: 8080, allowedHosts: true },
});
