// T-P3-03/04 — 应用路由（5 个页面 + 未匹配兜底）
//
// ARCHITECTURE §4.1 / PRD §6：主导航 4 项 + 「关于」= 5 个路由。
// 页面 1 / 页面 2 本批次实现；页面 3（分析报告）/ 页面 4（历史趋势）由后续任务接管，
// 此处先挂占位；「关于」为静态说明占位。

import { Routes, Route, Navigate } from 'react-router-dom';
import Box from '@mui/material/Box';
import AppShell from './components/AppShell';
import Page1HotStream from './pages/Page1HotStream';
import Page2Channels from './pages/Page2Channels';
import { tokens } from './theme/tokens';

/** 未实现页面的占位（保持导航可点、不白屏） */
function Placeholder({ title, hint }: { title: string; hint: string }) {
  return (
    <Box
      data-testid="page-placeholder"
      sx={{
        border: `1px dashed ${tokens.surface.border}`,
        borderRadius: tokens.radius.md,
        bgcolor: tokens.surface.surface,
        p: 4,
        textAlign: 'center',
        color: tokens.surface.text2,
      }}
    >
      <Box sx={{ fontWeight: tokens.fw.semibold, fontSize: tokens.fs.xl, color: tokens.surface.text }}>
        {title}
      </Box>
      <Box sx={{ mt: 1, fontSize: tokens.fs.sm }}>{hint}</Box>
    </Box>
  );
}

export default function App() {
  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<Page1HotStream />} />
        <Route path="/channels" element={<Page2Channels />} />
        <Route
          path="/report"
          element={<Placeholder title="分析报告（当天）" hint="T-P3-05 待实现：热点榜 / 分类分布 / 关键词。" />}
        />
        <Route
          path="/history"
          element={<Placeholder title="历史趋势与回看" hint="T-P3-06 待实现：趋势图 / 日期回看 / 归档。" />}
        />
        <Route
          path="/about"
          element={
            <Placeholder
              title="关于 RSS Radar"
              hint="把散落在各处的 RSS 源，汇聚成一份每天更新的信息雷达与热点报告。"
            />
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AppShell>
  );
}
