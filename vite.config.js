import { defineConfig } from 'vite';

export default defineConfig({
  root: 'client',
  // Относительные пути: сайт работает и в корне домена, и на GitHub Pages по адресу /<репозиторий>/
  base: './',
  publicDir: 'public',
  build: { outDir: '../dist', emptyOutDir: true },
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:3001' },
  },
});
