// scripts/notify/template.mjs — 通知消息模板（ARCHITECTURE §12.4）
// 对应 IMPLEMENTATION_PLAN T-P3-07
//
// 设计：一份 Markdown 源（日报 / 实时），再按渠道转 text / markdown / html。
//   - 日报模板：renderDailyDigestMarkdown({ report, siteConfig, date })
//   - 实时模板：renderRealtimeMarkdown({ items, trigger, time })
//   - 渠道转换：markdownToText / markdownToHtml
//   - 截断：TopN 上限 5、单条标题 60 字、总长 4000 字（飞书 text ≤20KB 的保守值）

import { localDate, localHHmm } from './lib/clock.mjs';

export const MAX_TOP_N = 5;
export const TITLE_MAX = 60;
export const MAX_MESSAGE_LEN = 4000;
export const ELLIPSIS = '…';

/**
 * 标题截断：超长取前 max 字符 + 省略号。
 * @param {string} title
 * @param {number} [max=TITLE_MAX]
 * @returns {string}
 */
export function truncateTitle(title, max = TITLE_MAX) {
  const s = String(title ?? '').trim();
  if (s.length <= max) return s;
  return s.slice(0, max) + ELLIPSIS;
}

/**
 * 整体正文截断（防超限）。
 * @param {string} body
 * @param {number} [max=MAX_MESSAGE_LEN]
 * @returns {string}
 */
export function truncateBody(body, max = MAX_MESSAGE_LEN) {
  const s = String(body ?? '');
  if (s.length <= max) return s;
  return s.slice(0, max) + ELLIPSIS;
}

function fixed2(n) {
  const v = Number(n);
  return Number.isFinite(v) ? v.toFixed(2) : '0.00';
}

function sourceNames(item = {}) {
  if (Array.isArray(item.channelNames) && item.channelNames.length > 0) return item.channelNames;
  if (item.channelName) return [item.channelName];
  return [];
}

/**
 * 站点链接解析（用于「完整报告」行）。
 * 优先级：siteConfig.site.pages → siteConfig.site.url/baseUrl → env → 相对路径兜底。
 * @param {Object} [siteConfig={}]
 * @param {Object} [env=process.env]
 * @returns {{base:string, today:string, history:string}}
 */
export function resolveSiteLinks(siteConfig = {}, env = process.env) {
  const site = siteConfig.site ?? {};
  const pages = site.pages ?? {};
  const rawBase = pages.base ?? site.url ?? site.baseUrl ?? env?.SITE_BASE_URL ?? env?.RSS_RADAR_SITE_URL ?? '';
  const base = String(rawBase).replace(/\/+$/, '');
  const today = pages.today ?? (base ? `${base}/today/` : '/today/');
  const history = pages.history ?? (base ? `${base}/history/` : '/history/');
  return { base, today, history };
}

/**
 * 生成日报 Markdown（ARCHITECTURE §12.4）。
 * @param {Object} params
 * @param {Object} [params.report={}]        report.json 结构（见 docs/data-model/examples/report.example.json）
 * @param {Object} [params.siteConfig={}]    站点配置（取链接）
 * @param {string} [params.date]             覆盖日期（默认 report.date / 今日）
 * @param {Object} [params.env=process.env]
 * @returns {string} Markdown
 */
export function renderDailyDigestMarkdown({ report = {}, siteConfig = {}, date, env = process.env } = {}) {
  const d = date ?? report.date ?? localDate();
  const totalItems = report.totalItems ?? 0;
  const activeChannels = report.activeChannels ?? 0;
  const categoryStats = Array.isArray(report.categoryStats) ? report.categoryStats : [];
  const hotList = Array.isArray(report.hotList) ? report.hotList.slice(0, MAX_TOP_N) : [];
  const links = resolveSiteLinks(siteConfig, env);

  const lines = [];
  lines.push(`## 📡 RSS Radar 日报 · ${d}（Asia/Shanghai）`);
  lines.push('');
  lines.push(`**概要**：今日共采集 **${totalItems}** 条，**${activeChannels}** 个渠道活跃，涉及 **${categoryStats.length}** 个分类。`);
  lines.push('');

  const topLabel = hotList.length > 0 ? hotList.length : MAX_TOP_N;
  lines.push(`**🔥 热点 Top ${topLabel}**`);
  if (hotList.length === 0) {
    lines.push('（暂无热点）');
  } else {
    hotList.forEach((item, i) => {
      const src = sourceNames(item).join('、') || '未知来源';
      lines.push(`${i + 1}. ${truncateTitle(item.title)}（来源：${src}｜热度 ${fixed2(item.hotScore)}）${item.url ?? ''}`);
    });
  }
  lines.push('');

  const catLine = categoryStats.length > 0
    ? categoryStats.map((c) => `${c.label ?? c.category} ${c.itemCount ?? 0}`).join(' · ')
    : '（暂无）';
  lines.push(`**📊 分类分布**：${catLine}`);
  lines.push(`**🔗 完整报告**：${links.today} · ${links.history}`);

  return truncateBody(lines.join('\n'));
}

/**
 * 生成实时热点 Markdown（ARCHITECTURE §12.4）。
 * @param {Object} params
 * @param {Array<Object>} [params.items=[]]
 * @param {Object} [params.trigger={}]        { reason?, itemId?, config? }
 * @param {string} [params.time]              HH:mm（默认当前 Asia/Shanghai）
 * @returns {string} Markdown
 */
export function renderRealtimeMarkdown({ items = [], trigger = {}, time } = {}) {
  const hhmm = time ?? localHHmm();
  const top = Array.isArray(items) ? items.slice(0, MAX_TOP_N) : [];
  const lines = [];
  lines.push(`## ⚡ 实时热点 · ${hhmm}`);
  lines.push('');

  if (top.length === 0) {
    lines.push('（无触发条目）');
    return truncateBody(lines.join('\n'));
  }

  top.forEach((item, idx) => {
    const src = sourceNames(item).join('、') || '未知来源';
    const sourceCount = item.sourceCount ?? sourceNames(item).length ?? 1;
    lines.push(`**${truncateTitle(item.title)}**（来源：${src}｜跨源 ${sourceCount}｜热度 ${fixed2(item.hotScore)}）`);
    lines.push(`**为什么推**：${item.reason ?? trigger.reason ?? autoReason(item, trigger.config)}`);
    lines.push(`**原文**：${item.url ?? ''}`);
    if (idx < top.length - 1) lines.push('');
  });

  return truncateBody(lines.join('\n'));
}

/**
 * 自动生成「为什么推」文案（未显式提供 reason 时）。
 * @param {Object} item
 * @param {Object} [config={}]
 * @returns {string}
 */
export function autoReason(item = {}, config = {}) {
  const hotThreshold = config.hotScoreThreshold ?? config.realtime?.hotScoreThreshold ?? 0.8;
  const srcThreshold = config.sourceCountThreshold ?? config.realtime?.sourceCountThreshold ?? 3;
  const reasons = [];
  if ((item.sourceCount ?? 0) >= srcThreshold) reasons.push(`跨源 sourceCount=${item.sourceCount} 达阈值(${srcThreshold})`);
  if ((item.hotScore ?? 0) >= hotThreshold) reasons.push(`热度 hotScore=${fixed2(item.hotScore)} 达阈值(${hotThreshold})`);
  return reasons.length > 0 ? reasons.join('；') : '命中实时推送阈值';
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function inline(text) {
  let s = escapeHtml(text);
  s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(https?:\/\/[^\s<）)]+)/g, '<a href="$1">$1</a>');
  return s;
}

/**
 * Markdown → 纯文本（飞书 text / 兜底）。
 * @param {string} md
 * @returns {string}
 */
export function markdownToText(md) {
  return String(md ?? '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/^>\s?/gm, '')
    .replace(/\[(.+?)\]\((.+?)\)/g, '$1 ($2)')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Markdown → HTML（邮件）。
 * @param {string} md
 * @param {{title?:string}} [opts={}]
 * @returns {string} 完整 HTML 文档
 */
export function markdownToHtml(md, opts = {}) {
  const title = opts.title ?? 'RSS Radar';
  const body = [];
  for (const line of String(md ?? '').split('\n')) {
    const t = line.trim();
    if (t === '') { body.push(''); continue; }
    let m;
    if ((m = /^###\s+(.*)$/.exec(t))) { body.push(`<h3>${inline(m[1])}</h3>`); continue; }
    if ((m = /^##\s+(.*)$/.exec(t))) { body.push(`<h2>${inline(m[1])}</h2>`); continue; }
    if ((m = /^#\s+(.*)$/.exec(t))) { body.push(`<h1>${inline(m[1])}</h1>`); continue; }
    if ((m = /^\d+\.\s+(.*)$/.exec(t))) { body.push(`<p class="li">${inline(m[1])}</p>`); continue; }
    if ((m = /^[-*]\s+(.*)$/.exec(t))) { body.push(`<p class="li">• ${inline(m[1])}</p>`); continue; }
    if ((m = /^>\s?(.*)$/.exec(t))) { body.push(`<blockquote>${inline(m[1])}</blockquote>`); continue; }
    body.push(`<p>${inline(t)}</p>`);
  }
  return [
    '<!doctype html>',
    '<html><head><meta charset="utf-8">',
    `<title>${escapeHtml(title)}</title>`,
    '</head>',
    '<body style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;line-height:1.6;color:#24292f;max-width:640px;margin:0 auto;padding:16px;">',
    body.join('\n'),
    '</body></html>',
  ].join('\n');
}
