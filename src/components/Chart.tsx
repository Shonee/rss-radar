// T-P3-02 公共组件库 — 图表（自绘 SVG 占位实现）
//
// ⚠ 选型说明：ARCHITECTURE §2.2 选定 **Recharts**。本批次**不引入新依赖**
// （控制风险），先用同接口的原生 SVG 实现占位，接口保持「可替换」：
//   <TrendChart data series />  ≈ Recharts <LineChart><Line dataKey="value"/></LineChart>
//   <PieChart data />           ≈ Recharts <PieChart><Pie/></PieChart>
//   <BarChart data />           ≈ Recharts <BarChart><Bar/></BarChart>
// 后续引入 Recharts 时，仅需替换本文件实现，页面无需改动。

import { tokens } from '../theme/tokens';
import EmptyState from './EmptyState';

export interface TrendPoint {
  date: string;
  value: number;
}

export interface TrendChartProps {
  data: TrendPoint[];
  /** 系列名（原样用于 aria-label，Recharts 兼容位） */
  series?: string;
  height?: number;
  color?: string;
  ariaLabel?: string;
  testId?: string;
}

const W = 680;
const PAD_L = 46;
const PAD_R = 18;
const PAD_T = 18;
const PAD_B = 34;

/** 趋势折线 + 面积图 */
export function TrendChart({
  data,
  series,
  height = 240,
  color = tokens.chart[1],
  ariaLabel,
  testId = 'chart-trend',
}: TrendChartProps) {
  if (!data || data.length === 0) {
    return <EmptyState title="暂无趋势数据" testId="chart-trend-empty" />;
  }

  const H = height;
  const rawMax = Math.max(...data.map((d) => d.value), 1);
  const max = Math.ceil(rawMax / 50) * 50 || 1;
  const n = data.length;
  const stepX = (W - PAD_L - PAD_R) / Math.max(n - 1, 1);
  const x = (i: number): number => PAD_L + i * stepX;
  const y = (v: number): number => H - PAD_B - (v / max) * (H - PAD_T - PAD_B);

  const ticks = 4;
  const grid: string[] = [];
  for (let t = 0; t <= ticks; t += 1) {
    const val = Math.round(max - (max / ticks) * t);
    const gy = H - PAD_B - ((H - PAD_T - PAD_B) / ticks) * t;
    grid.push(
      `<line x1="${PAD_L}" y1="${gy.toFixed(1)}" x2="${W - PAD_R}" y2="${gy.toFixed(1)}" stroke="${tokens.surface.border}" stroke-width="1"/>`,
    );
    grid.push(
      `<text x="${PAD_L - 8}" y="${(gy + 3.5).toFixed(1)}" text-anchor="end" font-size="11" fill="${tokens.surface.text3}">${val}</text>`,
    );
  }

  const labelEvery = Math.max(1, Math.floor(n / 6));
  const xLabels: string[] = [];
  for (let i = 0; i < n; i += labelEvery) {
    const point = data[i];
    if (!point) continue;
    xLabels.push(
      `<text x="${x(i).toFixed(1)}" y="${H - PAD_B + 16}" text-anchor="middle" font-size="11" fill="${tokens.surface.text3}">${point.date.slice(5)}</text>`,
    );
  }

  const lineD = data
    .map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(d.value).toFixed(1)}`)
    .join(' ');
  const areaD = `${lineD} L${x(n - 1).toFixed(1)},${H - PAD_B} L${x(0).toFixed(1)},${H - PAD_B} Z`;
  const points = data
    .map((d, i) => {
      return `<circle cx="${x(i).toFixed(1)}" cy="${y(d.value).toFixed(1)}" r="2.6" fill="${color}"><title>${d.date}：${d.value}</title></circle>`;
    })
    .join('');

  return (
    <svg
      data-testid={testId}
      data-component="chart-trend"
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={ariaLabel ?? series ?? '趋势折线图'}
      style={{ width: '100%', height: 'auto' }}
      dangerouslySetInnerHTML={{
        __html:
          `<defs><linearGradient id="rr-trend-area" x1="0" y1="0" x2="0" y2="1">` +
          `<stop offset="0%" stop-color="${color}" stop-opacity="0.22"/>` +
          `<stop offset="100%" stop-color="${color}" stop-opacity="0"/>` +
          `</linearGradient></defs>` +
          grid.join('') +
          xLabels.join('') +
          `<path d="${areaD}" fill="url(#rr-trend-area)"/>` +
          `<path d="${lineD}" fill="none" stroke="${color}" stroke-width="2"/>` +
          points,
      }}
    />
  );
}

export interface PieDatum {
  label: string;
  value: number;
  color?: string;
}

export interface PieChartProps {
  data: PieDatum[];
  ariaLabel?: string;
  testId?: string;
}

/** 分类分布饼图（环形） */
export function PieChart({ data, ariaLabel, testId = 'chart-pie' }: PieChartProps) {
  const total = data.reduce((a, d) => a + d.value, 0);
  if (!data || data.length === 0 || total <= 0) {
    return <EmptyState title="暂无分类数据" testId="chart-pie-empty" />;
  }

  const size = 220;
  const r = 90;
  const cx = size / 2;
  const cy = size / 2;
  const inner = 52;
  let angle = -Math.PI / 2;

  const pt = (a: number, rad: number): [number, number] => [
    cx + Math.cos(a) * rad,
    cy + Math.sin(a) * rad,
  ];

  const palette = [tokens.chart[1], tokens.chart[2], tokens.chart[3], tokens.primary.hover, tokens.gray[500]];
  const slices = data
    .map((d, i) => {
      const frac = d.value / total;
      const a2 = angle + frac * Math.PI * 2;
      const p1 = pt(angle, r);
      const p2 = pt(a2, r);
      const i1 = pt(a2, inner);
      const i2 = pt(angle, inner);
      const large = frac > 0.5 ? 1 : 0;
      const d0 =
        `M${p1[0].toFixed(2)},${p1[1].toFixed(2)} ` +
        `A${r},${r} 0 ${large} 1 ${p2[0].toFixed(2)},${p2[1].toFixed(2)} ` +
        `L${i1[0].toFixed(2)},${i1[1].toFixed(2)} ` +
        `A${inner},${inner} 0 ${large} 0 ${i2[0].toFixed(2)},${i2[1].toFixed(2)} Z`;
      angle = a2;
      const fill = d.color ?? palette[i % palette.length] ?? tokens.gray[400];
      return `<path d="${d0}" fill="${fill}" stroke="#fff" stroke-width="1.5"><title>${d.label}：${d.value}（${Math.round(frac * 100)}%）</title></path>`;
    })
    .join('');

  return (
    <svg
      data-testid={testId}
      data-component="chart-pie"
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={ariaLabel ?? '分类分布饼图'}
      style={{ maxWidth: 220, width: '100%', height: 'auto' }}
      dangerouslySetInnerHTML={{
        __html:
          slices +
          `<text x="${cx}" y="${cy - 4}" text-anchor="middle" font-size="20" font-weight="700" fill="${tokens.surface.text}">${total}</text>` +
          `<text x="${cx}" y="${cy + 14}" text-anchor="middle" font-size="11" fill="${tokens.surface.text3}">条（去重后）</text>`,
      }}
    />
  );
}

export interface BarDatum {
  label: string;
  value: number;
  color?: string;
}

export interface BarChartProps {
  data: BarDatum[];
  ariaLabel?: string;
  testId?: string;
}

/** 水平条形图（活跃度） */
export function BarChart({ data, ariaLabel, testId = 'chart-bar' }: BarChartProps) {
  if (!data || data.length === 0) {
    return <EmptyState title="暂无数据" testId="chart-bar-empty" />;
  }
  const max = Math.max(...data.map((d) => d.value), 1);
  return (
    <div
      data-testid={testId}
      data-component="chart-bar"
      role="img"
      aria-label={ariaLabel ?? '条形图'}
      style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
    >
      {data.map((d) => {
        const pct = Math.round((d.value / max) * 100);
        return (
          <div
            key={d.label}
            style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: tokens.fs.sm }}
          >
            <span style={{ flex: '0 0 96px', color: tokens.surface.text2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {d.label}
            </span>
            <span
              style={{
                flex: 1,
                height: 12,
                background: tokens.surface.surface2,
                borderRadius: tokens.radius.full,
                overflow: 'hidden',
              }}
            >
              <span
                style={{
                  display: 'block',
                  width: `${pct}%`,
                  height: '100%',
                  background: d.color ?? tokens.chart[1],
                }}
              />
            </span>
            <span style={{ flex: '0 0 40px', textAlign: 'right', color: tokens.surface.text3 }}>
              {d.value}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export default TrendChart;
