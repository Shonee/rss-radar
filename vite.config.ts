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
    rollupOptions: {
      output: {
        // 路由级代码分割配合：把体积最大、跨路由共享的 MUI / Emotion / React
        // 拆成独立 vendor chunk（长期缓存，页面 chunk 变更不影响其 hash）。
        // 目标：主 chunk（index-*.js）只承载应用自身代码 + 首屏页面1。
        manualChunks(id: string): string | undefined {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('@mui') || id.includes('@emotion')) return 'vendor-mui';
          if (id.includes('react-router') || id.includes('@remix-run')) return 'vendor-router';
          if (id.includes('/react-dom/') || id.includes('/react/') || id.includes('/scheduler/')) {
            return 'vendor-react';
          }
          return 'vendor';
        },
      },
    },
  },
});