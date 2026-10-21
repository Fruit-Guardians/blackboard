import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';
import { resolvePort, viewerUrl } from './lib/service.js';

const backendUrl = viewerUrl(resolvePort({
  cwd: process.env.BLACKBOARD_CWD || process.cwd(),
}));

export default defineConfig({
  root: 'web',
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': fileURLToPath(new URL('./web/src', import.meta.url)) } },
  build: {
    outDir: '../public',
    emptyOutDir: true,
    sourcemap: false,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': backendUrl,
      '/events': backendUrl,
    },
  },
});
