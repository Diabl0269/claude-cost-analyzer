import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('./web', import.meta.url));
const port = Number(process.env.CCA_PORT ?? 4141);
const vitePort = Number(process.env.CCA_VITE_PORT ?? 5173);

export default defineConfig({
  root,
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./web/src', import.meta.url)),
      '@core': fileURLToPath(new URL('./core', import.meta.url)),
    },
  },
  build: {
    outDir: fileURLToPath(new URL('./dist/web', import.meta.url)),
    emptyOutDir: true,
    sourcemap: false,
    target: 'es2022',
  },
  server: {
    host: '127.0.0.1',
    port: vitePort,
    strictPort: true,
    proxy: {
      '/api': { target: `http://127.0.0.1:${port}`, changeOrigin: true },
    },
  },
});
