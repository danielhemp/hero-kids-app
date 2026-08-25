import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { VitePWA } from 'vite-plugin-pwa';

/**
 * `BASE_PATH` is set when publishing to a project page (github.io/<repo>/);
 * relative URLs are right for everything else, including opening dist/ directly.
 */
const base = process.env.BASE_PATH ?? './';

/**
 * The camera, service workers and Add to Home Screen all need a secure context,
 * and a plain http:// LAN address is not one — which matters here because
 * pairing is a QR scan. `npm run dev:https` serves over TLS with a throwaway
 * certificate so the iPads can use the camera during development; for real use,
 * install the app from a proper https origin (see the README).
 */
const https = process.env.HTTPS === '1';

export default defineConfig({
  base,
  plugins: [
    react(),
    ...(https ? [basicSsl()] : []),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'Hero Kids',
        short_name: 'Hero Kids',
        description: 'Battle map and GM screen for Hero Kids',
        theme_color: '#2b2018',
        background_color: '#f4ecdc',
        display: 'standalone',
        orientation: 'landscape',
        start_url: './',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // The shell is tiny; content lives in IndexedDB, never in the precache.
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
      },
    }),
  ],
});
