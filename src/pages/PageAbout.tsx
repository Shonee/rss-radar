// T-P3-08 — 页面「关于」（通知配置说明 + 只读通知状态面板 + 数据来源）
//
// 版块：
//   1. Hero：站点标语（site.slogan）
//   2. 通知配置：开启步骤说明 + 指路 docs/NOTIFY.md + 只读通知状态面板（NotifyStatusPanel）
//   3. 数据来源 / 版权（site.footer）+ 热点方法论入口
//
// 硬约束（ARCHITECTURE §12）：通知状态**纯只读**，本页绝不提供触发发送的按钮 / 链接。

import { Link } from 'react-router-dom';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import LinkMui from '@mui/material/Link';
import Typography from '@mui/material/Typography';

import { NotifyStatusPanel } from '../components';
import { useNotifyStats } from '../hooks';
import { enabledChannelIds } from '../services/notifyStatsClient';
import { tokens } from '../theme/tokens';
import siteConfigJson from '../../config/site-config.json';

const SITE_TITLE = (siteConfigJson.site?.title as string | undefined) ?? 'RSS Radar';
const SITE_SLOGAN = (siteConfigJson.site?.slogan as string | undefined) ?? '';
const SITE_FOOTER = (siteConfigJson.site?.footer as string | undefined) ?? '';
const DATA_BRANCH = (siteConfigJson.site?.dataBranch as string | undefined) ?? 'deploy';

/** 文档占位文案（docs/NOTIFY.md 属另一交付物，本任务不撰写该文档） */
// TODO(T-P3-08): 待仓库补 docs/NOTIFY.md 后，把下方文案换成指向该文档的真实链接。
const NOTIFY_DOC_LABEL = '见仓库 docs/NOTIFY.md（待补）';

export default function PageAbout() {
  const { data: stats, loading, degraded } = useNotifyStats();
  const enabled = enabledChannelIds();

  return (
    <Box data-testid="about-root" data-component="page-about">
      {/* ---------- Hero ---------- */}
      <Box sx={{ mb: 3 }}>
        <Typography component="h1" sx={{ m: 0, fontSize: tokens.fs['2xl'], fontWeight: tokens.fw.semibold }}>
          关于 {SITE_TITLE}
        </Typography>
        <Typography
          data-testid="about-slogan"
          sx={{ mt: 0.5, color: tokens.surface.text2, fontSize: tokens.fs.md, lineHeight: tokens.lh.base }}
        >
          {SITE_SLOGAN}
        </Typography>
      </Box>

      {/* ---------- 通知配置 ---------- */}
      <Box
        data-testid="about-notify-section"
        sx={{
          border: `1px solid ${tokens.surface.border}`,
          borderRadius: tokens.radius.md,
          bgcolor: tokens.surface.surface,
          p: 2.5,
          mb: 3,
        }}
      >
        <Typography component="h2" sx={{ m: 0, fontSize: tokens.fs.xl, fontWeight: tokens.fw.semibold }}>
          通知配置
        </Typography>
        <Typography sx={{ mt: 0.75, color: tokens.surface.text2, fontSize: tokens.fs.sm, lineHeight: tokens.lh.base }}>
          RSS Radar 支持将「每日日报」与「实时热点」推送到邮件 / 飞书 / 钉钉 / 企业微信。
          密钥只以**引用名**形式写在 <code>config/notify.json</code>，运行时从仓库 Secrets 读取，
          配置文件内<strong>不含明文密钥</strong>。开启步骤：
        </Typography>
        <Box
          component="ol"
          data-testid="about-notify-steps"
          sx={{ m: 0, mt: 1, pl: 3, fontSize: tokens.fs.sm, color: tokens.surface.text2, lineHeight: tokens.lh.loose }}
        >
          <Box component="li">在仓库 Settings → Secrets 配置对应渠道密钥（如 <code>SMTP_PASSWORD</code>、<code>FEISHU_WEBHOOK</code>）。</Box>
          <Box component="li">在 <code>config/notify.json</code> 把目标渠道的 <code>enabled</code> 改为 <code>true</code>，并勾选其订阅的 <code>events</code>。</Box>
          <Box component="li">按需调整静默时段 <code>quietHours</code> 与实时提醒阈值（<code>hotScoreThreshold</code> / <code>sourceCountThreshold</code>）。</Box>
          <Box component="li">采集 workflow 完成落盘后会独立执行通知步骤；通知失败不影响主采集（ARCH §12.6）。</Box>
        </Box>
        <Typography sx={{ mt: 1, color: tokens.surface.text3, fontSize: tokens.fs.xs }}>
          详细说明：{NOTIFY_DOC_LABEL}。
        </Typography>

        <Box sx={{ mt: 2 }}>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, alignItems: 'center', mb: 1 }}>
            <Typography sx={{ fontSize: tokens.fs.sm, color: tokens.surface.text2 }}>
              当前启用渠道（{enabled.length}）：
            </Typography>
            {enabled.length === 0 ? (
              <Typography sx={{ fontSize: tokens.fs.sm, color: tokens.surface.text3 }}>无（均为占位，默认关闭）</Typography>
            ) : (
              enabled.map((id) => <Chip key={id} size="small" label={id} sx={{ height: 20 }} />)
            )}
          </Box>

          {loading ? (
            <Typography data-testid="about-notify-loading" sx={{ color: tokens.surface.text3, fontSize: tokens.fs.sm }}>
              正在读取通知状态…
            </Typography>
          ) : stats ? (
            <Box>
              <NotifyStatusPanel stats={stats} defaultOpen testId="about-notify-panel" />
              {degraded && (
                <Typography sx={{ mt: 1, color: tokens.surface.text3, fontSize: tokens.fs.xs }}>
                  暂无发送记录（未检测到 <code>stats/notify-state.json</code>；通知尚未运行或尚未发布到数据分支）。
                </Typography>
              )}
            </Box>
          ) : null}
        </Box>
      </Box>

      {/* ---------- 数据来源 / 方法论 ---------- */}
      <Box
        data-testid="about-data-section"
        sx={{
          border: `1px solid ${tokens.surface.border}`,
          borderRadius: tokens.radius.md,
          bgcolor: tokens.surface.surface,
          p: 2.5,
        }}
      >
        <Typography component="h2" sx={{ m: 0, fontSize: tokens.fs.xl, fontWeight: tokens.fw.semibold }}>
          数据来源与更新
        </Typography>
        <Typography sx={{ mt: 0.75, color: tokens.surface.text2, fontSize: tokens.fs.sm, lineHeight: tokens.lh.base }}>
          数据由定时采集任务产出，发布在独立的 <code>{DATA_BRANCH}</code> 分支；页面在构建期不内联数据，
          运行时按「源站 raw → jsDelivr 版本化回退 → 本地缓存」三层降级读取，因此<strong>不重新构建即可更新</strong>。
          页面 3（分析报告）只基于当天数据、跨天重置；历史趋势与回看见页面 4。
        </Typography>
        <Box sx={{ mt: 1.5, display: 'flex', flexWrap: 'wrap', gap: 1 }}>
          <Chip
            component={Link}
            to="/report"
            clickable
            data-testid="about-methodology-link"
            label="热点方法论（页面3）"
            variant="outlined"
            sx={{ height: 24 }}
          />
          <Chip
            component={Link}
            to="/history"
            clickable
            data-testid="about-history-link"
            label="历史趋势与回看（页面4）"
            variant="outlined"
            sx={{ height: 24 }}
          />
        </Box>
        <Typography
          data-testid="about-footer-text"
          sx={{ mt: 2, pt: 1.5, borderTop: `1px solid ${tokens.surface.border}`, color: tokens.surface.text3, fontSize: tokens.fs.xs }}
        >
          {SITE_FOOTER}
        </Typography>
        <Typography sx={{ mt: 1, color: tokens.surface.text3, fontSize: tokens.fs.xs }}>
          数据通路与字段口径参见仓库 <LinkMui component={Link} to="/report" underline="hover">分析报告页</LinkMui>{' '}
          的「方法论」折叠区。
        </Typography>
      </Box>
    </Box>
  );
}
