// T-P3-02 公共组件库 — 配置抽屉（页面2）
//
// 渠道多选（按分类分组）+ 每卡片条数（5 / 10 / 20，默认 10）+ 卡片排序（按渠道名 / 按最近更新）
// +「恢复默认」按钮。受控组件：value / onChange / onReset 由页面持有。

import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import Drawer from '@mui/material/Drawer';
import FormControlLabel from '@mui/material/FormControlLabel';
import IconButton from '@mui/material/IconButton';
import ListItemText from '@mui/material/ListItemText';
import Radio from '@mui/material/Radio';
import RadioGroup from '@mui/material/RadioGroup';
import Typography from '@mui/material/Typography';
import type { CategoryKey } from '../types';
import { categoryLabel } from '../config/categories';
import { tokens } from '../theme/tokens';
import type { ChannelOption } from './FilterBar';
import type { StaleSourceMonths } from '../services/channelVisibility';

/** 看板卡片排序：按最近更新 / 按渠道名 */
export type ChannelSortKey = 'updatedAt' | 'channelName';

export interface ConfigDrawerValue {
  /** null = 全选（未配置）；[] = 显式取消全部（页面2 渲染全局空态） */
  channelIds: string[] | null;
  cardLimit: number;
  sort: ChannelSortKey;
  showFailedEmpty: boolean;
  showStaleSources: boolean;
  staleSourceMonths: StaleSourceMonths;
}

export const DEFAULT_CONFIG_DRAWER: ConfigDrawerValue = {
  channelIds: null,
  cardLimit: 10,
  sort: 'updatedAt',
  showFailedEmpty: false,
  showStaleSources: false,
  staleSourceMonths: 12,
};

export interface ConfigDrawerProps {
  open: boolean;
  onClose: () => void;
  channels: ChannelOption[];
  value: ConfigDrawerValue;
  onChange: (value: ConfigDrawerValue) => void;
  onReset?: () => void;
  testId?: string;
}

const CARD_LIMIT_OPTIONS = [5, 10, 20];

export default function ConfigDrawer({
  open,
  onClose,
  channels,
  value,
  onChange,
  onReset,
  testId = 'config-drawer',
}: ConfigDrawerProps) {
  const selected = value.channelIds;
  const isSelected = (id: string): boolean => selected === null || selected.includes(id);

  const toggleChannel = (id: string): void => {
    if (selected === null) {
      // 从「全选」变为「除该渠道外全选」
      onChange({ ...value, channelIds: channels.map((c) => c.id).filter((x) => x !== id) });
      return;
    }
    const next = selected.includes(id)
      ? selected.filter((x) => x !== id)
      : [...selected, id];
    // 允许取消到 0：[] = 显式取消全部渠道（页面2 转全局空态）。
    // 此前 `next.length === 0 ? null : next` 会把「取消干净」强制回退成 null
    // （= 全部启用），导致用户永远取消不干净、p2-empty 成死代码（QA B10）。
    onChange({ ...value, channelIds: next });
  };

  const groups = new Map<CategoryKey, ChannelOption[]>();
  for (const ch of channels) {
    const key = ch.category[0] ?? 'other';
    const list = groups.get(key);
    if (list) list.push(ch);
    else groups.set(key, [ch]);
  }

  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      data-testid={testId}
      slotProps={{ paper: { sx: { width: 340, p: 0 } } }}
    >
      <Box data-component="config-drawer" sx={{ p: 2, height: '100%', overflowY: 'auto' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Typography sx={{ fontWeight: 600, fontSize: tokens.fs.lg }}>看板设置</Typography>
          <IconButton size="small" onClick={onClose} aria-label="关闭">
            ×
          </IconButton>
        </Box>

        <Divider sx={{ my: 1.5 }} />

        <Typography sx={{ fontWeight: 600, mb: 1, fontSize: tokens.fs.base }}>渠道</Typography>
        <Box data-testid="config-drawer-channels">
          {[...groups.entries()].map(([cat, list]) => (
            <Box key={cat} sx={{ mb: 1.5 }}>
              <Typography sx={{ color: tokens.surface.text3, fontSize: tokens.fs.xs, mb: 0.5 }}>
                {categoryLabel(cat)}
              </Typography>
              {list.map((ch) => (
                <FormControlLabel
                  key={ch.id}
                  control={
                    <Checkbox
                      size="small"
                      checked={isSelected(ch.id)}
                      onChange={() => toggleChannel(ch.id)}
                    />
                  }
                  label={<ListItemText primary={ch.name} />}
                  sx={{ display: 'flex' }}
                />
              ))}
            </Box>
          ))}
        </Box>

        <Divider sx={{ my: 1.5 }} />

        <Typography sx={{ fontWeight: 600, mb: 1, fontSize: tokens.fs.base }}>每卡片条数</Typography>
        <RadioGroup
          row
          data-testid="config-drawer-cardlimit"
          value={String(value.cardLimit)}
          onChange={(e) => onChange({ ...value, cardLimit: Number(e.target.value) })}
        >
          {CARD_LIMIT_OPTIONS.map((n) => (
            <FormControlLabel
              key={n}
              value={String(n)}
              control={<Radio size="small" />}
              label={n === 10 ? <Chip size="small" label="10（默认）" /> : String(n)}
            />
          ))}
        </RadioGroup>

        <Divider sx={{ my: 1.5 }} />

        <Typography sx={{ fontWeight: 600, mb: 1, fontSize: tokens.fs.base }}>卡片展示</Typography>
        <FormControlLabel
          control={
            <Checkbox
              data-testid="config-drawer-show-failed-empty"
              size="small"
              checked={value.showFailedEmpty}
              onChange={(e) => onChange({ ...value, showFailedEmpty: e.target.checked })}
            />
          }
          label="展示抓取失败且无内容的渠道"
        />
        <FormControlLabel
          control={
            <Checkbox
              data-testid="config-drawer-show-stale"
              size="small"
              checked={value.showStaleSources}
              onChange={(e) => onChange({ ...value, showStaleSources: e.target.checked })}
            />
          }
          label="展示超过限制未更新的渠道"
        />
        <RadioGroup
          data-testid="config-drawer-stale-months"
          value={String(value.staleSourceMonths)}
          onChange={(e) =>
            onChange({ ...value, staleSourceMonths: Number(e.target.value) as StaleSourceMonths })
          }
          sx={{ ml: 1 }}
        >
          {[6, 12, 24].map((months) => (
            <FormControlLabel
              key={months}
              value={String(months)}
              control={<Radio size="small" />}
              label={months === 12 ? '1 年（默认）' : `${months === 6 ? '6 个月' : '2 年'}`}
            />
          ))}
        </RadioGroup>

        <Divider sx={{ my: 1.5 }} />

        <Typography sx={{ fontWeight: 600, mb: 1, fontSize: tokens.fs.base }}>卡片排序</Typography>
        <RadioGroup
          data-testid="config-drawer-sort"
          value={value.sort}
          onChange={(e) => onChange({ ...value, sort: e.target.value as ChannelSortKey })}
        >
          <FormControlLabel value="updatedAt" control={<Radio size="small" />} label="按最近更新" />
          <FormControlLabel value="channelName" control={<Radio size="small" />} label="按渠道名" />
        </RadioGroup>

        <Box sx={{ mt: 3 }}>
          <Button
            data-testid="p2-drawer-reset"
            fullWidth
            variant="outlined"
            onClick={() => {
              onChange(DEFAULT_CONFIG_DRAWER);
              onReset?.();
            }}
          >
            恢复默认
          </Button>
        </Box>
      </Box>
    </Drawer>
  );
}

export { CARD_LIMIT_OPTIONS };
