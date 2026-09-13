// T-P3-02 公共组件库 — 条目卡片
//
// 统一降级渲染入口（ARCH §15.4 / §15.5）：
//   dead      → 标题置灰 + 删除线、外链按钮禁用「已失效」
//   dead+备用 → 用 alternateUrl 正常展示 + 角标「原链接已失效」
//   moved     → 角标「已迁移」
//   blocked   → 角标「⚠ 可能需验证」（样式不降权）

import { useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Link from '@mui/material/Link';
import Tooltip from '@mui/material/Tooltip';
import type { ItemCardData } from '../types';
import { categoryLabel } from '../config/categories';
import { categoryColor, tokens } from '../theme/tokens';
import { formatAbsolute, formatRelative } from '../services/time';
import StatusBadge, { urlStatusToKind } from './StatusBadge';

export interface ItemCardProps {
  item: ItemCardData;
  /** data-testid 前缀，默认 p1（页面1） */
  prefix?: string;
  /** 摘要默认展示（移动端由 CSS 隐藏） */
  showSummary?: boolean;
  /** 渠道首页（用于「渠道主页」链接与渠道名跳转） */
  channelHomepage?: string;
  /** 根元素 testid，默认 `${prefix}-item` */
  testId?: string;
}

export default function ItemCard({
  item,
  prefix = 'p1',
  showSummary = true,
  channelHomepage,
  testId,
}: ItemCardProps) {
  const [showSources, setShowSources] = useState(false);
  const rootTestId = testId ?? `${prefix}-item`;

  const isDead = item.status === 'dead';
  const hasAlternate = item.alternateUrl !== null && item.alternateUrl !== '';
  const badgeKind = urlStatusToKind(item.status, hasAlternate);
  const sourceCount = item.sourceCount ?? 1;

  return (
    <Box
      component="article"
      data-testid={rootTestId}
      data-component="item-card"
      data-item-id={item.id}
      data-channel-id={item.channelId}
      data-url-status={item.status}
      sx={{
        border: `1px solid ${tokens.surface.border}`,
        borderRadius: tokens.radius.md,
        bgcolor: tokens.surface.surface,
        p: 2,
        '&:hover': { borderColor: tokens.primary.weak2 },
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
        <Link
          data-testid={`${prefix}-title`}
          href={item.href}
          target="_blank"
          rel="noopener noreferrer"
          underline="hover"
          sx={{
            fontWeight: 500,
            fontSize: tokens.fs.md,
            color: isDead && !hasAlternate ? tokens.surface.text3 : tokens.surface.text,
            textDecoration: isDead && !hasAlternate ? 'line-through' : 'none',
          }}
        >
          {item.title}
        </Link>
        {item.isNew && (
          <span data-testid={`${prefix}-new-badge`}>
            <StatusBadge kind="new" testId={`${prefix}-new-badge-inner`} />
          </span>
        )}
      </Box>

      {showSummary && item.summary && (
        <Box
          data-testid={`${prefix}-summary`}
          className="line-clamp-2"
          sx={{
            display: { xs: 'none', md: '-webkit-box' },
            color: tokens.surface.text2,
            fontSize: tokens.fs.sm,
            lineHeight: tokens.lh.base,
            mt: 1,
          }}
        >
          {item.summary}
        </Box>
      )}

      <Box
        sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1, mt: 1.5, fontSize: tokens.fs.xs }}
      >
        {channelHomepage ? (
          <Link
            href={channelHomepage}
            target="_blank"
            rel="noopener noreferrer"
            underline="hover"
            sx={{ color: tokens.surface.text2, fontSize: tokens.fs.xs }}
          >
            {item.channelName}
          </Link>
        ) : (
          <span style={{ color: tokens.surface.text2 }}>{item.channelName}</span>
        )}

        {item.category.map((key) => (
          <Chip
            key={key}
            data-testid={`${prefix}-cat`}
            data-category={key}
            size="small"
            label={categoryLabel(key)}
            sx={{
              bgcolor: `${categoryColor(key)}1a`,
              color: categoryColor(key),
              border: `1px solid ${categoryColor(key)}33`,
              height: 20,
            }}
          />
        ))}

        <Tooltip title={formatAbsolute(item.publishedAt)}>
          <span data-testid={`${prefix}-published`} style={{ color: tokens.surface.text3 }}>
            创建 {formatRelative(item.publishedAt)}
          </span>
        </Tooltip>
        <Tooltip title={formatAbsolute(item.updatedAt)}>
          <span style={{ color: tokens.surface.text3 }}>更新 {formatRelative(item.updatedAt)}</span>
        </Tooltip>

        {badgeKind && (
          <StatusBadge
            kind={badgeKind}
            testId={`${prefix}-status-badge`}
            title={badgeKind === 'source-dead' ? '原地址已失效，已切换备用地址' : undefined}
          />
        )}

        {sourceCount > 1 && (
          <span data-testid={`${prefix}-sources-toggle`}>
            <StatusBadge
              kind="sources"
              count={sourceCount}
              expanded={showSources}
              onClick={() => setShowSources((v) => !v)}
              testId={`${prefix}-sources-toggle-inner`}
            />
          </span>
        )}
      </Box>

      {showSources && sourceCount > 1 && item.sources && item.sources.length > 0 && (
        <Box
          data-testid={`${prefix}-sources-panel`}
          sx={{
            mt: 1,
            p: 1,
            bgcolor: tokens.surface.sunken,
            borderRadius: tokens.radius.sm,
            fontSize: tokens.fs.xs,
            color: tokens.surface.text2,
          }}
        >
          该条内容被 {sourceCount} 个渠道报道：
          <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
            {item.sources.map((s) => (
              <li key={`${s.channelId}-${s.url}`}>
                <span>{s.channelName}</span>
                {' · '}
                <Link href={s.url} target="_blank" rel="noopener noreferrer" underline="hover">
                  原文
                </Link>
                {s.publishedAt ? <span> · {formatRelative(s.publishedAt)}</span> : null}
              </li>
            ))}
          </ul>
        </Box>
      )}

      <Box sx={{ display: 'flex', gap: 1, mt: 1.5 }}>
        {isDead && !hasAlternate ? (
          <Button data-testid={`${prefix}-link-dead`} size="small" variant="outlined" disabled>
            已失效
          </Button>
        ) : (
          <Button
            data-testid={`${prefix}-link`}
            size="small"
            variant="outlined"
            href={item.href}
            target="_blank"
            rel="noopener noreferrer"
          >
            原文
          </Button>
        )}
        {channelHomepage && (
          <Button
            data-testid={`${prefix}-channel-home`}
            size="small"
            variant="text"
            href={channelHomepage}
            target="_blank"
            rel="noopener noreferrer"
          >
            渠道主页
          </Button>
        )}
      </Box>
    </Box>
  );
}
