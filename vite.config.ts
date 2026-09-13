import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// ARCHITECTURE §7.2 — base: './' 让构建产物可在 GH Pages 子路径直接打开
export default defineConfig({
  base: './',
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(process.cwd(), 'src'),
      '@scripts': path.resolve(process.cwd(), 'scripts'),
    },
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    // P1 dev bridge: 把采集产物软链接到 public/data/today/ 后即可在 dev server 通过 /data/today/*.json 访问
    // 见 scripts/collect/dev-bridge.mjs
    fs: {
      allow: [path.resolve(process.cwd())],
    },
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
    strictPort: true,
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    target: 'es2022',
  },
});