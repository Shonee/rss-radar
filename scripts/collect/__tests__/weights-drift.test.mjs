// scripts/collect/__tests__/weights-drift.test.mjs — 权重口径漂移守卫
//
// 背景：历史上 `config/site-config.json → analysis.weights` 的 frequency / recency
// 两个键被写反（frequency 0.25 / recency 0.20），且该配置长期无调用方（dead config），
// 直到 T-P3 才接线。本测试把「配置文件口径」与「代码权威口径」锁死：
//   - 代码权威 = scripts/collect/lib/hot-score.mjs 的 DEFAULT_WEIGHTS / DEFAULT_HALF_LIFE_HOURS
//   - 配置 = config/site-config.json → analysis.weights / analysis.halfLifeHours
// 任一侧漂移 => 该测试红，从而在 CI 阶段拦截同类回归。
//
// 说明：权重 5 键逐项比对（容差 1e-9）；halfLifeHours 取 analysis.halfLifeHours。
// 前端 src/services/hotScore.ts 的 CONFIG_WEIGHTS 亦以同一配置为源，注释见该文件。

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';

import {
  DEFAULT_WEIGHTS,
  DEFAULT_HALF_LIFE_HOURS,
} from '../lib/hot-score.mjs';

const TOL = 1e-9;

/** 读取仓库根目录下的 config/site-config.json（相对本测试文件定位，避免依赖 cwd） */
function loadSiteConfig() {
  const url = new URL('../../../config/site-config.json', import.meta.url);
  return JSON.parse(readFileSync(url, 'utf8'));
}

const WEIGHT_KEYS = [
  'sourceOverlap',
  'recency',
  'frequency',
  'channelWeight',
  'keywordHeat',
];

test('config.analysis.weights 与 hot-score.mjs DEFAULT_WEIGHTS 逐项一致（容差 1e-9）', () => {
  const cfg = loadSiteConfig();
  const w = cfg?.analysis?.weights;
  assert.ok(w && typeof w === 'object', 'config/site-config.json 缺少 analysis.weights');

  for (const key of WEIGHT_KEYS) {
    assert.ok(
      typeof w[key] === 'number',
      `analysis.weights.${key} 缺失或非数字（实际 ${JSON.stringify(w[key])}）`,
    );
    assert.ok(
      Math.abs(w[key] - DEFAULT_WEIGHTS[key]) < TOL,
      `analysis.weights.${key} 漂移：配置=${w[key]} 代码=${DEFAULT_WEIGHTS[key]}`,
    );
  }
});

test('config.analysis.weights 键集合与 DEFAULT_WEIGHTS 完全一致（无多余键）', () => {
  const cfg = loadSiteConfig();
  const w = cfg?.analysis?.weights ?? {};
  const cfgKeys = Object.keys(w).sort();
  const codeKeys = Object.keys(DEFAULT_WEIGHTS).sort();
  assert.deepEqual(
    cfgKeys,
    codeKeys,
    `analysis.weights 键集合漂移：配置=[${cfgKeys}] 代码=[${codeKeys}]`,
  );
});

test('config.analysis.weights 的 frequency/recency 方向正确（回归：曾被写反）', () => {
  const cfg = loadSiteConfig();
  const w = cfg?.analysis?.weights ?? {};
  // 权威口径：recency(0.25) > frequency(0.20)。写反则本条红。
  assert.ok(
    w.recency > w.frequency,
    `权重方向疑似写反：recency=${w.recency} 应 > frequency=${w.frequency}`,
  );
});

test('config.analysis.halfLifeHours 与 DEFAULT_HALF_LIFE_HOURS 一致', () => {
  const cfg = loadSiteConfig();
  const h = cfg?.analysis?.halfLifeHours;
  assert.ok(typeof h === 'number', `analysis.halfLifeHours 缺失或非数字（实际 ${JSON.stringify(h)}）`);
  assert.ok(
    Math.abs(h - DEFAULT_HALF_LIFE_HOURS) < TOL,
    `halfLifeHours 漂移：配置=${h} 代码=${DEFAULT_HALF_LIFE_HOURS}`,
  );
});

test('DEFAULT_WEIGHTS 权重和 = 1（ARCH §5.2）', () => {
  const sum = WEIGHT_KEYS.reduce((acc, k) => acc + DEFAULT_WEIGHTS[k], 0);
  assert.ok(Math.abs(sum - 1) < TOL, `权重和应为 1，实际 ${sum}`);
});
