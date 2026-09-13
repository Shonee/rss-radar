// T-P3-02 公共组件库 — 日历（页面4）
//
// 月历网格（可翻月），标记 hasData 的日期，点选某天回调。
// 不引入 MUI X 依赖，用 CSS Grid 自绘（交互参考 prototype/page4.js）。

import { useMemo, useState } from 'react';
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import Typography from '@mui/material/Typography';
import { tokens } from '../theme/tokens';
import { pad2 } from '../config/site';

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

export interface DatePickerProps {
  /** 当前选中日期 'YYYY-MM-DD' */
  value: string | null;
  onSelect: (date: string) => void;
  /** 该日期是否包含数据（用于标记） */
  hasData?: (date: string) => boolean;
  /** 初始展示的月份 'YYYY-MM'（默认取 value 或当前月） */
  initialMonth?: string;
  testId?: string;
}

function toMonthKey(date: string): string {
  return date.slice(0, 7);
}

function currentMonthKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
}

/** 计算某月天数的网格（含前导空白） */
function buildGrid(monthKey: string): Array<string | null> {
  const [yStr, mStr] = monthKey.split('-');
  const year = Number(yStr);
  const month = Number(mStr);
  if (!Number.isFinite(year) || !Number.isFinite(month)) return [];
  const first = new Date(Date.UTC(year, month - 1, 1));
  const lead = first.getUTCDay();
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const cells: Array<string | null> = [];
  for (let i = 0; i < lead; i += 1) cells.push(null);
  for (let d = 1; d <= daysInMonth; d += 1) cells.push(`${year}-${pad2(month)}-${pad2(d)}`);
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

export default function DatePicker({
  value,
  onSelect,
  hasData,
  initialMonth,
  testId = 'date-picker',
}: DatePickerProps) {
  const [monthKey, setMonthKey] = useState<string>(
    initialMonth ?? (value ? toMonthKey(value) : currentMonthKey()),
  );

  const cells = useMemo(() => buildGrid(monthKey), [monthKey]);

  const shiftMonth = (delta: number): void => {
    const [yStr, mStr] = monthKey.split('-');
    const y = Number(yStr);
    const m = Number(mStr);
    if (!Number.isFinite(y) || !Number.isFinite(m)) return;
    const base = new Date(Date.UTC(y, m - 1 + delta, 1));
    setMonthKey(`${base.getUTCFullYear()}-${pad2(base.getUTCMonth() + 1)}`);
  };

  const [yStr, mStr] = monthKey.split('-');

  return (
    <Box
      data-testid={testId}
      data-component="date-picker"
      sx={{
        border: `1px solid ${tokens.surface.border}`,
        borderRadius: tokens.radius.md,
        bgcolor: tokens.surface.surface,
        p: 1.5,
        maxWidth: 320,
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
        <IconButton size="small" aria-label="上个月" onClick={() => shiftMonth(-1)}>
          ‹
        </IconButton>
        <Typography data-testid="date-picker-month" sx={{ fontWeight: 600, fontSize: tokens.fs.base }}>
          {yStr} 年 {Number(mStr)} 月
        </Typography>
        <IconButton size="small" aria-label="下个月" onClick={() => shiftMonth(1)}>
          ›
        </IconButton>
      </Box>

      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: 'repeat(7, 1fr)',
          gap: 0.5,
          mb: 0.5,
        }}
      >
        {WEEKDAYS.map((w) => (
          <Box
            key={w}
            sx={{ textAlign: 'center', fontSize: tokens.fs.xs, color: tokens.surface.text3 }}
          >
            {w}
          </Box>
        ))}
      </Box>

      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 0.5 }}>
        {cells.map((date, idx) => {
          if (!date) return <Box key={`empty-${idx}`} />;
          const selected = value === date;
          const has = hasData ? hasData(date) : false;
          return (
            <Box
              key={date}
              data-testid="p4-cal-day"
              data-date={date}
              data-has-data={has ? 'true' : 'false'}
              data-selected={selected ? 'true' : 'false'}
              role="button"
              tabIndex={0}
              onClick={() => onSelect(date)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') onSelect(date);
              }}
              sx={{
                textAlign: 'center',
                py: 0.75,
                borderRadius: tokens.radius.sm,
                cursor: 'pointer',
                fontSize: tokens.fs.sm,
                position: 'relative',
                bgcolor: selected ? tokens.primary.main : has ? tokens.primary.weak : 'transparent',
                color: selected ? tokens.primary.on : tokens.surface.text,
                '&:hover': { bgcolor: selected ? tokens.primary.hover : tokens.surface.hover },
              }}
            >
              {Number(date.slice(8))}
              {has && !selected && (
                <Box
                  aria-hidden
                  sx={{
                    position: 'absolute',
                    bottom: 2,
                    left: '50%',
                    transform: 'translateX(-50%)',
                    width: 4,
                    height: 4,
                    borderRadius: '50%',
                    bgcolor: tokens.primary.main,
                  }}
                />
              )}
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}
