// T-P3-02 公共组件库 — 渠道卡片（页面2 看板）
//
// 头像（icon 或首字母）、渠道名（链首页）、分类标签、Feed 地址（右上角源图标，hover 显示）、
// 最后更新时间、今日条数、条目列表（最多 cardLimit 条）、健康角标、「查看全部 →」、失败渠道灰化。

import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Link from '@mui/material/Link';
import Tooltip from '@mui/material/Tooltip';
import type { ChannelCardData } from '../types';
import { categoryLabel } from '../config/categories';
import { categoryColor, tokens } from '../theme/tokens';
import { formatRelative } from '../services/time';
import StatusBadge, { healthToKind } from './StatusBadge';

export interface ChannelCardProps {
  channel: ChannelCardData;
  /** 条目列表上限（来自 display.cardLimit） */
  cardLimit?: number;
  testId?: string;
}

export default function ChannelCard({ channel, cardLimit = 10, testId = 'channel-card' }: ChannelCardProps) {
  const isFailed = channel.health === 'failed' || channel.health === 'disabled';
  const shown = channel.items.slice(0, cardLimit);
  const badgeKind = healthToKind(channel.health);
  const initial = channel.channelName.slice(0, 1);

  return (
    <Box
      component="article"
      data-testid={testId}
      data-component="channel-card"
      data-channel-id={channel.channelId}
      data-health={channel.health}
      sx={{
        border: `1px solid ${tokens.surface.border}`,
        borderRadius: tokens.radius.md,
        bgcolor: tokens.surface.surface,
        p: 2,
        opacity: isFailed ? 0.6 : 1,
        filter: isFailed ? 'grayscale(0.4)' : 'none',
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5 }}>
        <Box
          aria-hidden
          sx={{
            width: 36,
            height: 36,
            flex: '0 0 auto',
            borderRadius: tokens.radius.full,
            bgcolor: tokens.primary.weak,
            color: tokens.primary.active,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontWeight: 600,
          }}
        >
          {channel.icon || initial}
        </Box>

        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Link
            data-testid="channel-card-name"
            href={channel.homepage}
            target="_blank"
            rel="noopener noreferrer"
            underline="hover"
            sx={{ fontWeight: 600, fontSize: tokens.fs.lg, color: tokens.surface.text }}
          >
            {channel.channelName}
          </Link>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 0.5, alignItems: 'center' }}>
            {channel.categories.map((key) => (
              <Chip
                key={key}
                data-testid="channel-card-cat"
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
            {badgeKind && <StatusBadge kind={badgeKind} testId="channel-card-health" />}
          </Box>
        </Box>

        {channel.feedUrl && (
          <Tooltip title={`Feed 源地址：${channel.feedUrl}`}>
            <Box
              data-testid="channel-card-feed"
              data-feed-url={channel.feedUrl}
              sx={{ color: tokens.surface.text3, cursor: 'help', fontSize: tokens.fs.xs }}
            >
              源
            </Box>
          </Tooltip>
        )}
      </Box>

      <Box
        sx={{
          display: 'flex',
          gap: 2,
          mt: 1.5,
          fontSize: tokens.fs.xs,
          color: tokens.surface.text2,
        }}
      >
        <span>
          最后更新：
          <strong>
            {channel.lastUpdatedAt ? formatRelative(channel.lastUpdatedAt) : '—'}
          </strong>
        </span>
        <span>
          今日 <strong>{channel.todayCount}</strong> 条
        </span>
      </Box>

      <Box sx={{ mt: 1.5 }}>
        {shown.length > 0 ? (
          shown.map((it) => {
            const dead = it.status === 'dead' && (it.alternateUrl === null || it.alternateUrl === '');
            return (
              <Link
                key={it.id}
                data-testid="channel-card-item"
                data-item-id={it.id}
                href={it.href}
                target="_blank"
                rel="noopener noreferrer"
                underline="hover"
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 1,
                  py: 0.75,
                  borderBottom: `1px solid ${tokens.surface.border}`,
                  color: dead ? tokens.surface.text3 : tokens.surface.text,
                  textDecoration: dead ? 'line-through' : 'none',
                  fontSize: tokens.fs.sm,
                }}
              >
                <span className="line-clamp-1" style={{ minWidth: 0 }}>
                  {it.title}
                </span>
                <span style={{ flex: '0 0 auto', color: tokens.surface.text3, fontSize: tokens.fs.xs }}>
                  {formatRelative(it.updatedAt)}
                  {it.sourceCount > 1 ? ` · ＋${it.sourceCount - 1} 源` : ''}
                </span>
              </Link>
            );
          })
        ) : (
          <Box sx={{ py: 3, textAlign: 'center', color: tokens.surface.text3, fontSize: tokens.fs.sm }}>
            暂无内容
          </Box>
        )}
      </Box>

      {channel.items.length > cardLimit && (
        <Box sx={{ mt: 1.5 }}>
          <Link
            data-testid="channel-card-more"
            href={`/#/?channel=${encodeURIComponent(channel.channelId)}`}
            underline="hover"
            sx={{ fontSize: tokens.fs.sm }}
          >
            查看全部 {channel.items.length} 条 →
          </Link>
        </Box>
      )}
    </Box>
  );
}
