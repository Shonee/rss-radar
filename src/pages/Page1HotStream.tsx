// T-P3-03 — 页面1：聚合热榜流（PRD §6.1）
//
// 功能：
//   - 顶部数据状态条（最近更新 / 共 N 渠道 / 今日 M 条 / 涉及 K 分类）`p1-statbar`
//   - 异常态黄条：warning（抓取失败渠道）+ info（数据可能非最新）
//   - 排序切换：默认「综合倒序」（updatedAt 优先、回落 publishedAt，同值按渠道名稳定）
//     `p1-sort-updated` / `p1-sort-published`
//   - 筛选（渠道 / 分类 / 时间范围 / 搜索，复用 FilterBar）
//   - 懒加载：桌面每批 20、移动每批 10；滚动到底自动加载 + `p1-load-more` 手动加载
//   - 深链 `?channel=<id>` 直达（配合页面2「查看全部」）
//   - file:// 外链修复由 AppShell 统一处理

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import useMediaQuery from '@mui/material/useMediaQuery';

import type { CategoryKey, Item } from '../types';
import { toItemCardData } from '../types/api';
import sourcesConfig from '../../config/sources.json';
import { DEFAULT_PAGE1_BATCH_SIZE } from '../config/site';
import { useNotifyStats, useReport, useSnapshot } from '../hooks';
import { isSameShanghaiDay, formatRelative } from '../services/time';
import { tokens } from '../theme/tokens';
import {
  AlertBar,
  EmptyState,
  ErrorBanner,
  FilterBar,
  ItemCard,
  NotifyStatusPanel,
  SkeletonList,
  EMPTY_FILTER,
  type ChannelOption,
  type FilterValue,
} from '../components';

type SortMode = 'updatedAt' | 'publishedAt';

interface RawChannel {
  id: string;
  name: string;
  homepage: string;
  category: string[];
  enabled?: boolean;
}

const CHANNELS = sourcesConfig.channels as unknown as RawChannel[];

const CHANNEL_OPTIONS: ChannelOption[] = CHANNELS.filter((c) => c.enabled !== false).map((c) => ({
  id: c.id,
  name: c.name,
  category: (c.category ?? []) as CategoryKey[],
}));

const HOMEPAGE_BY_CHANNEL = new Map<string, string>(CHANNELS.map((c) => [c.id, c.homepage]));

const SOURCE_LABEL: Record<string, string> = {
  raw: '源站',
  jsdelivr: 'CDN 回退',
  local: '本地缓存',
};

const HOUR_MS = 3_600_000;

/** 综合倒序比较器：sort 键优先，同值回落另一时间键，再按渠道名稳定，最后按 id。 */
function makeComparator(sort: SortMode): (a: Item, b: Item) => number {
  return (a: Item, b: Item): number => {
    const av = sort === 'updatedAt' ? a.updatedAt || a.publishedAt : a.publishedAt || a.updatedAt;
    const bv = sort === 'updatedAt' ? b.updatedAt || b.publishedAt : b.publishedAt || b.updatedAt;
    if (av !== bv) return av < bv ? 1 : -1; // 倒序
    const an = a.channelName || '';
    const bn = b.channelName || '';
    if (an !== bn) return an < bn ? -1 : 1;
    if (a.id === b.id) return 0;
    return a.id < b.id ? -1 : 1;
  };
}

export default function Page1HotStream() {
  const [searchParams] = useSearchParams();
  const channelParam = searchParams.get('channel');

  const { data: snap, loading, error, stale, source, reload } = useSnapshot();
  const { data: report } = useReport();
  // T-P3-08：页面1 底部只读通知状态面板（折叠；ARCH §12 硬约束：无发送入口）
  const { data: notifyStats, loading: notifyLoading } = useNotifyStats();

  const isMobile = useMediaQuery('(max-width: 767px)');
  const batch = isMobile ? 10 : DEFAULT_PAGE1_BATCH_SIZE;

  const [sort, setSort] = useState<SortMode>('updatedAt');
  const [filter, setFilter] = useState<FilterValue>(() =>
    channelParam ? { ...EMPTY_FILTER, channelIds: [channelParam] } : EMPTY_FILTER,
  );
  const [limit, setLimit] = useState<number>(batch);

  // 深链 ?channel= 同步（页面加载 / 参数变化时）
  useEffect(() => {
    if (!channelParam) return;
    setFilter((prev) =>
      prev.channelIds.length === 1 && prev.channelIds[0] === channelParam
        ? prev
        : { ...prev, channelIds: [channelParam] },
    );
  }, [channelParam]);

  // 主条目（排除 duplicateOf 指向别处的重复项，与采集端去重口径一致）
  const mainItems = useMemo<Item[]>(
    () => (snap?.items ?? []).filter((it) => !it.duplicateOf),
    [snap],
  );

  const filtered = useMemo<Item[]>(() => {
    const now = Date.now();
    const q = filter.query.trim().toLowerCase();
    const chSet = new Set(filter.channelIds);
    const catSet = new Set<CategoryKey>(filter.categories);
    const list = mainItems.filter((it) => {
      if (chSet.size > 0 && !chSet.has(it.channelId)) return false;
      if (catSet.size > 0 && !(it.category ?? []).some((c) => catSet.has(c))) return false;
      if (filter.timeRange === 'today') {
        if (!snap || !isSameShanghaiDay(it.updatedAt || it.publishedAt, snap.date)) return false;
      } else {
        const hours = filter.timeRange === '3h' ? 3 : 6;
        const t = new Date(it.updatedAt || it.publishedAt).getTime();
        if (Number.isNaN(t) || now - t > hours * HOUR_MS) return false;
      }
      if (q) {
        const hay = `${it.title} ${it.summary ?? ''} ${it.author ?? ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    list.sort(makeComparator(sort));
    return list;
  }, [mainItems, filter, sort, snap]);

  // 筛选 / 排序 / 断点变化时重置已展示条数
  useEffect(() => {
    setLimit(batch);
  }, [filter, sort, batch]);

  const visible = useMemo(() => filtered.slice(0, Math.max(limit, 0)), [filtered, limit]);

  // 滚动到底自动加载（IntersectionObserver 哨兵）
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return undefined;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setLimit((l) => (l < filtered.length ? Math.min(l + batch, filtered.length) : l));
        }
      },
      { rootMargin: '200px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [filtered.length, batch]);

  const loadMore = useCallback((): void => {
    setLimit((l) => Math.min(l + batch, filtered.length));
  }, [batch, filtered.length]);

  const clearFilters = useCallback((): void => setFilter(EMPTY_FILTER), []);

  // ---------- 状态条 / 告警 ----------
  const enabledChannelCount = CHANNEL_OPTIONS.length;
  const todayCount = report?.totalItems ?? mainItems.length;
  const categoryCount = useMemo(() => {
    const set = new Set<CategoryKey>();
    for (const it of mainItems) for (const c of it.category ?? []) set.add(c);
    return set.size;
  }, [mainItems]);
  const lastUpdated = useMemo(() => {
    let max = '';
    for (const it of mainItems) {
      const v = it.updatedAt || it.publishedAt;
      if (v && v > max) max = v;
    }
    return max;
  }, [mainItems]);

  const failedChannels = useMemo(() => {
    const stats = snap?.stats?.sources ?? [];
    return stats.filter((s) => s.ok === false).map((s) => s.channelName || s.channelId);
  }, [snap]);

  // ---------- 渲染 ----------
  const header = (
    <Box sx={{ mb: 2 }}>
      <Box
        sx={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: 1,
        }}
      >
        <Box
          component="h1"
          sx={{ m: 0, fontSize: tokens.fs['2xl'], fontWeight: tokens.fw.semibold }}
        >
          当天聚合热榜流
        </Box>
        {snap && (
          <Box sx={{ color: tokens.surface.text3, fontSize: tokens.fs.sm }}>{snap.date}</Box>
        )}
      </Box>

      <Box
        data-testid="p1-statbar"
        sx={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 2,
          mt: 1,
          color: tokens.surface.text2,
          fontSize: tokens.fs.sm,
        }}
      >
        <span>
          最近更新：<strong>{lastUpdated ? formatRelative(lastUpdated) : '—'}</strong>
        </span>
        <span>
          共 <strong>{enabledChannelCount}</strong> 个渠道
        </span>
        <span>
          今日 <strong>{todayCount}</strong> 条
        </span>
        <span>
          涉及 <strong>{categoryCount}</strong> 个分类
        </span>
      </Box>
    </Box>
  );

  const alerts = (
    <Box sx={{ mb: 1 }}>
      {failedChannels.length > 0 && (
        <AlertBar severity="warning" testId="p1-alert-warning">
          {failedChannels.length} 个渠道本次抓取失败：{failedChannels.join('、')}
          。该渠道本次无入库条目，其余渠道数据正常，页面仍可正常浏览。
        </AlertBar>
      )}
      {stale && (
        <AlertBar severity="info" testId="p1-alert-info">
          数据可能非最新（来源：{source ? SOURCE_LABEL[source] ?? source : '本地缓存'}）。
        </AlertBar>
      )}
    </Box>
  );

  const toolbar = (
    <Box
      sx={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: 1.5,
        mb: 1.5,
      }}
    >
      <ToggleButtonGroup
        data-testid="p1-sort"
        exclusive
        size="small"
        value={sort}
        onChange={(_e, next: SortMode | null) => {
          if (next) setSort(next);
        }}
      >
        <ToggleButton value="updatedAt" data-testid="p1-sort-updated">
          综合倒序（更新时间）
        </ToggleButton>
        <ToggleButton value="publishedAt" data-testid="p1-sort-published">
          按创建时间
        </ToggleButton>
      </ToggleButtonGroup>

      <Box
        data-testid="p1-result-count"
        sx={{ ml: 'auto', color: tokens.surface.text2, fontSize: tokens.fs.sm }}
      >
        共 <strong>{filtered.length}</strong> 条符合当前条件
        {filtered.length > 0 && (
          <>
            ，已显示 <strong>{Math.min(limit, filtered.length)}</strong> 条
          </>
        )}
      </Box>
    </Box>
  );

  const filters = (
    <Box sx={{ mb: 2 }}>
      <FilterBar value={filter} onChange={setFilter} channels={CHANNEL_OPTIONS} />
    </Box>
  );

  let body: JSX.Element;
  if (loading) {
    body = <SkeletonList count={4} testId="p1-skeleton" />;
  } else if (error) {
    body = <ErrorBanner message={`数据加载失败：${error}`} onRetry={reload} testId="p1-error" />;
  } else if (!snap) {
    body = (
      <EmptyState
        title="暂无采集数据"
        description="尚未取到当日快照。请检查数据分支是否已生成，或等待下一次采集后重试。"
        action={
          <Button component={Link} to="/channels" variant="contained" data-testid="p1-goto-channels">
            前往渠道看板
          </Button>
        }
        testId="p1-empty"
      />
    );
  } else if (filtered.length === 0) {
    body = (
      <EmptyState
        title="暂无数据"
        description="当前筛选条件下没有条目。请放宽筛选条件，或等待下一次采集。"
        action={
          <Box sx={{ display: 'flex', gap: 1, justifyContent: 'center', flexWrap: 'wrap' }}>
            <Button variant="outlined" onClick={clearFilters} data-testid="p1-clear-filters">
              清除全部筛选
            </Button>
            <Button component={Link} to="/channels" variant="contained">
              前往渠道看板
            </Button>
          </Box>
        }
        testId="p1-empty-filter"
      />
    );
  } else {
    body = (
      <>
        <Box data-testid="p1-list" sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {visible.map((it) => (
            <ItemCard
              key={it.id}
              item={toItemCardData(it)}
              prefix="p1"
              channelHomepage={HOMEPAGE_BY_CHANNEL.get(it.channelId)}
            />
          ))}
        </Box>

        <Box ref={sentinelRef} sx={{ height: 1 }} aria-hidden />

        <Box data-testid="p1-pager" sx={{ textAlign: 'center', mt: 2 }}>
          {visible.length < filtered.length ? (
            <Button
              data-testid="p1-load-more"
              variant="contained"
              onClick={loadMore}
            >
              加载更多（剩余 {filtered.length - visible.length} 条）
            </Button>
          ) : (
            <Box sx={{ color: tokens.surface.text3, fontSize: tokens.fs.sm }} data-testid="p1-pager-end">
              — 已到底部，共 {filtered.length} 条 —
            </Box>
          )}
        </Box>
      </>
    );
  }

  return (
    <Box data-testid="p1-root" data-component="page1-hot-stream">
      {header}
      {alerts}
      {filters}
      {toolbar}
      {body}

      {/* T-P3-08：底部只读通知状态面板（可折叠，默认收起） */}
      {!notifyLoading && notifyStats && (
        <Box data-testid="p1-notify-section" sx={{ mt: 3 }}>
          <NotifyStatusPanel stats={notifyStats} testId="p1-notify-panel" />
        </Box>
      )}
    </Box>
  );
}
