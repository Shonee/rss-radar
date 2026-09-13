// T-P3-05 — 页面3：分析报告（严格只做当天，PRD §6.3）
//
// 消费 useReport()（当天 report-<date>.json）。缺失 → 空态「报告生成中，请稍候」。
// 版块（对齐 prototype/page3.js + PRD §6.3）：
//   1. 头部 hero：RSS 日报 · <date> / 生成时间 / 数据覆盖（渠道·条数）/ 时间窗 / 时区 / 一句话摘要
//   2. 概要数字卡 p3-metric ×4：总条数 / 活跃渠道数 / 热点条数 / 涉及分类数
//   3. 热点榜 TOP10（p3-hot-row）：名次 + 标题外链 + 热度进度条 + 来源数 + 分类
//   4. 分类分布饼图（chart-pie / p3-pie）+ 分类分栏（p3-cat-col）；占比按最大余数法凑 100%
//   5. 渠道活跃度排行 BarChart
//   6. 跨源重合榜（PRD §6.3:613 / F-063，prototype 遗漏的 QA 缺陷 #9 → 本轮补齐）
//   7. 方法论 <details>（权重表）+ 版权 + 「查看历史趋势 →」（→ /#/history）
//
// 死链策略（ARCH §15.4）：热点榜保留 dead 条目（仅链接行为降级由 ItemCard/外链统一处理）。

import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import LinkMui from '@mui/material/Link';
import Typography from '@mui/material/Typography';

import type { CategoryKey, HotItem, Item } from '../types';
import { useReport, useSnapshot } from '../hooks';
import { EmptyState, ErrorBanner, SkeletonList, PieChart, BarChart } from '../components';
import { categoryLabel } from '../config/categories';
import { DATA_WEIGHTS } from '../config/site';
import { categoryColor, tokens } from '../theme/tokens';
import { formatAbsolute } from '../services/time';
import siteConfigJson from '../../config/site-config.json';

const SITE_FOOTER = (siteConfigJson.site?.footer as string | undefined) ?? '';

/** 最大余数法：把一组计数换算为「总和恰为 100」的整数百分比（避免各自 round 后不足/超 100）。 */
export function integerPercentages(values: number[]): number[] {
  const total = values.reduce((a, v) => a + Math.max(v, 0), 0);
  if (total <= 0) return values.map(() => 0);
  const raw = values.map((v) => (Math.max(v, 0) / total) * 100);
  const floors = raw.map((r) => Math.floor(r));
  let remainder = 100 - floors.reduce((a, v) => a + v, 0);
  const order = raw
    .map((r, i) => ({ i, frac: r - Math.floor(r) }))
    .sort((a, b) => b.frac - a.frac);
  const out = [...floors];
  for (const { i } of order) {
    if (remainder <= 0) break;
    out[i] = (out[i] ?? 0) + 1;
    remainder -= 1;
  }
  return out;
}

interface MetricCard {
  label: string;
  value: string | number;
  hint: string;
  testId: string;
}

export default function Page3Report() {
  const { data: report, loading, error, reload } = useReport();
  const { data: snap } = useSnapshot();

  const snapshotItems = useMemo<Item[]>(
    () => (snap?.items ?? []).filter((it) => !it.duplicateOf),
    [snap],
  );

  // id → 快照条目：用于热点榜解析 urlStatus / alternateUrl（死链降级，ARCH §15.4）
  const itemById = useMemo<Map<string, Item>>(
    () => new Map(snapshotItems.map((it) => [it.id, it])),
    [snapshotItems],
  );

  const categoryStats = report?.categoryStats ?? [];
  const catPercents = useMemo(
    () => integerPercentages(categoryStats.map((c) => c.itemCount)),
    [categoryStats],
  );
  const catTotal = useMemo(
    () => categoryStats.reduce((a, c) => a + c.itemCount, 0),
    [categoryStats],
  );

  // ---------- 加载 / 错误 / 空态 ----------
  if (loading) {
    return (
      <Box data-testid="p3-root" data-component="page3-report">
        <SkeletonList count={4} testId="p3-skeleton" />
      </Box>
    );
  }
  if (error) {
    return (
      <Box data-testid="p3-root" data-component="page3-report">
        <ErrorBanner message={`报告加载失败：${error}`} onRetry={reload} testId="p3-error" />
      </Box>
    );
  }
  if (!report) {
    return (
      <Box data-testid="p3-root" data-component="page3-report">
        <EmptyState
          title="报告生成中，请稍候"
          description="当天报告尚未生成（采集任务可能仍在进行）。报告只基于当天数据，跨天会重置。"
          action={
            <LinkMui component={Link} to="/history" data-testid="p3-empty-goto-history">
              查看历史趋势
            </LinkMui>
          }
          testId="p3-empty"
        />
      </Box>
    );
  }

  const hotCount = report.hotList.length;
  const metrics: MetricCard[] = [
    { label: '总条数（去重后）', value: report.totalItems, hint: '今日全渠道', testId: 'p3-metric-total' },
    { label: '活跃渠道数', value: report.activeChannels, hint: '今日有更新的渠道', testId: 'p3-metric-channels' },
    { label: '热点条数', value: hotCount, hint: `进入热点榜 TOP ${hotCount}`, testId: 'p3-metric-hot' },
    { label: '涉及分类数', value: categoryStats.length, hint: '按条目分类统计', testId: 'p3-metric-cats' },
  ];

  const weights = report.weights ?? DATA_WEIGHTS;
  // 线上管线的 hotMap.weights 仅含 5 维度（halfLifeHours 由 analysis.halfLifeHours 单独承载），
  // 故此处对 halfLifeHours 做兜底，避免方法论表格出现 undefined（与 site-config 口径一致）。
  const halfLifeHours = weights.halfLifeHours ?? DATA_WEIGHTS.halfLifeHours;

  return (
    <Box data-testid="p3-root" data-component="page3-report">
      {/* ---------- 头部 ---------- */}
      <Box data-testid="p3-hero" sx={{ mb: 2 }}>
        <Typography component="h1" sx={{ m: 0, fontSize: tokens.fs['2xl'], fontWeight: tokens.fw.semibold }}>
          RSS 日报 · {report.date}
        </Typography>
        <Typography sx={{ mt: 0.5, color: tokens.surface.text2, fontSize: tokens.fs.sm }}>
          当天信息全景 + 热点分析，<strong>只包含当天数据，每天重置</strong>。
        </Typography>
        <Box
          data-testid="p3-meta"
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
            生成时间：
            <strong title={formatAbsolute(report.generatedAt)}>{formatAbsolute(report.generatedAt)}</strong>
          </span>
          <span>
            数据覆盖：<strong>{report.activeChannels}</strong> 个渠道 /{' '}
            <strong>{report.totalItems}</strong> 条
          </span>
          {report.windowStart && report.windowEnd && (
            <span>
              时间窗：{report.windowStart} ~ {report.windowEnd}
            </span>
          )}
          <span>时区：{report.timezone}</span>
        </Box>
        {report.summary && (
          <Box
            data-testid="p3-summary"
            sx={{
              mt: 1.5,
              p: 1.5,
              borderRadius: tokens.radius.md,
              bgcolor: tokens.primary.weak,
              color: tokens.surface.text,
              fontSize: tokens.fs.sm,
              lineHeight: tokens.lh.base,
            }}
          >
            {report.summary}
          </Box>
        )}
      </Box>

      {/* ---------- 概要数字卡 ---------- */}
      <Box
        data-testid="p3-metrics"
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: 'repeat(2, 1fr)', md: 'repeat(4, 1fr)' },
          gap: 2,
          mb: 3,
        }}
      >
        {metrics.map((m) => (
          <Box
            key={m.testId}
            data-testid="p3-metric"
            data-metric={m.testId}
            sx={{
              border: `1px solid ${tokens.surface.border}`,
              borderRadius: tokens.radius.md,
              bgcolor: tokens.surface.surface,
              p: 2,
            }}
          >
            <Box sx={{ color: tokens.surface.text3, fontSize: tokens.fs.sm }}>{m.label}</Box>
            <Box
              data-testid={`${m.testId}-value`}
              sx={{ fontSize: tokens.fs.metric, fontWeight: tokens.fw.bold, lineHeight: 1.2, mt: 0.5 }}
            >
              {m.value}
            </Box>
            <Box sx={{ color: tokens.surface.text3, fontSize: tokens.fs.xs, mt: 0.5 }}>{m.hint}</Box>
          </Box>
        ))}
      </Box>

      {/* ---------- 热点榜 + 分类分布（两栏） ---------- */}
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', lg: 'minmax(0, 1.4fr) minmax(0, 1fr)' },
          gap: 2,
          mb: 3,
        }}
      >
        <Box
          data-testid="p3-hot-section"
          sx={{
            border: `1px solid ${tokens.surface.border}`,
            borderRadius: tokens.radius.md,
            bgcolor: tokens.surface.surface,
            overflow: 'hidden',
          }}
        >
          <SectionHeader title={`热点榜 TOP ${hotCount}`} sub="按热度分（hotScore）倒序" />
          <Box data-testid="p3-hot-list" sx={{ px: 2, pb: 1 }}>
            {report.hotList.length === 0 ? (
              <Typography sx={{ py: 2, color: tokens.surface.text3, fontSize: tokens.fs.sm }}>
                当日暂无热点条目。
              </Typography>
            ) : (
              report.hotList.map((h) => <HotRow key={h.id} hot={h} sourceItem={itemById.get(h.id)} />)
            )}
          </Box>
        </Box>

        <Box
          data-testid="p3-pie-section"
          sx={{
            border: `1px solid ${tokens.surface.border}`,
            borderRadius: tokens.radius.md,
            bgcolor: tokens.surface.surface,
            overflow: 'hidden',
          }}
        >
          <SectionHeader title="分类分布" sub="条数 / 占比" />
          <Box sx={{ p: 2 }}>
            {categoryStats.length === 0 ? (
              <Typography sx={{ color: tokens.surface.text3, fontSize: tokens.fs.sm }}>
                暂无分类数据。
              </Typography>
            ) : (
              <Box
                data-testid="p3-pie"
                sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, alignItems: 'center' }}
              >
                <PieChart
                  data={categoryStats.map((c) => ({
                    label: categoryLabel(c.category),
                    value: c.itemCount,
                    color: categoryColor(c.category),
                  }))}
                  ariaLabel="分类分布饼图"
                  testId="chart-pie"
                />
                <Box sx={{ flex: 1, minWidth: 180 }}>
                  {categoryStats.map((c, i) => (
                    <Box
                      key={c.category}
                      data-testid="p3-pie-legend"
                      data-category={c.category}
                      sx={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 1,
                        py: 0.25,
                        fontSize: tokens.fs.sm,
                      }}
                    >
                      <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <Box
                          component="span"
                          aria-hidden
                          sx={{
                            width: 10,
                            height: 10,
                            borderRadius: '2px',
                            bgcolor: categoryColor(c.category),
                          }}
                        />
                        {categoryLabel(c.category)}
                      </span>
                      <span style={{ color: tokens.surface.text2 }}>
                        {c.itemCount} · <strong data-testid="p3-pie-pct">{catPercents[i] ?? 0}%</strong>
                      </span>
                    </Box>
                  ))}
                  <Box data-testid="p3-pie-total" sx={{ mt: 1, color: tokens.surface.text3, fontSize: tokens.fs.xs }}>
                    合计 {catTotal} 条（分类多标签归入，占比按分类内合计归一化，各分类之和恒为 100%）
                  </Box>
                </Box>
              </Box>
            )}
          </Box>
        </Box>
      </Box>

      {/* ---------- 分类分栏 ---------- */}
      {categoryStats.length > 0 && (
        <Box sx={{ mb: 3 }}>
          <SectionHead title="分类分栏" sub="各分类当天代表条目（按分类多标签归入）" />
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', lg: 'repeat(3, 1fr)' },
              gap: 2,
            }}
          >
            {categoryStats.map((c, i) => (
              <CategoryColumn
                key={c.category}
                category={c.category}
                label={categoryLabel(c.category)}
                itemCount={c.itemCount}
                percent={catPercents[i] ?? 0}
                items={snapshotItems}
              />
            ))}
          </Box>
        </Box>
      )}

      {/* ---------- 渠道活跃度排行 ---------- */}
      <Box sx={{ mb: 3 }}>
        <SectionHead title="渠道活跃度排行" sub="今日条数（含 activityScore）" />
        <Box
          data-testid="p3-channel-activity"
          sx={{
            border: `1px solid ${tokens.surface.border}`,
            borderRadius: tokens.radius.md,
            bgcolor: tokens.surface.surface,
            p: 2,
          }}
        >
          <BarChart
            data={(report.channelActivity ?? []).map((c) => ({
              label: c.channelName,
              value: c.itemCount,
              color: categoryColor((c.category?.[0] ?? 'other') as CategoryKey),
            }))}
            ariaLabel="渠道活跃度条形图"
            testId="chart-bar-channels"
          />
        </Box>
      </Box>

      {/* ---------- 跨源重合榜（QA 缺陷 #9 补齐） ---------- */}
      <Box sx={{ mb: 3 }}>
        <SectionHead title="跨源重合榜" sub="同一主题被多个渠道报道 · 热点判定的关键信号" />
        <Box
          data-testid="p3-cross-source"
          sx={{
            border: `1px solid ${tokens.surface.border}`,
            borderRadius: tokens.radius.md,
            bgcolor: tokens.surface.surface,
            p: 2,
          }}
        >
          {(report.crossSource ?? []).length === 0 ? (
            <Typography sx={{ color: tokens.surface.text3, fontSize: tokens.fs.sm }}>
              今日无跨源重合主题。
            </Typography>
          ) : (
            (report.crossSource ?? []).map((cs, i) => (
              <Box
                key={`${cs.topic}-${i}`}
                data-testid="p3-cross-row"
                sx={{ display: 'flex', gap: 1.5, py: 1, alignItems: 'flex-start' }}
              >
                <RankBox rank={i + 1} />
                <Box sx={{ minWidth: 0 }}>
                  <Box sx={{ fontSize: tokens.fs.base, fontWeight: tokens.fw.medium }}>{cs.topic}</Box>
                  <Box sx={{ mt: 0.5, display: 'flex', flexWrap: 'wrap', gap: 1, alignItems: 'center' }}>
                    <Chip
                      size="small"
                      label={`共 ${cs.sourceCount} 个渠道报道`}
                      sx={{ bgcolor: tokens.primary.weak, color: tokens.primary.active, height: 20 }}
                    />
                    {(cs.channelNames ?? []).map((n) => (
                      <span
                        key={n}
                        style={{ color: tokens.surface.text3, fontSize: tokens.fs.xs }}
                      >
                        {n}
                      </span>
                    ))}
                  </Box>
                </Box>
              </Box>
            ))
          )}
        </Box>
      </Box>

      {/* ---------- 方法论（可折叠） ---------- */}
      <Box sx={{ mb: 3 }}>
        <Box
          component="details"
          data-testid="p3-methodology"
          sx={{
            border: `1px solid ${tokens.surface.border}`,
            borderRadius: tokens.radius.md,
            bgcolor: tokens.surface.surface,
            p: 2,
          }}
        >
          <Box component="summary" sx={{ cursor: 'pointer', fontWeight: tokens.fw.semibold, fontSize: tokens.fs.base }}>
            热点如何判定？（方法论说明）
          </Box>
          <Box sx={{ mt: 1.5, fontSize: tokens.fs.sm, color: tokens.surface.text2 }}>
            <Typography sx={{ fontSize: tokens.fs.sm, color: tokens.surface.text2 }}>
              热度分 <code>hotScore</code> 由五个维度加权归一化得到（权重对齐 PRD §10.1 与 site-config）：
            </Typography>
            <Box
              component="table"
              sx={{
                width: '100%',
                mt: 1,
                borderCollapse: 'collapse',
                fontSize: tokens.fs.sm,
                '& th, & td': { textAlign: 'left', py: 0.5, borderBottom: `1px solid ${tokens.surface.border}` },
              }}
            >
              <thead>
                <tr>
                  <th>维度</th>
                  <th>权重</th>
                  <th>说明</th>
                </tr>
              </thead>
              <tbody>
                <tr><td>跨源重合度</td><td>{weights.sourceOverlap}</td><td>同一主题被多少渠道报道（log + max 归一化）</td></tr>
                <tr><td>时间衰减</td><td>{weights.recency}</td><td>越新权重越高，半衰期 {halfLifeHours} 小时</td></tr>
                <tr><td>出现频次</td><td>{weights.frequency}</td><td>关键词/主题当天出现次数（z-score）</td></tr>
                <tr><td>渠道权重</td><td>{weights.channelWeight}</td><td>高权威渠道加权（可配置）</td></tr>
                <tr><td>关键词热度</td><td>{weights.keywordHeat}</td><td>命中高热度词表</td></tr>
              </tbody>
            </Box>
            <Typography sx={{ mt: 1.5, fontSize: tokens.fs.sm, color: tokens.surface.text2 }}>
              公式：<code>hotScore = w1·Z_重合 + w2·decay + w3·Z_频次 + w4·渠道权重 + w5·关键词</code>。
              跨源重合是判定「真正热点」的重要信号（越多源报道 → 越热）。报告边界：
              <strong>只分析当天数据，跨天重置</strong>。
            </Typography>
          </Box>
        </Box>
      </Box>

      {/* ---------- 底部：版权 + 历史入口 ---------- */}
      <Box
        sx={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 2,
          alignItems: 'center',
          justifyContent: 'space-between',
          borderTop: `1px solid ${tokens.surface.border}`,
          pt: 2,
        }}
      >
        <Typography
          data-testid="p3-copyright"
          sx={{ color: tokens.surface.text3, fontSize: tokens.fs.xs, maxWidth: 720 }}
        >
          {SITE_FOOTER}。口径说明：分类统计按条目全部标签归入，占比在分类内合计上归一化（各分类占比之和恒为
          100%）；仅展示当天有内容的分类。跨源榜仅统计 sourceCount ≥ 2 的主题。
        </Typography>
        <Chip
          component={Link}
          to="/history"
          clickable
          data-testid="p3-goto-history"
          label="查看历史趋势 →"
          sx={{ bgcolor: tokens.primary.main, color: tokens.primary.on }}
        />
      </Box>
    </Box>
  );
}

/** 版块头（卡片内标题 + 副标题） */
function SectionHeader({ title, sub }: { title: string; sub: string }) {
  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'baseline',
        justifyContent: 'space-between',
        gap: 1,
        px: 2,
        py: 1.25,
        borderBottom: `1px solid ${tokens.surface.border}`,
      }}
    >
      <Box sx={{ fontWeight: tokens.fw.semibold, fontSize: tokens.fs.lg }}>{title}</Box>
      <Box sx={{ color: tokens.surface.text3, fontSize: tokens.fs.xs }}>{sub}</Box>
    </Box>
  );
}

/** 版块头（无卡片包裹的独立小节） */
function SectionHead({ title, sub }: { title: string; sub: string }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 1, mb: 1 }}>
      <Typography component="h2" sx={{ m: 0, fontSize: tokens.fs.xl, fontWeight: tokens.fw.semibold }}>
        {title}
      </Typography>
      <Box sx={{ color: tokens.surface.text3, fontSize: tokens.fs.xs }}>{sub}</Box>
    </Box>
  );
}

/** 名次徽标 */
function RankBox({ rank }: { rank: number }) {
  const top = rank <= 3 ? tokens.rank[rank as 1 | 2 | 3] : null;
  return (
    <Box
      data-rank={rank}
      sx={{
        flex: '0 0 26px',
        width: 26,
        height: 26,
        borderRadius: tokens.radius.sm,
        bgcolor: top?.bg ?? tokens.surface.surface2,
        color: top?.text ?? tokens.surface.text2,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontWeight: tokens.fw.bold,
        fontSize: tokens.fs.sm,
      }}
    >
      {rank}
    </Box>
  );
}

/** 热点榜一行（保留 dead 条目；有备用地址则切换、否则链接置灰删除线，ARCH §15.4） */
function HotRow({ hot, sourceItem }: { hot: HotItem; sourceItem?: Item }) {
  const pct = Math.round(Math.max(0, Math.min(1, hot.hotScore)) * 100);
  const status = sourceItem?.urlStatus ?? 'unknown';
  const hasAlternate = Boolean(sourceItem?.alternateUrl);
  const href = sourceItem?.alternateUrl ?? hot.url;
  const isDead = status === 'dead' && !hasAlternate;
  return (
    <Box data-testid="p3-hot-row" data-item-id={hot.id} sx={{ display: 'flex', gap: 1.5, py: 1 }}>
      <RankBox rank={hot.rank} />
      <Box sx={{ minWidth: 0, flex: 1 }}>
        {isDead ? (
          <Box
            data-testid="p3-hot-title"
            sx={{
              fontWeight: tokens.fw.medium,
              fontSize: tokens.fs.md,
              color: tokens.surface.text3,
              textDecoration: 'line-through',
            }}
          >
            {hot.title}
          </Box>
        ) : (
          <LinkMui
            data-testid="p3-hot-title"
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            underline="hover"
            sx={{ fontWeight: tokens.fw.medium, fontSize: tokens.fs.md, color: tokens.surface.text }}
          >
            {hot.title}
          </LinkMui>
        )}
        <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1, mt: 0.5 }}>
          <span style={{ color: tokens.surface.text3, fontSize: tokens.fs.xs }}>{hot.channelName}</span>
          {(hot.category ?? []).map((c) => (
            <Chip
              key={c}
              data-testid="p3-hot-cat"
              data-category={c}
              size="small"
              label={categoryLabel(c)}
              sx={{
                bgcolor: `${categoryColor(c)}1a`,
                color: categoryColor(c),
                border: `1px solid ${categoryColor(c)}33`,
                height: 18,
                fontSize: tokens.fs.xs,
              }}
            />
          ))}
          <span style={{ color: tokens.surface.text3, fontSize: tokens.fs.xs }}>
            来源数 <strong>{hot.sourceCount}</strong>
          </span>
          {(hot.channelNames ?? []).length > 1 && (
            <span
              style={{ color: tokens.surface.text3, fontSize: tokens.fs.xs }}
              title={(hot.channelNames ?? []).join('、')}
            >
              {(hot.channelNames ?? []).join('、')}
            </span>
          )}
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.75 }}>
          <span style={{ color: tokens.surface.text3, fontSize: tokens.fs.xs }}>热度</span>
          <Box
            data-testid="p3-hot-bar"
            sx={{
              flex: 1,
              height: 8,
              bgcolor: tokens.surface.surface2,
              borderRadius: tokens.radius.full,
              overflow: 'hidden',
            }}
          >
            <Box
              sx={{
                width: `${pct}%`,
                height: '100%',
                background: `linear-gradient(90deg, ${tokens.chart[1]}, ${tokens.chart.progressTo})`,
              }}
            />
          </Box>
          <span style={{ color: tokens.surface.text2, fontSize: tokens.fs.xs, fontWeight: tokens.fw.semibold }}>
            {hot.hotScore.toFixed(2)}
          </span>
        </Box>
      </Box>
    </Box>
  );
}

/** 分类分栏单列：该分类下代表条目（按 hotScore 倒序取 4 条） */
function CategoryColumn({
  category,
  label,
  itemCount,
  percent,
  items,
}: {
  category: CategoryKey;
  label: string;
  itemCount: number;
  percent: number;
  items: Item[];
}) {
  const reps = useMemo(
    () =>
      items
        .filter((it) => (it.category ?? []).includes(category))
        .sort((a, b) => {
          const ah = a.hotScore ?? 0;
          const bh = b.hotScore ?? 0;
          if (ah !== bh) return bh - ah;
          const av = a.updatedAt || a.publishedAt;
          const bv = b.updatedAt || b.publishedAt;
          return av < bv ? 1 : av > bv ? -1 : 0;
        })
        .slice(0, 4),
    [items, category],
  );

  return (
    <Box
      data-testid="p3-cat-col"
      data-category={category}
      sx={{
        border: `1px solid ${tokens.surface.border}`,
        borderRadius: tokens.radius.md,
        bgcolor: tokens.surface.surface,
        p: 2,
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
        <Box
          component="span"
          aria-hidden
          sx={{ width: 10, height: 10, borderRadius: '2px', bgcolor: categoryColor(category) }}
        />
        <strong>{label}</strong>
        <span style={{ marginLeft: 'auto', color: tokens.surface.text3, fontSize: tokens.fs.xs }}>
          {itemCount} 条 · {percent}%
        </span>
      </Box>
      {reps.length === 0 ? (
        <Box sx={{ color: tokens.surface.text3, fontSize: tokens.fs.sm }}>该分类当天暂无条目</Box>
      ) : (
        <Box component="ul" sx={{ m: 0, pl: 2.5, display: 'flex', flexDirection: 'column', gap: 0.75 }}>
          {reps.map((it) => (
            <Box component="li" key={it.id} sx={{ fontSize: tokens.fs.sm }}>
              <LinkMui
                href={it.alternateUrl ?? it.url}
                target="_blank"
                rel="noopener noreferrer"
                underline="hover"
                sx={{ color: tokens.surface.text }}
              >
                {it.title}
              </LinkMui>
              <Box sx={{ color: tokens.surface.text3, fontSize: tokens.fs.xs, mt: 0.25 }}>
                {it.channelName}
                {(it.sourceCount ?? 1) > 1 ? ` · ＋${(it.sourceCount ?? 1) - 1} 源` : ''}
              </Box>
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
}
