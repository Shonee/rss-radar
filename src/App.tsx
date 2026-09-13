// T-P3-05 / T-P3-06 / T-P3-08 — 应用路由（五页面 + 未匹配兜底 + 路由级代码分割）
//
// 性能回归修复（第二轮后 index-*.js 涨到 495.97 kB / gzip 156 kB）：
//   原实现把 4 个页面全部静态导入 → 首次进入任意页都要下载全部页面代码。
//   现改为「AppShell + 页面1」静态导入（首屏关键路径），其余路由 React.lazy
//   懒加载，每页各自独立 chunk；MUI / Emotion 由 vite.config.ts 的
//   manualChunks 拆到 vendor-mui（跨路由共享、长期缓存）。
//
// 参考：ARCHITECTURE §4.1（5 项主导航） / §7.2（HashRouter + base './'）。

import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import Box from '@mui/material/Box';

// 首屏关键路径：外壳与落地页保持静态导入（避免额外请求瀑布）
import AppShell from './components/AppShell';
import SkeletonList from './components/Skeleton';
import Page1HotStream from './pages/Page1HotStream';

// 路由级懒加载：每页独立 chunk，首屏不加载
const Page2Channels = lazy(() => import('./pages/Page2Channels'));
const Page3Report = lazy(() => import('./pages/Page3Report'));
const Page4History = lazy(() => import('./pages/Page4History'));
const PageAbout = lazy(() => import('./pages/PageAbout'));

/** 路由懒加载兜底：轻量骨架（复用组件库 SkeletonList，避免白屏） */
function RouteFallback() {
  return (
    <Box data-testid="route-fallback" sx={{ py: 2 }}>
      <SkeletonList count={3} testId="route-skeleton" />
    </Box>
  );
}

export default function App() {
  return (
    <AppShell>
      <Suspense fallback={<RouteFallback />}>
        <Routes>
          <Route path="/" element={<Page1HotStream />} />
          <Route path="/channels" element={<Page2Channels />} />
          <Route path="/report" element={<Page3Report />} />
          <Route path="/history" element={<Page4History />} />
          <Route path="/about" element={<PageAbout />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </AppShell>
  );
}
