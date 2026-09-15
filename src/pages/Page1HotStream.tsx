// T-P3-03 — 页面1：聚合热榜流（PRD §6.1）
//
// 功能：
//   - 顶部数据状态条（最近更新 / 共 N 渠道 / 今日 M 条 / 涉及 K 分类）`p1-statbar`
//   - 异常态黄条：warning（抓取失败渠道）+ info（数据可能非最新）
//   - 排序：**固定整合倒序**，无切换入口（主理人 2026-09 拍板口径）
//     比较键恒为 `updatedAt || publishedAt`（优先更新时间，缺失 / 回落用创建时间），整体倒序；
//     同值按「渠道名升序 → id 升序」稳定尾序
//   - 筛选（渠道 / 分类 / 时间范围 / 搜索，复用 FilterBar）
//   - 响应式筛选布局（主理人 2026-09-15 拍板改版）：**取消 248px 左栏**，筛选条横贯顶部。
//     原因：FilterBar 本身是横向 flex-wrap 条（页面2/3/4 亦如此），塞进 248px 窄栏会被迫竖排堆叠、
//     下方留一大片空白。现在 ≥1024px 单列顶部常驻（sticky 吸附在页头之下）；
//     ≤1023px 折叠，用 `p1-filter-toggle` 按钮展开（`p1-filter-panel` 面板），开关置于面板上方。
//   - 懒加载：桌面每批 20、移动每批 10；滚动到底自动加载 + `p1-load-more` 手动加载
//   - 深链 `?channel=<id>` 直达（配合页面2「查看全部」）
//   - file:// 外链修复由 AppShell 统一处理

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import useMediaQuery from '@mui/material/useMediaQuery';

import type { CategoryKey, Item } from '../types';
import { toItemCardData } from '../types/api';
import sourcesConfig from '../../config/sources.json';
import { DEFAULT_PAGE1_BATCH_SIZE } from '../config/site';
import { useNotifyStats, useSnapshot } from '../hooks';
import { countByShanghaiDay, formatRelative, passesTimeRange } from '../services/time';
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

/**
 * 整合倒序比较器（唯一排序口径，无档位切换）。
 *
 * 排序键恒为 `updatedAt || publishedAt`：优先取更新时间，更新时间为空 / 缺失时回落创建时间；
 * 两条时间比较后整体倒序（新的在前）；同值时按渠道名升序、再按 id 升序保持稳定尾序。
 */
function compareByRecencyDesc(a: Item, b: Item): number {
  const av = a.updatedAt || a.publishedAt;
  const bv = b.updatedAt || b.publishedAt;
  if (av !== bv) return av < bv ? 1 : -1; // 倒序
  const an = a.channelName || '';
  const bn = b.channelName || '';
  if (an !== bn) return an < bn ? -1 : 1;
  if (a.id === b.id) return 0;
  return a.id < b.id ? -1 : 1;
}

export default function Page1HotStream() {
  const [searchParams] = useSearchParams();
  const channelParam = searchParams.get('channel');

  const { data: snap, loading, error, stale, source, reload } = useSnapshot();
  // T-P3-08：页面1 底部只读通知状态面板（折叠；ARCH §12 硬约束：无发送入口）
  const { data: notifyStats, loading: notifyLoading } = useNotifyStats();

  const isMobile = useMediaQuery('(max-width: 767px)');
  const batch = isMobile ? 10 : DEFAULT_PAGE1_BATCH_SIZE;

  // 响应式筛选布局（PRD §6.1 / 原型 .layout-split + .side-collapsible）：
  //   ≥1024px → 左侧 248px 粘性筛选栏；≤1023px → 单列 + 筛选栏默认折叠，用「筛选」按钮展开。
  // 断点与原型 @media (max-width: 1023px) 对齐；sticky top 用 tokens.headerH（= 原型 --header-h）。
  const isNarrow = useMediaQuery('(max-width: 1023px)');
  const [filterOpen, setFilterOpen] = useState(false);

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
    const snapDate = snap?.date ?? '';
    const list = mainItems.filter((it) => {
      if (chSet.size > 0 && !chSet.has(it.channelId)) return false;
      if (catSet.size > 0 && !(it.category ?? []).some((c) => catSet.has(c))) return false;
      // 时间档统一走纯函数 `passesTimeRange`（today / 6h / all 三态，'all' 恒通过）
      if (!passesTimeRange(it, filter.timeRange, { now, snapDate })) return false;
      if (q) {
        const hay = `${it.title} ${it.summary ?? ''} ${it.author ?? ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    list.sort(compareByRecencyDesc);
    return list;
  }, [mainItems, filter, snap]);

  // 筛选 / 断点变化时重置已展示条数（排序口径固定，不再有排序态）
  useEffect(() => {
    setLimit(batch);
  }, [filter, batch]);

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
  // 「今日 M 条」= 页面级今日条目派生计数，必须与列表「今天」分支同谓词
  // （updatedAt 优先回落 publishedAt + isSameShanghaiDay）。
  // ⚠ 不能再用 report.totalItems：那是快照全量条目数、不含时间窗过滤。
  // 口径与筛选器状态无关（按 mainItems 全量统计，不受渠道/分类/搜索影响）。
  const todayCount = useMemo(
    () => (snap ? countByShanghaiDay(mainItems, snap.date) : 0),
    [mainItems, snap],
  );
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

  // 抓取失败渠道（T-P3-fix：读真实的逐源健康度）
  //   优先用 stats.sourceHealth[]（采集端 runPool 真实结果汇总）；
  //   老快照无该字段时回落到 stats.sources[].ok（历史预留字段）。
  //   去重：一个渠道可能有多个 source，渠道名只列一次。
  const failedChannels = useMemo<string[]>(() => {
    const names = new Set<string>();
    const health = snap?.stats?.sourceHealth;
    if (Array.isArray(health) && health.length > 0) {
      for (const h of health) {
        if (!h.ok) names.add(h.channelName || h.channelId || h.sourceId);
      }
      return Array.from(names);
    }
    for (const s of snap?.stats?.sources ?? []) {
      if (s.ok === false) names.add(s.channelName || s.channelId);
    }
    return Array.from(names);
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
      {/* ≤1023px：筛选折叠开关（原型 .mobile-filter-toggle；桌面隐藏） */}
      {isNarrow && (
        <Button
          data-testid="p1-filter-toggle"
          data-open={filterOpen ? 'true' : 'false'}
          aria-expanded={filterOpen}
          aria-controls="p1-filter-panel"
          variant="outlined"
          size="small"
          onClick={() => setFilterOpen((v) => !v)}
        >
          {filterOpen ? '收起筛选' : '筛选'}
        </Button>
      )}

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
            {filter.timeRange !== 'all' && (
              <Button
                variant="outlined"
                onClick={() => setFilter((prev) => ({ ...prev, timeRange: 'all' }))}
                data-testid="p1-show-all-time"
              >
                查看全部时段
              </Button>
            )}
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

      {/* 单列布局（主理人 2026-09-15 拍板：取消 248px 左栏，筛选条横贯顶部）。
          用 flex `order` 复用同一个 `p1-filter-panel` 节点，避免重复 id：
          - ≥1024px：筛选条(order 1) → 计数行(order 2) → 列表，筛选条 sticky 吸附页头之下
          - ≤1023px：[筛选]开关+计数(order 1) → 面板(order 2，折叠时 display:none) → 列表
            开关必须在面板之上，故用 order 换位而非复制节点 */}
      <Box
        data-testid="p1-layout"
        sx={{
          display: 'flex',
          flexDirection: 'column',
          minWidth: 0,
        }}
      >
        {/* 筛选栏（原 .side 左栏已取消；桌面常驻且粘性，窄屏默认折叠由「筛选」按钮控制显隐） */}
        <Box
          component="aside"
          id="p1-filter-panel"
          data-testid="p1-filter-panel"
          aria-label="筛选条件"
          data-open={isNarrow ? (filterOpen ? 'true' : 'false') : 'true'}
          sx={{
            order: isNarrow ? 2 : 1,
            mb: 1.5,
            minWidth: 0,
            ...(isNarrow
              ? { display: filterOpen ? 'block' : 'none' }
              : {
                  position: 'sticky',
                  top: `calc(${tokens.headerH} + ${tokens.space[4]})`,
                  zIndex: 2,
                }),
          }}
        >
          <FilterBar value={filter} onChange={setFilter} channels={CHANNEL_OPTIONS} />
        </Box>

        {/* 计数行（窄屏还含「筛选」开关，故在面板之上） */}
        <Box sx={{ order: isNarrow ? 1 : 2 }}>{toolbar}</Box>

        <Box component="section" aria-label="条目列表" sx={{ minWidth: 0, order: 3 }}>
          {body}
        </Box>
      </Box>

      {/* T-P3-08：底部只读通知状态面板（可折叠，默认收起） */}
      {!notifyLoading && notifyStats && (
        <Box data-testid="p1-notify-section" sx={{ mt: 3 }}>
          <NotifyStatusPanel stats={notifyStats} testId="p1-notify-panel" />
        </Box>
      )}
    </Box>
  );
}
