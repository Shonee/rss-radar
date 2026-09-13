// T-P3-03 — 全站外壳（主导航 + 页脚 + file:// 外链兜底修复）
//
// 职责：
//   1. 统一页面骨架（sticky header + 内容区 + footer），导航在窄屏可横向滚动、不溢出。
//   2. 5 项主导航（ARCHITECTURE §4.1 / PRD v1.1）：聚合热榜流 / 渠道看板 / 分析报告 / 历史趋势 / 关于。
//   3. file:// 协议下 `target="_blank"` 外链被浏览器拦截的修复（原型 v1.3 D）：
//      文档级捕获点击并改走 window.open，避免逐组件改造（ItemCard / ChannelCard 等共享 `target="_blank"`）。

import { useEffect, type ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import Box from '@mui/material/Box';
import { tokens } from '../theme/tokens';
import siteConfigJson from '../../config/site-config.json';

export interface NavItem {
  to: string;
  label: string;
}

/** 主导航（顺序即展示顺序） */
export const NAV_ITEMS: NavItem[] = [
  { to: '/', label: '聚合热榜流' },
  { to: '/channels', label: '渠道看板' },
  { to: '/report', label: '分析报告' },
  { to: '/history', label: '历史趋势' },
  { to: '/about', label: '关于' },
];

const SITE_TITLE = (siteConfigJson.site?.title as string | undefined) ?? 'RSS Radar';
const SITE_SLOGAN = (siteConfigJson.site?.slogan as string | undefined) ?? '每天更新的信息雷达与热点报告';
const SITE_FOOTER = (siteConfigJson.site?.footer as string | undefined) ?? '';

/** 导航 testid：'/' → nav-home；'/channels' → nav-channels */
function navTestId(to: string): string {
  return to === '/' ? 'nav-home' : `nav-${to.replace(/^\//, '')}`;
}

/**
 * file:// 下修复 target="_blank"：注册文档级捕获代理，命中 `a[target="_blank"]` 时
 * 阻止默认行为并改用 window.open 打开（原窗口不跳转）。
 */
function useFileProtocolExternalLinkFix(): void {
  useEffect(() => {
    if (typeof window === 'undefined' || window.location.protocol !== 'file:') return;
    const onClick = (ev: MouseEvent): void => {
      const target = ev.target as HTMLElement | null;
      const anchor = target?.closest?.('a[target="_blank"]') as HTMLAnchorElement | null;
      if (!anchor) return;
      const href = anchor.getAttribute('href');
      if (!href) return;
      ev.preventDefault();
      window.open(anchor.href, '_blank', 'noopener,noreferrer');
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, []);
}

export interface AppShellProps {
  children: ReactNode;
}

export default function AppShell({ children }: AppShellProps) {
  useFileProtocolExternalLinkFix();

  return (
    <Box
      data-testid="app-shell"
      sx={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        bgcolor: tokens.surface.bg,
        color: tokens.surface.text,
        fontFamily: tokens.font.sans,
      }}
    >
      <Box
        component="header"
        data-testid="app-header"
        sx={{
          position: 'sticky',
          top: 0,
          zIndex: tokens.z.sticky,
          borderBottom: `1px solid ${tokens.surface.border}`,
          bgcolor: tokens.surface.surface,
        }}
      >
        <Box
          sx={{
            maxWidth: 1440,
            mx: 'auto',
            px: 2,
            py: 1.25,
            display: 'flex',
            alignItems: 'center',
            gap: 2,
            minWidth: 0,
          }}
        >
          <NavLink
            to="/"
            data-testid="nav-brand"
            style={{
              textDecoration: 'none',
              color: tokens.surface.text,
              fontWeight: tokens.fw.bold,
              fontSize: tokens.fs.lg,
              whiteSpace: 'nowrap',
              flex: '0 0 auto',
            }}
          >
            {SITE_TITLE}
          </NavLink>

          <Box
            component="span"
            sx={{
              display: { xs: 'none', md: 'inline' },
              color: tokens.surface.text3,
              fontSize: tokens.fs.sm,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              minWidth: 0,
            }}
          >
            {SITE_SLOGAN}
          </Box>

          <Box
            component="nav"
            aria-label="主导航"
            data-testid="app-nav"
            sx={{
              ml: 'auto',
              display: 'flex',
              alignItems: 'center',
              gap: 0.5,
              overflowX: 'auto',
              maxWidth: '100%',
              minWidth: 0,
              py: 0.5,
              '& a': { whiteSpace: 'nowrap', flex: '0 0 auto' },
            }}
          >
            {NAV_ITEMS.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
                data-testid={navTestId(item.to)}
                style={({ isActive }) => ({
                  textDecoration: 'none',
                  fontSize: tokens.fs.sm,
                  fontWeight: tokens.fw.medium,
                  padding: '4px 10px',
                  borderRadius: tokens.radius.sm,
                  color: isActive ? tokens.primary.active : tokens.surface.text2,
                  background: isActive ? tokens.primary.weak : 'transparent',
                })}
              >
                {item.label}
              </NavLink>
            ))}
          </Box>
        </Box>
      </Box>

      <Box
        component="main"
        data-testid="app-main"
        sx={{ maxWidth: 1440, width: '100%', mx: 'auto', px: 2, py: 3, flex: 1, minWidth: 0 }}
      >
        {children}
      </Box>

      <Box
        component="footer"
        data-testid="app-footer"
        sx={{
          borderTop: `1px solid ${tokens.surface.border}`,
          color: tokens.surface.text3,
          fontSize: tokens.fs.xs,
        }}
      >
        <Box sx={{ maxWidth: 1440, mx: 'auto', px: 2, py: 2 }}>{SITE_FOOTER}</Box>
      </Box>
    </Box>
  );
}
