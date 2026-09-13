// exclude.mjs — 三级排除粒度（channel / item / category）
// ARCHITECTURE §11 — 匹配时机：归一化后、分类后、去重前
// P1 阶段先实现最小规则集：keyword / domain / channel 三种；title_regex 与 category 排除留 T-P1-07
import { readFileSync } from 'node:fs';

// 注：DOMAIN_RE 不去 www. 前缀——保留完整 host，让规则显式决定（'www.spam.com' 与 'spam.com' 是两个不同 host）
const DOMAIN_RE = /^https?:\/\/([^/?#:]+)/i;

/**
 * @typedef {Object} ExcludeRule
 * @property {string} id
 * @property {'channel'|'item'|'category'} level
 * @property {'global'|`source:${string}`|`channel:${string}`|`category:${string}`} scope
 * @property {'keyword'|'domain'|'url'|'title_regex'} [type]
 * @property {string|string[]} [value]
 * @property {'contains'|'equals'|'regex'} [matchMode]
 * @property {boolean} [caseSensitive]
 * @property {boolean} enabled
 */

/**
 * 加载 config/exclusions.json
 */
export function loadExcludeRules(configPath) {
  const data = JSON.parse(readFileSync(configPath, 'utf8'));
  return data.rules ?? [];
}

/**
 * 评估单条 item 是否应被排除
 * @param {Object} item
 * @param {ExcludeRule[]} rules
 * @returns {{excluded: boolean, hitRuleId?: string, hitField?: string, reason?: string}}
 */
export function evaluateItem(item, rules) {
  for (const rule of rules) {
    if (!rule.enabled) continue;
    if (!scopeMatches(rule, item)) continue;

    if (rule.level === 'item') {
      const hit = matchItem(item, rule);
      if (hit) return { excluded: true, hitRuleId: rule.id, hitField: hit.field, reason: hit.reason };
    } else if (rule.level === 'category') {
      const hit = matchCategory(item, rule);
      if (hit) return { excluded: true, hitRuleId: rule.id, hitField: 'category', reason: hit };
    }
    // level === 'channel' 在编排层一次性过滤（构造 allowedChannels set）
  }
  return { excluded: false };
}

/** 在编排层调用：返回被整源停用的渠道集合（level=channel） */
export function blockedChannels(rules) {
  const out = new Set();
  for (const r of rules) {
    if (r.enabled && r.level === 'channel' && r.scope.startsWith('channel:')) {
      out.add(r.scope.slice('channel:'.length));
    } else if (r.enabled && r.level === 'channel' && r.scope === 'global') {
      // global channel disable：value 是 channel id 数组
      const ids = Array.isArray(r.value) ? r.value : r.value ? [r.value] : [];
      ids.forEach((id) => out.add(id));
    }
  }
  return out;
}

function scopeMatches(rule, item) {
  switch (rule.scope) {
    case 'global':
      return true;
    default:
      if (rule.scope.startsWith('source:')) {
        return rule.scope.slice('source:'.length) === item.sourceId;
      }
      if (rule.scope.startsWith('channel:')) {
        return rule.scope.slice('channel:'.length) === item.channelId;
      }
      if (rule.scope.startsWith('category:')) {
        return (item.category ?? []).includes(rule.scope.slice('category:'.length));
      }
      return false;
  }
}

function matchItem(item, rule) {
  const type = rule.type ?? 'keyword';
  const mode = rule.matchMode ?? 'contains';
  const cs = rule.caseSensitive ?? false;
  const values = Array.isArray(rule.value) ? rule.value : [rule.value];

  if (type === 'keyword') {
    const text = `${item.title ?? ''}\n${item.summary ?? ''}`;
    for (const v of values) {
      const matched = cs ? text.includes(v) : text.toLowerCase().includes(String(v).toLowerCase());
      if (matched) return { field: 'title+summary', reason: `keyword:"${v}"` };
    }
  } else if (type === 'domain') {
    const url = item.url ?? '';
    const m = url.match(DOMAIN_RE);
    const host = m ? m[1].toLowerCase() : '';
    for (const v of values) {
      const target = String(v).toLowerCase();
      if (mode === 'equals' && host === target) return { field: 'url', reason: `domain:"${v}"` };
      if (mode === 'contains' && host.includes(target))
        return { field: 'url', reason: `domain contains:"${v}"` };
      if (mode === 'regex' && safeRegex(v).test(host)) return { field: 'url', reason: `domain regex:"${v}"` };
    }
  } else if (type === 'url') {
    for (const v of values) {
      if (mode === 'equals' && item.url === v) return { field: 'url', reason: `url:"${v}"` };
      if (mode === 'contains' && (item.url ?? '').includes(v))
        return { field: 'url', reason: `url contains:"${v}"` };
    }
  } else if (type === 'title_regex') {
    for (const v of values) {
      try {
        const re = safeRegex(v, !cs ? 'i' : '');
        if (re.test(item.title ?? '')) return { field: 'title', reason: `title_regex:"${v}"` };
      } catch {
        // 非法正则跳过
      }
    }
  }
  return null;
}

function matchCategory(item, rule) {
  const values = Array.isArray(rule.value) ? rule.value : [rule.value];
  for (const v of values) {
    if ((item.category ?? []).includes(v)) return `category:"${v}"`;
  }
  return null;
}

/**
 * 安全正则：检查 RegExp 构造是否触发危险回溯
 * P1 简化为 try/catch + 长度限制；P1-07 引入 re2 + safe-regex
 */
function safeRegex(pattern, flags = '') {
  if (typeof pattern !== 'string' || pattern.length > 256) {
    throw new Error('regex pattern too long');
  }
  return new RegExp(pattern, flags);
}

/**
 * 调试：列出某 itemId 被哪条规则命中
 */
export function explain(itemId, allItems, rules) {
  const item = allItems.find((i) => i.id === itemId);
  if (!item) return { found: false };
  const res = evaluateItem(item, rules);
  return { found: true, ...res };
}