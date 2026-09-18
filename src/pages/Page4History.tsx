// T-P3-06 — 页面4：历史趋势与回看（PRD §6.4 / ARCHITECTURE §13）
//
// 数据契约（ARCH §13.1）：
//   趋势            history-index.json → days[]（1 请求，~25KB gzip）
//   月度下钻        history/YYYY/MM/items.ndjson（懒加载 + 流式 onProgress）
//   回看某天        history/YYYY/MM/snapshot-<date>.json + report-<date>.json
//   归档区（>1 年） history/archive-index.json（只读元数据 + 跳 GitHub Release 下载）
//
// 版块：
//   1. 趋势区：指标切换（总条数 p4-metric-total / 活跃渠道 p4-metric-channels / 分类占比
//      p4-metric-catratio）+ 时间窗 90/180/365（p4-window-*，默认 90，仅切片不导航）
//   2. 月度明细下钻：<details> 展开 → 流式拉 NDJSON，加载态 p4-month-summary
//   3. 日历回看：DatePicker → 三态（有数据 / 该日期无数据 / 已归档（超过一年）+ Release 下载）
//   4. 归档区：只读元数据 p4-archive-row + 外部 Release 链接
//
// 健壮性：history-index 缺位 → “历史数据生成中”空态（p4-empty）；
//         单日数据损坏（非数值）不阻断整张趋势图（绘制前过滤非法点）。

import { useEffect, useMemo, useState, type SyntheticEvent } from 'react';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import LinkMui from '@mui/material/Link';
import Typography from '@mui/material/Typography';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';

import type { ArchiveEntry, DayAgg, HistoryItem, Report, Snapshot } from '../types';
import {
  useArchiveIndex,
  useHistoryIndex,
  useMonthItemsStream,
} from '../hooks';
import { fetchDayReport, fetchDaySnapshot } from '../services/historyClient';
import { EmptyState, ErrorBanner, SkeletonList, TrendChart, DatePicker } from '../components';
import { HISTORY_WINDOW_OPTIONS } from '../config/site';
import { categoryLabel } from '../config/categories';
import { categoryColor, tokens } from '../theme/tokens';
import { formatAbsolute, formatRelative, shanghaiDateKey } from '../services/time';

type TrendMetric = 'totalItems' | 'activeChannels' | 'catRatio';

const METRIC_META: Record<TrendMetric, { label: string; unit: string; color: string; testId: string }> = {
  totalItems: { label: '总条数', unit: '条', color: tokens.chart[1], testId: 'p4-metric-total' },
  activeChannels: { label: '活跃渠道数', unit: '个渠道', color: tokens.chart[2], testId: 'p4-metric-channels' },
  catRatio: { label: 'AI 类占比', unit: '%', color: tokens.chart[3], testId: 'p4-metric-catratio' },
};

/** UTC 基准加减天数 → YYYY-MM-DD */
function addDaysUtc(date: string, delta: number): string {
  const parts = date.split('-').map(Number);
  const y = parts[0] ?? 1970;
  const m = parts[1] ?? 1;
  const d = parts[2] ?? 1;
  const base = new Date(Date.UTC(y, m - 1, d));
  base.setUTCDate(base.getUTCDate() + delta);
  return base.toISOString().slice(0, 10);
}

/** 某天在给定指标下的值（非法返回 NaN，绘制前过滤） */
function metricValue(day: DayAgg, metric: TrendMetric): number {
  if (metric === 'activeChannels') return Number(day.activeChannels);
  if (metric === 'catRatio') {
    const total = Number(day.totalItems) || 0;
    if (total <= 0) return 0;
    const ai = Number(day.categoryStats?.['ai'] ?? 0);
    return Math.round((ai / total) * 1000) / 10;
  }
  return Number(day.totalItems);
}

export default function Page4History() {
  const { data: index, loading, error, reload } = useHistoryIndex();
  const { data: archiveIndex } = useArchiveIndex();

  const days = useMemo<DayAgg[]>(
    () => [...(index?.days ?? [])].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)),
    [index],
  );
  const archives = archiveIndex?.archives ?? [];

  const [windowDays, setWindowDays] = useState<number>(HISTORY_WINDOW_OPTIONS[0] ?? 90);
  const [metric, setMetric] = useState<TrendMetric>('totalItems');
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  const todayKey = useMemo(() => shanghaiDateKey(new Date()), []);
  const cutoff = useMemo(() => addDaysUtc(todayKey, -365), [todayKey]);

  // 索引就绪后默认选中「最近一天」
  useEffect(() => {
    if (selectedDate === null && days.length > 0) {
      setSelectedDate(days[days.length - 1]?.date ?? null);
    }
  }, [days, selectedDate]);

  const dateSet = useMemo(() => new Set(days.map((d) => d.date)), [days]);

  // ---------- 趋势序列（窗口切片 + 非法点过滤，单日损坏不阻断整图） ----------
  const points = useMemo(() => {
    const sliced = days.slice(Math.max(0, days.length - windowDays));
    return sliced
      .map((d) => ({ date: d.date, value: metricValue(d, metric) }))
      .filter((p) => Number.isFinite(p.value));
  }, [days, windowDays, metric]);

  const meta = METRIC_META[metric];

  // ---------- 加载 / 错误 / 空态 ----------
  if (loading) {
    return (
      <Box data-testid="p4-root" data-component="page4-history">
        <SkeletonList count={3} testId="p4-skeleton" />
      </Box>
    );
  }
  if (error) {
    return (
      <Box data-testid="p4-root" data-component="page4-history">
        <ErrorBanner message={`历史数据加载失败：${error}`} onRetry={reload} testId="p4-error" />
      </Box>
    );
  }
  if (!index || days.length === 0) {
    return (
      <Box data-testid="p4-root" data-component="page4-history">
        <EmptyState
          title="历史数据生成中"
          description="尚未生成 history-index.json。历史数据由采集任务跨天转换产出，请稍后重试。"
          testId="p4-empty"
        />
      </Box>
    );
  }

  return (
    <Box data-testid="p4-root" data-component="page4-history">
      <Typography component="h1" sx={{ m: 0, mb: 2, fontSize: tokens.fs['2xl'], fontWeight: tokens.fw.semibold }}>
        历史趋势与回看
      </Typography>

      {/* ---------- 1. 趋势区 ---------- */}
      <Box
        data-testid="p4-trend"
        data-chart-count="1"
        sx={{
          border: `1px solid ${tokens.surface.border}`,
          borderRadius: tokens.radius.md,
          bgcolor: tokens.surface.surface,
          p: 2,
          mb: 3,
        }}
      >
        <Box
          sx={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 1,
            mb: 1.5,
          }}
        >
          <Typography component="h2" sx={{ m: 0, fontSize: tokens.fs.xl, fontWeight: tokens.fw.semibold }}>
            趋势：{meta.label}
          </Typography>
          <ToggleButtonGroup
            data-testid="p4-window"
            exclusive
            size="small"
            value={windowDays}
            onChange={(_e, next: number | null) => {
              if (typeof next === 'number') setWindowDays(next);
            }}
          >
            {HISTORY_WINDOW_OPTIONS.map((w) => (
              <ToggleButton key={w} value={w} data-testid={`p4-window-${w}`}>
                近 {w} 天
              </ToggleButton>
            ))}
          </ToggleButtonGroup>
        </Box>

        <ToggleButtonGroup
          data-testid="p4-metric"
          exclusive
          size="small"
          value={metric}
          onChange={(_e, next: TrendMetric | null) => {
            if (next) setMetric(next);
          }}
          sx={{ mb: 2 }}
        >
          {(Object.keys(METRIC_META) as TrendMetric[]).map((k) => (
            <ToggleButton key={k} value={k} data-testid={METRIC_META[k].testId}>
              {METRIC_META[k].label}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>

        <TrendChart
          data={points}
          series={`近 ${windowDays} 天${meta.label}（${meta.unit}）`}
          color={meta.color}
          height={240}
          ariaLabel={`近 ${windowDays} 天${meta.label}趋势图`}
          testId="p4-trend-chart"
        />

        <Typography sx={{ mt: 1, color: tokens.surface.text3, fontSize: tokens.fs.xs }}>
          <strong>数据契约：</strong>本趋势图 = <code>history-index.json</code> 的
          <strong> 1 次请求</strong>（消费 days[] 的 date / totalItems / activeChannels /
          categoryStats），无需读取 N 个文件；时间窗仅做客户端切片，不触发额外请求。
        </Typography>
      </Box>

      {/* ---------- 2. 月度明细下钻 ---------- */}
      <MonthSection days={days} />

      {/* ---------- 3. 日历回看 ---------- */}
      <LookbackSection
        selectedDate={selectedDate}
        onSelect={setSelectedDate}
        hasData={(d) => dateSet.has(d)}
        cutoff={cutoff}
        todayKey={todayKey}
        archives={archives}
      />

      {/* ---------- 4. 归档区（只读） ---------- */}
      <ArchiveSection archives={archives} />
    </Box>
  );
}

/** 版块标题 */
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

// ---------- 月度明细 ----------

function MonthSection({ days }: { days: DayAgg[] }) {
  const months = useMemo(() => {
    const map = new Map<string, number>();
    for (const d of days) {
      const k = d.date.slice(0, 7);
      map.set(k, (map.get(k) ?? 0) + (Number(d.totalItems) || 0));
    }
    return [...map.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1));
  }, [days]);

  return (
    <Box sx={{ mb: 3 }}>
      <SectionHead title="月度明细下钻" sub="展开某月 → 懒加载 history/YYYY/MM/items.ndjson（流式）" />
      <Box data-testid="p4-months" sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        {months.length === 0 ? (
          <Typography sx={{ color: tokens.surface.text3, fontSize: tokens.fs.sm }}>暂无可下钻的月份。</Typography>
        ) : (
          months.map(([mk, count]) => <MonthRow key={mk} monthKey={mk} indexItemCount={count} />)
        )}
      </Box>
    </Box>
  );
}

function MonthRow({ monthKey, indexItemCount }: { monthKey: string; indexItemCount: number }) {
  const [open, setOpen] = useState(false);
  const [yStr, mStr] = monthKey.split('-');
  const year = Number(yStr);
  const month = Number(mStr);

  const stream = useMonthItemsStream(open ? year : null, open ? month : null);

  return (
    <Box
      component="details"
      data-testid="p4-month-row"
      data-month={monthKey}
      open={open}
      onToggle={(e: SyntheticEvent<HTMLDetailsElement>) => setOpen(e.currentTarget.open)}
      sx={{
        border: `1px solid ${tokens.surface.border}`,
        borderRadius: tokens.radius.md,
        bgcolor: tokens.surface.surface,
        p: 1.5,
      }}
    >
      <Box
        component="summary"
        sx={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 1, fontSize: tokens.fs.sm }}
      >
        <strong>
          {year} 年 {month} 月明细
        </strong>
        <span style={{ color: tokens.surface.text3, fontSize: tokens.fs.xs }}>
          · 索引合计 {indexItemCount} 条 · 点击展开
        </span>
      </Box>

      <Box sx={{ mt: 1 }}>
        {open && stream.loading && (
          <Box data-testid="p4-month-summary" sx={{ color: tokens.surface.text2, fontSize: tokens.fs.sm }}>
            正在流式加载 history/{year}/{monthKey.slice(5)}/items.ndjson … 已解析 {stream.progress} 条
          </Box>
        )}
        {open && !stream.loading && stream.error && (
          <Typography data-testid="p4-month-error" sx={{ color: tokens.semantic.danger, fontSize: tokens.fs.sm }}>
            该月明细加载失败：{stream.error}
          </Typography>
        )}
        {open && !stream.loading && !stream.error && (
          <>
            <Typography data-testid="p4-month-loaded" sx={{ color: tokens.surface.text3, fontSize: tokens.fs.xs, mb: 0.5 }}>
              已加载 <code>history/{year}/{monthKey.slice(5)}/items.ndjson</code> · 共 {stream.data.length} 条（精简行）
            </Typography>
            <Box sx={{ display: 'flex', flexDirection: 'column' }}>
              {stream.data.slice(0, 50).map((it) => (
                <MonthItem key={it.id} item={it} />
              ))}
              {stream.data.length > 50 && (
                <Typography sx={{ color: tokens.surface.text3, fontSize: tokens.fs.xs, mt: 0.5 }}>
                  （仅展示前 50 条，共 {stream.data.length} 条）
                </Typography>
              )}
            </Box>
          </>
        )}
      </Box>
    </Box>
  );
}

function MonthItem({ item }: { item: HistoryItem }) {
  return (
    <Box
      data-testid="p4-month-item"
      data-item-id={item.id}
      sx={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: 1,
        py: 0.5,
        borderTop: `1px solid ${tokens.surface.border}`,
        fontSize: tokens.fs.sm,
      }}
    >
      <LinkMui
        href={item.url}
        target="_blank"
        rel="noopener noreferrer"
        underline="hover"
        sx={{ color: tokens.surface.text, flex: 1, minWidth: 160 }}
      >
        {item.title}
      </LinkMui>
      <span style={{ color: tokens.surface.text3, fontSize: tokens.fs.xs }}>{item.channelName}</span>
      {item.category?.[0] && (
        <Chip
          size="small"
          label={categoryLabel(item.category[0])}
          data-category={item.category[0]}
          sx={{
            height: 18,
            fontSize: tokens.fs.xs,
            bgcolor: `${categoryColor(item.category[0])}1a`,
            color: categoryColor(item.category[0]),
          }}
        />
      )}
      {(item.sourceCount ?? 1) > 1 && (
        <span style={{ color: tokens.surface.text3, fontSize: tokens.fs.xs }}>＋{(item.sourceCount ?? 1) - 1} 源</span>
      )}
      <span style={{ color: tokens.surface.text3, fontSize: tokens.fs.xs }}>{item.date}</span>
    </Box>
  );
}

// ---------- 日历回看 ----------

type LookbackState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'data'; snapshot: Snapshot; report: Report | null }
  | { status: 'empty' }
  | { status: 'archived' };

function LookbackSection({
  selectedDate,
  onSelect,
  hasData,
  cutoff,
  todayKey,
  archives,
}: {
  selectedDate: string | null;
  onSelect: (d: string) => void;
  hasData: (d: string) => boolean;
  cutoff: string;
  todayKey: string;
  archives: ArchiveEntry[];
}) {
  const [lb, setLb] = useState<LookbackState>({ status: 'idle' });

  useEffect(() => {
    if (!selectedDate) {
      setLb({ status: 'idle' });
      return undefined;
    }
    if (selectedDate < cutoff) {
      setLb({ status: 'archived' });
      return undefined;
    }
    let alive = true;
    setLb({ status: 'loading' });
    (async () => {
      try {
        const [snap, rep] = await Promise.all([
          fetchDaySnapshot(selectedDate),
          fetchDayReport(selectedDate).catch(() => null),
        ]);
        if (!alive) return;
        setLb({ status: 'data', snapshot: snap.data, report: rep?.data ?? null });
      } catch {
        if (alive) setLb({ status: 'empty' });
      }
    })();
    return () => {
      alive = false;
    };
  }, [selectedDate, cutoff]);

  const archiveForYear = useMemo(
    () => (selectedDate ? archives.find((a) => String(a.year) === selectedDate.slice(0, 4)) ?? null : null),
    [archives, selectedDate],
  );

  return (
    <Box sx={{ mb: 3 }}>
      <SectionHead title="日历回看" sub="选择某天 → snapshot-<date>.json + report-<date>.json" />
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, alignItems: 'flex-start' }}>
        <DatePicker
          value={selectedDate}
          onSelect={onSelect}
          hasData={hasData}
          initialMonth={selectedDate ? selectedDate.slice(0, 7) : undefined}
          testId="p4-calendar"
        />

        <Box
          data-testid="p4-lookback"
          sx={{
            flex: 1,
            minWidth: 280,
            border: `1px solid ${tokens.surface.border}`,
            borderRadius: tokens.radius.md,
            bgcolor: tokens.surface.surface,
            p: 2,
          }}
        >
          <Typography sx={{ fontWeight: tokens.fw.semibold, fontSize: tokens.fs.base, mb: 1 }}>
            回看：{selectedDate ?? '—'}
          </Typography>

          {lb.status === 'idle' && (
            <Typography sx={{ color: tokens.surface.text3, fontSize: tokens.fs.sm }}>请在左侧选择日期。</Typography>
          )}

          {lb.status === 'loading' && (
            <Typography data-testid="p4-lookback-loading" sx={{ color: tokens.surface.text2, fontSize: tokens.fs.sm }}>
              正在加载该日数据…
            </Typography>
          )}

          {lb.status === 'archived' && (
            <Box
              data-testid="p4-lookback-archived"
              sx={{
                border: `1px solid ${tokens.semantic.infoBorder}`,
                bgcolor: tokens.semantic.infoBg,
                color: tokens.semantic.infoText,
                borderRadius: tokens.radius.sm,
                p: 1.5,
              }}
            >
              <Box sx={{ fontWeight: tokens.fw.semibold }}>该日期已归档（超过一年）</Box>
              <Box sx={{ fontSize: tokens.fs.sm, mt: 0.5 }}>
                {selectedDate} 的数据不在站内可交互范围内（站内仅保留一年）。站内只读展示归档元数据，
                请前往 GitHub Release 下载归档包。
              </Box>
              {archiveForYear && (
                <Box sx={{ mt: 1 }}>
                  <Chip size="small" label={`归档年份 ${archiveForYear.year}`} sx={{ mr: 1, height: 20 }} />
                  <LinkMui
                    data-testid="p4-lookback-release"
                    href={archiveForYear.releaseUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    underline="hover"
                    sx={{ fontSize: tokens.fs.sm }}
                  >
                    前往 GitHub Release 下载（{archiveForYear.releaseTag}）
                  </LinkMui>
                </Box>
              )}
            </Box>
          )}

          {lb.status === 'empty' && (
            <Box
              data-testid="p4-lookback-empty"
              sx={{
                border: `1px dashed ${tokens.surface.border}`,
                borderRadius: tokens.radius.sm,
                p: 2,
                textAlign: 'center',
                color: tokens.surface.text2,
              }}
            >
              <Box sx={{ fontWeight: tokens.fw.semibold, color: tokens.surface.text }}>该日期无数据</Box>
              <Box sx={{ fontSize: tokens.fs.sm, mt: 0.5 }}>
                该日可能未采集，或已超出站内可交互范围（一年内）。与「已归档」的区别：已归档需前往 Release 下载。
              </Box>
            </Box>
          )}

          {lb.status === 'data' && (
            <Box data-testid="p4-lookback-data">
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, fontSize: tokens.fs.sm, color: tokens.surface.text2 }}>
                <span>
                  条目数（去重后）：<strong data-testid="p4-lookback-total">{lb.snapshot.items.length}</strong>
                </span>
                <span>
                  活跃渠道：<strong data-testid="p4-lookback-channels">{lb.snapshot.stats?.sourceOk ?? '—'}</strong>
                </span>
                <span>
                  数据来源：<code>history/{selectedDate?.slice(0, 4)}/{selectedDate?.slice(5, 7)}/snapshot-{selectedDate}.json</code>
                </span>
              </Box>

              {lb.report && lb.report.hotList.length > 0 && (
                <Box
                  component="table"
                  sx={{
                    width: '100%',
                    mt: 1.5,
                    borderCollapse: 'collapse',
                    fontSize: tokens.fs.sm,
                    '& th, & td': { textAlign: 'left', py: 0.5, borderBottom: `1px solid ${tokens.surface.border}` },
                  }}
                >
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>热点 TopN</th>
                      <th>渠道</th>
                      <th>热度</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lb.report.hotList.slice(0, 5).map((h) => (
                      <tr key={h.id} data-testid="p4-lookback-hot">
                        <td>{h.rank}</td>
                        <td>
                          <LinkMui
                            href={h.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            underline="hover"
                            sx={{ color: tokens.surface.text }}
                          >
                            {h.title}
                          </LinkMui>
                        </td>
                        <td>{h.channelName}</td>
                        <td>{h.hotScore.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </Box>
              )}

              {!lb.report && (
                <Typography sx={{ mt: 1, color: tokens.surface.text3, fontSize: tokens.fs.xs }}>
                  该日未提供报告文件，趋势与快照数据仍可查。
                </Typography>
              )}

              {selectedDate === todayKey && (
                <Typography sx={{ mt: 1, color: tokens.surface.text3, fontSize: tokens.fs.xs }}>
                  今天为当日快照（today/snapshot），亦已纳入历史索引。
                </Typography>
              )}
            </Box>
          )}
        </Box>
      </Box>
    </Box>
  );
}

// ---------- 归档区 ----------

function ArchiveSection({ archives }: { archives: ArchiveEntry[] }) {
  return (
    <Box sx={{ mb: 2 }}>
      <SectionHead title="归档（超过一年）" sub="站内只读元数据 · 下载请前往 GitHub Release" />
      <Box data-testid="p4-archive" sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {archives.length === 0 ? (
          <Typography data-testid="p4-archive-none" sx={{ color: tokens.surface.text3, fontSize: tokens.fs.sm }}>
            暂无已归档年份（归档在采集满一年后由年度归档任务产出）。
          </Typography>
        ) : (
          archives.map((a) => (
            <Box
              key={a.releaseTag}
              data-testid="p4-archive-row"
              data-year={a.year}
              sx={{
                border: `1px solid ${tokens.surface.border}`,
                borderRadius: tokens.radius.md,
                bgcolor: tokens.surface.surface,
                p: 2,
              }}
            >
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, alignItems: 'center', justifyContent: 'space-between' }}>
                <Box>
                  <strong>{a.year} 年归档</strong>
                  <span style={{ color: tokens.surface.text3, fontSize: tokens.fs.sm }}>
                    {' '}
                    · 共 {a.months.length} 个月 · Release {a.releaseTag}
                  </span>
                </Box>
                <LinkMui
                  data-testid="p4-archive-release"
                  href={a.releaseUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  underline="hover"
                  sx={{ fontSize: tokens.fs.sm }}
                >
                  ⤓ 前往 GitHub Release 下载
                </LinkMui>
              </Box>
              <Box
                sx={{
                  mt: 1.5,
                  display: 'grid',
                  gridTemplateColumns: { xs: 'repeat(2, 1fr)', sm: 'repeat(4, 1fr)', md: 'repeat(6, 1fr)' },
                  gap: 1,
                }}
              >
                {a.months.map((m) => (
                  <Box
                    key={m.month}
                    data-testid="p4-archive-month"
                    sx={{
                      border: `1px solid ${tokens.surface.border}`,
                      borderRadius: tokens.radius.sm,
                      p: 1,
                      textAlign: 'center',
                    }}
                  >
                    <Box sx={{ fontWeight: tokens.fw.semibold, fontSize: tokens.fs.sm }}>{m.month}</Box>
                    <Box sx={{ color: tokens.surface.text3, fontSize: tokens.fs.xs }}>
                      {m.itemCount} 条{m.bytes ? ` · ${(m.bytes / 1048576).toFixed(1)} MB` : ''}
                    </Box>
                  </Box>
                ))}
              </Box>
            </Box>
          ))
        )}
      </Box>
      <Typography sx={{ mt: 1, color: tokens.surface.text3, fontSize: tokens.fs.xs }}>
        站内仅只读展示归档元数据；因 Release 资产无稳定 raw/CORS 直读端点且体积较大，站内不解析，统一跳转下载
        （PRD Q15 / ARCHITECTURE §13.3）。归档区生成时间：
        {archives[0]?.generatedAt ? ` ${formatAbsolute(archives[0].generatedAt)}` : ' —'}（相对：
        {archives[0]?.generatedAt ? formatRelative(archives[0].generatedAt) : '—'}）。
      </Typography>
    </Box>
  );
}
