import { defineConfig } from 'vite';
// Build straight into the repo root, which GitHub Pages serves (CNAME bnwlab.com).
export default defineConfig({
  base: '/',
  build: { outDir: '..', emptyOutDir: false, assetsDir: 'assets', target: 'es2020', chunkSizeWarningLimit: 900 },
});
