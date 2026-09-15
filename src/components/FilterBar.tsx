// T-P3-02 公共组件库 — 筛选栏（受控组件：value / onChange 由页面持有）
//
// 渠道多选（按分类分组）、分类多选、时间范围（主理人 2026-09-15 再次收敛：今天 / 全部；
// 渲染顺序来自 `config/site.ts` 的 `TIME_RANGES`）、搜索框（标题 / 摘要）。

import Box from '@mui/material/Box';
import Checkbox from '@mui/material/Checkbox';
import Chip from '@mui/material/Chip';
import FormControl from '@mui/material/FormControl';
import InputLabel from '@mui/material/InputLabel';
import ListItemText from '@mui/material/ListItemText';
import ListSubheader from '@mui/material/ListSubheader';
import MenuItem from '@mui/material/MenuItem';
import OutlinedInput from '@mui/material/OutlinedInput';
import Select from '@mui/material/Select';
import TextField from '@mui/material/TextField';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import type { CategoryKey } from '../types';
import { categoryLabel } from '../config/categories';
import { TIME_RANGES } from '../config/site';
import type { TimeRangeKey } from '../services/time';
import { tokens } from '../theme/tokens';

// 时间档位类型的唯一来源是 `services/time.ts`（与 `TIME_RANGES` 及 `passesTimeRange` 同源），
// 此处仅原样再导出以保留既有公开 API（`components/index.ts` 引用）。
export type { TimeRangeKey };

export interface ChannelOption {
  id: string;
  name: string;
  category: CategoryKey[];
}

export interface FilterValue {
  channelIds: string[];
  categories: CategoryKey[];
  timeRange: TimeRangeKey;
  query: string;
}

export const EMPTY_FILTER: FilterValue = {
  channelIds: [],
  categories: [],
  timeRange: 'today',
  query: '',
};

export interface FilterBarProps {
  value: FilterValue;
  onChange: (value: FilterValue) => void;
  channels: ChannelOption[];
  timeRanges?: TimeRangeKey[];
  showSearch?: boolean;
  testId?: string;
}

const TIME_RANGE_LABELS: Record<TimeRangeKey, string> = {
  today: '今天',
  all: '全部',
};

export default function FilterBar({
  value,
  onChange,
  channels,
  timeRanges = TIME_RANGES,
  showSearch = true,
  testId = 'filter-bar',
}: FilterBarProps) {
  // 渠道按分类分组
  const groups = new Map<CategoryKey, ChannelOption[]>();
  for (const ch of channels) {
    const key = ch.category[0] ?? 'other';
    const list = groups.get(key);
    if (list) list.push(ch);
    else groups.set(key, [ch]);
  }

  const patch = (part: Partial<FilterValue>): void => onChange({ ...value, ...part });

  return (
    <Box
      data-testid={testId}
      data-component="filter-bar"
      sx={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 1.5,
        alignItems: 'center',
        p: 1.5,
        border: `1px solid ${tokens.surface.border}`,
        borderRadius: tokens.radius.md,
        bgcolor: tokens.surface.surface,
      }}
    >
      <FormControl size="small" sx={{ minWidth: 160 }}>
        <InputLabel id="rr-filter-channel-label">渠道</InputLabel>
        <Select
          data-testid="filter-channel"
          labelId="rr-filter-channel-label"
          multiple
          value={value.channelIds}
          onChange={(e) => {
            const v = e.target.value;
            patch({ channelIds: typeof v === 'string' ? v.split(',') : v });
          }}
          input={<OutlinedInput label="渠道" />}
          renderValue={(selected) => (
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
              {selected.map((id) => (
                <Chip key={id} size="small" label={channels.find((c) => c.id === id)?.name ?? id} />
              ))}
            </Box>
          )}
          MenuProps={{ autoFocus: false }}
        >
          {[...groups.entries()].map(([cat, list]) => [
            <ListSubheader key={`group-${cat}`}>{categoryLabel(cat)}</ListSubheader>,
            ...list.map((ch) => (
              <MenuItem key={ch.id} value={ch.id}>
                <Checkbox checked={value.channelIds.includes(ch.id)} size="small" />
                <ListItemText primary={ch.name} />
              </MenuItem>
            )),
          ])}
        </Select>
      </FormControl>

      <FormControl size="small" sx={{ minWidth: 160 }}>
        <InputLabel id="rr-filter-cat-label">分类</InputLabel>
        <Select
          data-testid="filter-category"
          labelId="rr-filter-cat-label"
          multiple
          value={value.categories}
          onChange={(e) => {
            const v = e.target.value;
            patch({ categories: (typeof v === 'string' ? v.split(',') : v) as CategoryKey[] });
          }}
          input={<OutlinedInput label="分类" />}
          renderValue={(selected) => (
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
              {selected.map((key) => (
                <Chip key={key} size="small" label={categoryLabel(key)} />
              ))}
            </Box>
          )}
        >
          {(Object.keys(categoryLabelMap()) as CategoryKey[]).map((key) => (
            <MenuItem key={key} value={key}>
              <Checkbox checked={value.categories.includes(key)} size="small" />
              <ListItemText primary={categoryLabel(key)} />
            </MenuItem>
          ))}
        </Select>
      </FormControl>

      <ToggleButtonGroup
        data-testid="filter-time-range"
        size="small"
        exclusive
        value={value.timeRange}
        onChange={(_, next: TimeRangeKey | null) => {
          if (next) patch({ timeRange: next });
        }}
      >
        {timeRanges.map((r) => (
          <ToggleButton key={r} value={r} data-testid={`p1-filter-time-${r}`}>
            {TIME_RANGE_LABELS[r]}
          </ToggleButton>
        ))}
      </ToggleButtonGroup>

      {showSearch && (
        <TextField
          data-testid="p1-search"
          size="small"
          placeholder="搜索标题 / 摘要"
          value={value.query}
          onChange={(e) => patch({ query: e.target.value })}
          sx={{ flex: '1 1 200px', minWidth: 160 }}
        />
      )}
    </Box>
  );
}

function categoryLabelMap(): Record<CategoryKey, string> {
  // 轻量取全部分类键（用于下拉选项）
  const keys: CategoryKey[] = [
    'tech_blog',
    'tech_media',
    'ai',
    'news',
    'dev_community',
    'podcast',
    'newsletter',
    'finance',
    'product_design',
    'video',
    'security',
    'opensource',
    'other',
  ];
  const out = {} as Record<CategoryKey, string>;
  for (const k of keys) out[k] = categoryLabel(k);
  return out;
}
