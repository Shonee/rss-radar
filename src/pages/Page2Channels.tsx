// T-P3-04 — 页面2：渠道分栏看板（PRD §6.2）
//
// 功能：
//   - 响应式栅格，断点严格对齐 QA 报告 §2.2：
//       1600/1440 → 4 列；1280 → 3 列；1024 → 2 列；768 → 2 列；375 → 1 列
//   - 配置抽屉（展示渠道 / 每卡片条数默认 10 / 卡片排序），配置写 localStorage 跨会话生效
//   - 渠道健康四态：ok / failed（抓取失败灰化）/ disabled（停用）/ empty（暂无内容）
//   - 卡片内「查看全部 →」跳页面1 并按该渠道过滤
//   - 分类筛选 chips + 卡片排序（按最近更新 / 按渠道名）
//
// 数据来源：config/sources.json（渠道/源元数据）+ snapshot.items（当日条目）。

import { useEffect, useMemo, useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import useMediaQuery from '@mui/material/useMediaQuery';

import type { CategoryKey, Item } from '../types';
import { toItemCardData, type ChannelCardData, type ChannelHealth } from '../types/api';
import sourcesConfig from '../../config/sources.json';
import { categoryLabel } from '../config/categories';
import { useSnapshot } from '../hooks';
import { categoryColor, tokens } from '../theme/tokens';
import {
  ChannelCard,
  ConfigDrawer,
  EmptyState,
  ErrorBanner,
  SkeletonList,
  type ChannelSortKey,
  type ConfigDrawerValue,
} from '../components';

interface RawChannel {
  id: string;
  name: string;
  homepage: string;
  category: string[];
  enabled?: boolean;
  icon?: string;
}

interface RawSource {
  channelId: string;
  url: string;
}

const CHANNELS = sourcesConfig.channels as unknown as RawChannel[];
const SOURCES = sourcesConfig.sources as unknown as RawSource[];
const FEED_BY_CHANNEL = new Map<string, string>();
for (const s of SOURCES) if (!FEED_BY_CHANNEL.has(s.channelId)) FEED_BY_CHANNEL.set(s.channelId, s.url);

// ---------- 页面配置持久化（自包含，file:// / 隐私模式容错） ----------

const P2_STORAGE_KEY = 'rss-radar:page2-config';

interface Page2Config {
  /** null = 全部启用渠道 */
  channelIds: string[] | null;
  cardLimit: number;
  sort: ChannelSortKey;
  /** 用户是否在抽屉里显式设置过条数（显式值优先于移动端降级） */
  cardLimitUserSet: boolean;
}

const DEFAULT_P2_CONFIG: Page2Config = {
  channelIds: null,
  cardLimit: 10,
  sort: 'updatedAt',
  cardLimitUserSet: false,
};

function loadPage2Config(): Page2Config {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return DEFAULT_P2_CONFIG;
    const raw = window.localStorage.getItem(P2_STORAGE_KEY);
    if (!raw) return DEFAULT_P2_CONFIG;
    const parsed = JSON.parse(raw) as Partial<Page2Config>;
    const sort: ChannelSortKey = parsed.sort === 'channelName' ? 'channelName' : 'updatedAt';
    const cardLimit =
      typeof parsed.cardLimit === 'number' && parsed.cardLimit > 0
        ? Math.floor(parsed.cardLimit)
        : DEFAULT_P2_CONFIG.cardLimit;
    const channelIds = Array.isArray(parsed.channelIds)
      ? parsed.channelIds.filter((x): x is string => typeof x === 'string')
      : null;
    return {
      channelIds: channelIds && channelIds.length > 0 ? channelIds : null,
      cardLimit,
      sort,
      cardLimitUserSet: parsed.cardLimitUserSet === true,
    };
  } catch {
    return DEFAULT_P2_CONFIG;
  }
}

function savePage2Config(cfg: Page2Config): void {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    window.localStorage.setItem(P2_STORAGE_KEY, JSON.stringify(cfg));
  } catch {
    /* 忽略配额 / 禁用 */
  }
}

function resolveColumns(is1440: boolean, is1280: boolean, is1024: boolean, is768: boolean): number {
  if (is1440) return 4;
  if (is1280) return 3;
  if (is1024) return 2;
  if (is768) return 2;
  return 1;
}

export default function Page2Channels() {
  const { data: snap, loading, error, reload } = useSnapshot();

  const [config, setConfig] = useState<Page2Config>(() => loadPage2Config());
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [catFilter, setCatFilter] = useState<CategoryKey | null>(null);

  const is1440 = useMediaQuery('(min-width: 1440px)');
  const is1280 = useMediaQuery('(min-width: 1280px)');
  const is1024 = useMediaQuery('(min-width: 1024px)');
  const is768 = useMediaQuery('(min-width: 768px)');
  const isMobile = useMediaQuery('(max-width: 767px)');
  const columns = resolveColumns(is1440, is1280, is1024, is768);

  // 配置变更即持久化
  useEffect(() => {
    savePage2Config(config);
  }, [config]);

  const categories = useMemo<CategoryKey[]>(() => {
    const set = new Set<CategoryKey>();
    for (const ch of CHANNELS) for (const c of (ch.category ?? []) as CategoryKey[]) set.add(c);
    return [...set];
  }, []);

  const allItems = useMemo<Item[]>(
    () => (snap?.items ?? []).filter((it) => !it.duplicateOf),
    [snap],
  );

  const okByChannel = useMemo<Map<string, boolean>>(() => {
    const m = new Map<string, boolean>();
    // T-P3-fix：优先用逐源健康度 stats.sourceHealth[]（一个渠道可能有多个源，
    // 任一源失败即视为该渠道失败）；无该字段时回落 stats.sources[].ok（历史预留，
    // 生产路径并不产出 → 此时不写入，行为与本轮修复前一致）。
    const health = snap?.stats?.sourceHealth;
    if (Array.isArray(health) && health.length > 0) {
      for (const h of health) {
        const prev = m.get(h.channelId);
        m.set(h.channelId, (prev ?? true) && h.ok);
      }
      return m;
    }
    for (const s of snap?.stats?.sources ?? []) {
      if (typeof s.ok === 'boolean') m.set(s.channelId, s.ok);
    }
    return m;
  }, [snap]);

  const cards = useMemo<ChannelCardData[]>(() => {
    const selected = config.channelIds;
    let base = CHANNELS.slice();
    if (selected === null) {
      base = base.filter((c) => c.enabled !== false);
    } else {
      base = base.filter((c) => selected.includes(c.id));
    }
    if (catFilter) {
      base = base.filter((c) => ((c.category ?? []) as CategoryKey[]).includes(catFilter));
    }

    const built = base.map<ChannelCardData>((ch) => {
      const chItems = allItems
        .filter((it) => it.channelId === ch.id)
        .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
      const statOk = okByChannel.get(ch.id);
      const health: ChannelHealth =
        ch.enabled === false
          ? 'disabled'
          : statOk === false
            ? 'failed'
            : chItems.length === 0
              ? 'empty'
              : 'ok';
      return {
        channelId: ch.id,
        channelName: ch.name,
        icon: ch.icon,
        homepage: ch.homepage,
        feedUrl: FEED_BY_CHANNEL.get(ch.id),
        categories: (ch.category ?? []) as CategoryKey[],
        lastUpdatedAt: chItems[0]?.updatedAt ?? null,
        todayCount: chItems.length,
        health,
        items: chItems.map(toItemCardData),
      };
    });

    built.sort((a, b) => {
      if (config.sort === 'channelName') return a.channelName < b.channelName ? -1 : a.channelName > b.channelName ? 1 : 0;
      const av = a.lastUpdatedAt ?? '';
      const bv = b.lastUpdatedAt ?? '';
      if (av !== bv) return av < bv ? 1 : -1; // 最近更新倒序
      return a.channelName < b.channelName ? -1 : 1;
    });
    return built;
  }, [config.channelIds, config.sort, catFilter, allItems, okByChannel]);

  const effectiveCardLimit = isMobile && !config.cardLimitUserSet ? 5 : config.cardLimit;

  const drawerValue: ConfigDrawerValue = {
    channelIds: config.channelIds,
    cardLimit: config.cardLimit,
    sort: config.sort,
  };

  const handleDrawerChange = (v: ConfigDrawerValue): void => {
    setConfig((prev) => ({
      channelIds: v.channelIds,
      cardLimit: v.cardLimit,
      sort: v.sort,
      cardLimitUserSet: v.cardLimit !== prev.cardLimit ? true : prev.cardLimitUserSet,
    }));
  };

  const header = (
    <Box
      data-testid="p2-header"
      sx={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 2,
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        mb: 2,
      }}
    >
      <Box sx={{ minWidth: 0 }}>
        <Box component="h1" sx={{ m: 0, fontSize: tokens.fs['2xl'], fontWeight: tokens.fw.semibold }}>
          渠道看板
        </Box>
        <Box sx={{ color: tokens.surface.text2, fontSize: tokens.fs.sm, mt: 0.5 }}>
          每个渠道一张卡片，专注看单渠道动态。共 <strong>{CHANNELS.length}</strong> 个渠道，当前展示{' '}
          <strong data-testid="p2-shown-count">{cards.length}</strong> 个。
        </Box>
      </Box>
      <Button
        data-testid="p2-open-config"
        variant="contained"
        onClick={() => setDrawerOpen(true)}
        sx={{ flex: '0 0 auto' }}
      >
        配置
      </Button>
    </Box>
  );

  const controls = (
    <Box
      sx={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: 1,
        mb: 2,
      }}
    >
      <Box role="group" aria-label="按分类筛选渠道" sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
        <Chip
          data-testid="p2-cat-all"
          data-cat=""
          size="small"
          label="全部分类"
          variant={catFilter === null ? 'filled' : 'outlined'}
          color={catFilter === null ? 'primary' : 'default'}
          onClick={() => setCatFilter(null)}
        />
        {categories.map((key) => (
          <Chip
            key={key}
            data-testid={`p2-cat-${key}`}
            data-cat={key}
            size="small"
            label={categoryLabel(key)}
            variant={catFilter === key ? 'filled' : 'outlined'}
            onClick={() => setCatFilter((prev) => (prev === key ? null : key))}
            sx={
              catFilter === key
                ? { bgcolor: categoryColor(key), color: '#fff' }
                : { borderColor: categoryColor(key), color: categoryColor(key) }
            }
          />
        ))}
      </Box>

      <ToggleButtonGroup
        data-testid="p2-sort"
        exclusive
        size="small"
        value={config.sort}
        onChange={(_e, next: ChannelSortKey | null) => {
          if (next) setConfig((prev) => ({ ...prev, sort: next }));
        }}
        sx={{ ml: 'auto' }}
      >
        <ToggleButton value="updatedAt" data-testid="p2-sort-updated">
          按最近更新
        </ToggleButton>
        <ToggleButton value="channelName" data-testid="p2-sort-name">
          按渠道名
        </ToggleButton>
      </ToggleButtonGroup>
    </Box>
  );

  let body: JSX.Element;
  if (loading) {
    body = <SkeletonList count={4} testId="p2-skeleton" />;
  } else if (error) {
    body = <ErrorBanner message={`数据加载失败：${error}`} onRetry={reload} testId="p2-error" />;
  } else if (cards.length === 0) {
    body = (
      <EmptyState
        title="没有可展示的渠道"
        description="当前分类筛选或配置下没有渠道。点击右上角「配置」选择要展示的渠道，或切换分类。"
        action={
          <Button variant="contained" onClick={() => setDrawerOpen(true)} data-testid="p2-empty-config">
            打开配置
          </Button>
        }
        testId="p2-empty"
      />
    );
  } else {
    body = (
      <Box
        data-testid="p2-board"
        data-columns={columns}
        sx={{
          display: 'grid',
          gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
          gap: 2,
          alignItems: 'start',
          minWidth: 0,
        }}
      >
        {cards.map((c) => (
          <ChannelCard key={c.channelId} channel={c} cardLimit={effectiveCardLimit} />
        ))}
      </Box>
    );
  }

  return (
    <Box data-testid="p2-root" data-component="page2-channels">
      {header}
      {controls}
      {body}

      <ConfigDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        channels={CHANNELS.map((c) => ({
          id: c.id,
          name: c.name,
          category: (c.category ?? []) as CategoryKey[],
        }))}
        value={drawerValue}
        onChange={handleDrawerChange}
        onReset={() => setConfig({ ...DEFAULT_P2_CONFIG })}
      />
    </Box>
  );
}
