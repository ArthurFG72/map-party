import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  envDir: '..',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'Map Party', short_name: 'Map Party',
        description: 'Localização e rota compartilhadas em tempo real',
        theme_color: '#0f172a', background_color: '#f8fafc', display: 'standalone', start_url: '/',
        lang: 'pt-BR', orientation: 'portrait-primary', categories: ['navigation', 'travel', 'social'],
        icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' }]
      },
      workbox: {
        navigateFallback: '/index.html',
        globPatterns: ['**/*.{js,css,html,svg}'],
        runtimeCaching: []
      }
    })
  ],
  server: { host: true, port: 5173 }
});
