/* =============================================================================
 * RSS Radar — 通用渲染组件（四个页面共用）
 * -----------------------------------------------------------------------------
 * 提供：格式化工具 / 内联图标 / 站点头部与页脚 / 标签·徽标 / 条目行 / 渠道卡片 /
 *       骨架屏 / 空态 / 进度条 / 饼图·条形图·趋势折线图（纯原生 SVG）/ Toast。
 * 依赖：mock-data.js、store.js（可选）
 * ========================================================================== */

window.RR = (function () {
  'use strict';

  var MOCK = window.RR_MOCK;

  /* =========================================================================
   * 1. 通用工具
   * ====================================================================== */
  var TZ_OFFSET_MS = 8 * 3600 * 1000; // Asia/Shanghai (GMT+8)

  function esc(s) {
    if (s === null || s === undefined) { return ''; }
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  /** 转成 GMT+8 的各时间分量。 */
  function cnParts(ms) {
    var d = new Date(ms + TZ_OFFSET_MS);
    return {
      y: d.getUTCFullYear(), mo: pad2(d.getUTCMonth() + 1), d: pad2(d.getUTCDate()),
      h: pad2(d.getUTCHours()), mi: pad2(d.getUTCMinutes()),
      dow: d.getUTCDay()
    };
  }

  /** 绝对时间：YYYY-MM-DD HH:mm（GMT+8）——用于 title 悬浮提示。 */
  function formatAbsolute(iso) {
    if (!iso) { return '—'; }
    var p = cnParts(new Date(iso).getTime());
    return p.y + '-' + p.mo + '-' + p.d + ' ' + p.h + ':' + p.mi + '（GMT+8）';
  }

  /** 日期：YYYY-MM-DD（GMT+8）。 */
  function formatDate(iso) {
    if (!iso) { return '—'; }
    var p = cnParts(new Date(iso).getTime());
    return p.y + '-' + p.mo + '-' + p.d;
  }

  /** 相对时间：以 NOW 为基准（保证原型展示稳定）。 */
  function formatRelative(iso, nowIso) {
    if (!iso) { return '—'; }
    var now = new Date(nowIso || (MOCK && MOCK.NOW) || Date.now()).getTime();
    var t = new Date(iso).getTime();
    var diff = now - t;
    if (diff < 0) { diff = 0; }
    var sec = Math.floor(diff / 1000);
    if (sec < 60) { return '刚刚'; }
    var min = Math.floor(sec / 60);
    if (min < 60) { return min + ' 分钟前'; }
    var hr = Math.floor(min / 60);
    if (hr < 24) { return hr + ' 小时前'; }
    var day = Math.floor(hr / 24);
    if (day < 30) { return day + ' 天前'; }
    return formatDate(iso);
  }

  /** 渲染相对时间 span（title 放绝对时间）。 */
  function timeEl(iso, prefix) {
    return '<time class="time" title="' + esc(formatAbsolute(iso)) + '">' +
      esc((prefix || '') + formatRelative(iso)) + '</time>';
  }

  function num(n) {
    if (n === null || n === undefined) { return '—'; }
    return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  /** 读取 CSS 设计令牌（tokens.css 的 CSS 变量）——供 JS 侧图表复用，避免硬编码色值。 */
  function cssVar(name) {
    try {
      return window.getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    } catch (e) {
      return '';
    }
  }

  /** 分类 key → 元数据。 */
  function catMeta(key) {
    return (MOCK && MOCK.catByKey && MOCK.catByKey[key]) || { key: key, label: key, color: '#757575' };
  }

  /** 取渠道对象。 */
  function channel(id) { return (MOCK && MOCK.channelById && MOCK.channelById[id]) || null; }

  /* =========================================================================
   * 2. 内联图标（全部内联 SVG，零 CDN 依赖）
   * ====================================================================== */
  var ICONS = {
    radar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4.5"/><path d="M12 12l6-4"/></svg>',
    rss: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 11a9 9 0 0 1 9 9"/><path d="M4 4a16 16 0 0 1 16 16"/><circle cx="5" cy="19" r="1.5" fill="currentColor"/></svg>',
    stream: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><circle cx="3.5" cy="6" r="1.5" fill="currentColor"/><circle cx="3.5" cy="12" r="1.5" fill="currentColor"/><circle cx="3.5" cy="18" r="1.5" fill="currentColor"/></svg>',
    board: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>',
    report: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19V5"/><path d="M4 19h16"/><rect x="7" y="11" width="3" height="5"/><rect x="12" y="7" width="3" height="9"/><rect x="17" y="13" width="3" height="3"/></svg>',
    history: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v4h4"/><path d="M12 8v4l3 2"/></svg>',
    external: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6"/><path d="M10 14L21 3"/><path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5"/></svg>',
    home: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/></svg>',
    search: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>',
    settings: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2 2 2 0 1 1-4 0 1.7 1.7 0 0 0-2.9-1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 4.6 15a2 2 0 1 1 0-4 1.7 1.7 0 0 0 1.2-2.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.7 1.7 0 0 0 11.5 4a2 2 0 1 1 4 0 1.7 1.7 0 0 0 2.9 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1A1.7 1.7 0 0 0 19.4 11a2 2 0 1 1 0 4z"/></svg>',
    close: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    chevron: '<svg class="chev" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>',
    alert: '<svg class="alert-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 9v4"/><path d="M12 17h.01"/><path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/></svg>',
    info: '<svg class="alert-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 8h.01"/></svg>',
    source: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3v18"/><path d="M6 4h11l-2 3 2 3H6"/></svg>',
    inbox: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 13l2.5-7h11L20 13"/><path d="M4 13h5l1 2h4l1-2h5v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/></svg>',
    calendar: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 9h18"/><path d="M8 3v4M16 3v4"/></svg>',
    download: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="M7 10l5 5 5-5"/><path d="M5 21h14"/></svg>',
    archive: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="4" rx="1"/><path d="M5 8v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8"/><path d="M10 12h4"/></svg>',
    refresh: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 4v5h-5"/></svg>'
  };

  /* =========================================================================
   * 3. 基础展示组件
   * ====================================================================== */

  /** 分类标签。 */
  function catTag(key) {
    var m = catMeta(key);
    return '<span class="tag tag-cat" style="--tag-color:' + esc(m.color) + '">' + esc(m.label) + '</span>';
  }

  /** 渠道徽标（链接到渠道首页）。 */
  function channelBadge(channelId, channelName) {
    var ch = channel(channelId);
    var name = channelName || (ch ? ch.name : channelId);
    var url = ch ? ch.homepage : '#';
    return '<a class="badge-channel" href="' + esc(url) + '" target="_blank" rel="noopener">' +
      esc(name) + '</a>';   // v1.3 B：去掉首字 icon 前缀
  }

  function newBadge() { return '<span class="badge-new" title="今日新增">NEW</span>'; }

  /** 「+N 源」跨源徽标。 */
  function sourceBadge(item) {
    var n = item.sourceCount || 1;
    if (n <= 1) { return ''; }
    return '<button type="button" class="badge-source" data-toggle-sources="' + esc(item.id) + '" ' +
      'aria-expanded="false" aria-label="展开 ' + n + ' 个来源渠道">＋' + (n - 1) + ' 源</button>';
  }

  /** 渠道 / 源健康状态。 */
  function healthStatus(channelId) {
    var ch = channel(channelId);
    if (ch && ch.enabled === false) { return { key: 'disabled', label: '停用' }; }
    var srcs = (MOCK && MOCK.sourceByChannel && MOCK.sourceByChannel[channelId]) || [];
    var hasError = srcs.some(function (s) { return s.lastStatus === 'error'; });
    if (hasError) { return { key: 'error', label: '抓取失败' }; }
    var allEmpty = srcs.length > 0 && srcs.every(function (s) { return s.lastStatus === 'empty'; });
    if (allEmpty) { return { key: 'empty', label: '无新内容' }; }
    return { key: 'ok', label: '正常' };
  }

  function statusEl(channelId) {
    var st = healthStatus(channelId);
    return '<span class="status status-' + st.key + '" title="渠道健康状态">' + esc(st.label) + '</span>';
  }

  /* =========================================================================
   * 4. 站点头部 / 页脚（四页共用，导航互通）
   * ====================================================================== */
  var NAV = [
    { key: 'page1', href: 'page1-hot-stream.html', label: '聚合热榜流', icon: 'stream' },
    { key: 'page2', href: 'page2-channels.html',   label: '渠道看板',   icon: 'board' },
    { key: 'page3', href: 'page3-report.html',     label: '分析报告',   icon: 'report' },
    { key: 'page4', href: 'page4-history.html',    label: '历史趋势',   icon: 'history' }
  ];

  function siteHeader(activeKey) {
    var s = (MOCK && MOCK.site && MOCK.site.site) || {};
    var navHtml = NAV.map(function (n) {
      var cur = (n.key === activeKey) ? ' aria-current="page"' : '';
      return '<a href="' + n.href + '"' + cur + '>' + ICONS[n.icon] +
        '<span class="nav-label">' + esc(n.label) + '</span></a>';
    }).join('');
    return '' +
      '<a class="skip-link" href="#main">跳到主要内容</a>' +
      '<header class="site-header">' +
        '<div class="container">' +
          '<div class="brand">' +
            '<span class="brand-mark">' + ICONS.radar + '</span>' +
            '<div>' +
              '<div class="brand-name">' + esc(s.title || 'RSS Radar') + '</div>' +
              '<div class="brand-slogan">' + esc(s.slogan || '') + '</div>' +
            '</div>' +
          '</div>' +
          '<nav class="main-nav" aria-label="主导航">' + navHtml + '</nav>' +
        '</div>' +
      '</header>';
  }

  function siteFooter() {
    var s = (MOCK && MOCK.site && MOCK.site.site) || {};
    return '' +
      '<footer class="site-footer">' +
        '<div class="container">' +
          '<div class="footer-links">' +
            NAV.map(function (n) { return '<a href="' + n.href + '">' + esc(n.label) + '</a>'; }).join('') +
            '<a href="index.html">原型导航</a>' +
          '</div>' +
          '<p>' + esc(s.footer || '') + '</p>' +
          '<p class="muted">原型演示 · 数据为 Mock，结构对齐 docs/data-model/examples/ · 本页不发起任何真实网络请求。</p>' +
        '</div>' +
      '</footer>';
  }

  /* =========================================================================
   * 5. 条目行（页面1）
   * ====================================================================== */
  function itemRow(item, opts) {
    opts = opts || {};
    var ch = channel(item.channelId);
    var homepage = ch ? ch.homepage : '#';
    var cats = (item.category || []).map(catTag).join(' ');
    var rankHtml = '';
    if (opts.rank) {
      rankHtml = '<div class="item-rank' + (opts.rank <= 3 ? ' top' : '') + '">' + opts.rank + '</div>';
    }
    var sourcesPanel = '';
    if ((item.sourceCount || 1) > 1 && item.sources) {
      sourcesPanel = '<div class="source-panel hidden" data-source-panel="' + esc(item.id) + '">' +
        '<div class="muted" style="margin-bottom:6px">该条内容被 ' + item.sourceCount + ' 个渠道报道：</div>' +
        '<ul>' + item.sources.map(function (s) {
          return '<li>' + ICONS.source + '<span>' + esc(s.channelName) + '</span>' +
            '<a href="' + esc(s.url) + '" target="_blank" rel="noopener">原文</a>' +
            '<span class="muted">· ' + esc(formatRelative(s.publishedAt)) + '</span></li>';
        }).join('') + '</ul></div>';
    }
    return '' +
      '<article class="item" data-item-id="' + esc(item.id) + '">' +
        rankHtml +
        '<div class="item-main">' +
          '<a class="item-title" href="' + esc(item.url) + '" target="_blank" rel="noopener">' + esc(item.title) + '</a>' +
          (item.summary ? '<p class="item-summary" data-summary="' + esc(item.id) + '">' + esc(item.summary) + '</p>' : '') +
          '<div class="item-meta">' +
            channelBadge(item.channelId, item.channelName) +
            cats +
            '<span class="sep" aria-hidden="true"></span>' +
            '<span class="muted" style="font-size:var(--fs-xs)">创建</span>' + timeEl(item.publishedAt) +
            '<span class="muted" style="font-size:var(--fs-xs)">更新</span>' + timeEl(item.updatedAt) +
            (item.isNew ? newBadge() : '') +
            sourceBadge(item) +
            '<div class="item-actions">' +
              '<a class="btn btn-sm" href="' + esc(item.url) + '" target="_blank" rel="noopener" title="在新窗口打开原文">原文' + ICONS.external + '</a>' +
              '<a class="btn btn-sm" href="' + esc(homepage) + '" target="_blank" rel="noopener" title="打开渠道首页">渠道主页' + ICONS.home + '</a>' +
            '</div>' +
          '</div>' +
          sourcesPanel +
        '</div>' +
      '</article>';
  }

  /* =========================================================================
   * 6. 渠道卡片（页面2）
   * ====================================================================== */
  function channelCard(ch, its, limit) {
    var st = healthStatus(ch.id);
    var srcs = (MOCK.sourceByChannel && MOCK.sourceByChannel[ch.id]) || [];
    var feedUrl = srcs.length ? srcs[0].url : '';
    var lastUpdated = its.length ? its[0].updatedAt : null;
    var shown = its.slice(0, limit);
    var cats = (ch.category || []).map(catTag).join(' ');

    var itemsHtml = shown.length ? shown.map(function (it) {
      return '<a class="chan-item" href="' + esc(it.url) + '" target="_blank" rel="noopener">' +
        '<span class="chan-item-title">' + esc(it.title) + '</span>' +
        '<span class="chan-item-meta">' + timeEl(it.updatedAt) +
        (it.sourceCount > 1 ? '<span class="badge-source" style="pointer-events:none">＋' + (it.sourceCount - 1) + ' 源</span>' : '') +
        '</span></a>';
    }).join('') : '<div class="empty" style="padding:var(--space-6)"><div class="empty-desc">暂无内容</div></div>';

    var moreHtml = '';
    if (its.length > limit) {
      moreHtml = '<a class="chan-more" href="page1-hot-stream.html?channel=' + encodeURIComponent(ch.id) + '">查看全部 ' + its.length + ' 条 →</a>';
    }

    var feedHtml = feedUrl
      ? '<button type="button" class="btn btn-ghost btn-icon" title="Feed 源地址：' + esc(feedUrl) + '" aria-label="查看 Feed 源地址" data-feed="' + esc(feedUrl) + '">' + ICONS.source + '</button>'
      : '';
    // v1.3 C：看板卡片增加官网跳转图标（ch.homepage 有则展示，无则不展示）
    var homepageHtml = ch.homepage
      ? '<a class="btn btn-ghost btn-icon" href="' + esc(ch.homepage) + '" target="_blank" rel="noopener" title="打开渠道首页：' + esc(ch.homepage) + '" aria-label="打开渠道首页">' + ICONS.external + '</a>'
      : '';

    return '' +
      '<article class="card chan-card' + (st.key === 'error' ? ' is-failed' : '') + '">' +
        '<div class="chan-head">' +
          '<span class="avatar" aria-hidden="true">' + esc(ch.icon || ch.name.charAt(0)) + '</span>' +
          '<div class="chan-title">' +
            '<a class="chan-name" href="' + esc(ch.homepage) + '" target="_blank" rel="noopener" title="打开渠道首页">' + esc(ch.name) + '</a>' +
            '<div class="chan-sub">' + cats + statusEl(ch.id) + '</div>' +
          '</div>' +
          feedHtml + homepageHtml +
        '</div>' +
        '<div class="chan-stats">' +
          '<span>最后更新：<strong>' + esc(lastUpdated ? formatRelative(lastUpdated) : '—') + '</strong></span>' +
          '<span>今日 <strong>' + its.length + '</strong> 条</span>' +
        '</div>' +
        '<div class="chan-body">' + itemsHtml + '</div>' +
        moreHtml +
      '</article>';
  }

  /* =========================================================================
   * 7. 骨架屏 / 空态
   * ====================================================================== */
  function skeletonList(n) {
    var one = '<div class="card card-pad" style="margin-bottom:12px">' +
      '<div class="skeleton skeleton-title"></div>' +
      '<div class="skeleton skeleton-line" style="width:88%"></div>' +
      '<div class="skeleton skeleton-line" style="width:70%"></div>' +
      '<div class="skeleton skeleton-line" style="width:40%;margin-bottom:0"></div></div>';
    return '<div aria-busy="true" aria-live="polite"><span class="visually-hidden">加载中</span>' +
      new Array(n + 1).join(one) + '</div>';
  }

  function emptyState(opts) {
    opts = opts || {};
    return '<div class="empty">' +
      '<div class="empty-icon" aria-hidden="true">' + ICONS[opts.icon || 'inbox'] + '</div>' +
      '<div class="empty-title">' + esc(opts.title || '暂无数据') + '</div>' +
      (opts.desc ? '<p class="empty-desc">' + esc(opts.desc) + '</p>' : '') +
      (opts.action ? opts.action : '') +
      '</div>';
  }

  /* =========================================================================
   * 8. 图表（纯原生 SVG）
   * ====================================================================== */

  /** 趋势折线 + 面积图。series: [{date, value}] */
  function trendChart(series, opts) {
    opts = opts || {};
    var W = 680, H = 240, padL = 46, padR = 18, padT = 18, padB = 34;
    if (!series || !series.length) { return emptyState({ title: '暂无趋势数据' }); }
    var max = Math.max.apply(null, series.map(function (s) { return s.value; }));
    max = Math.max(max, 1);
    max = Math.ceil(max / 50) * 50;
    var n = series.length;
    var stepX = (W - padL - padR) / Math.max(n - 1, 1);
    function X(i) { return padL + i * stepX; }
    function Y(v) { return H - padB - (v / max) * (H - padT - padB); }

    // 网格 + y 轴刻度（5 档）
    var grid = '', ticks = 4;
    for (var t = 0; t <= ticks; t++) {
      var val = Math.round(max - (max / ticks) * t);
      var y = H - padB - ((H - padT - padB) / ticks) * t;
      grid += '<line class="grid-line" x1="' + padL + '" y1="' + y.toFixed(1) + '" x2="' + (W - padR) + '" y2="' + y.toFixed(1) + '"/>';
      grid += '<text class="axis-text" x="' + (padL - 8) + '" y="' + (y + 3.5).toFixed(1) + '" text-anchor="end">' + val + '</text>';
    }
    // x 轴标签（约 6 个）
    var xlabels = '', labelEvery = Math.max(1, Math.floor(n / 6));
    for (var i = 0; i < n; i += labelEvery) {
      xlabels += '<text class="axis-text" x="' + X(i).toFixed(1) + '" y="' + (H - padB + 16) + '" text-anchor="middle">' + esc(series[i].date.slice(5)) + '</text>';
    }
    var lineD = series.map(function (s, i) { return (i ? 'L' : 'M') + X(i).toFixed(1) + ',' + Y(s.value).toFixed(1); }).join(' ');
    var areaD = lineD + ' L' + X(n - 1).toFixed(1) + ',' + (H - padB) + ' L' + X(0).toFixed(1) + ',' + (H - padB) + ' Z';
    var points = series.map(function (s, i) {
      return '<circle class="point" cx="' + X(i).toFixed(1) + '" cy="' + Y(s.value).toFixed(1) + '" r="2.6"><title>' +
        esc(s.date + '：' + s.value) + ' ' + esc(opts.unit || '') + '</title></circle>';
    }).join('');

    return '<svg class="svg-chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(opts.ariaLabel || '趋势折线图') + '">' +
      '<defs><linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">' +
        '<stop offset="0%" stop-color="' + (opts.color || '#2f6bff') + '" stop-opacity="0.22"/>' +
        '<stop offset="100%" stop-color="' + (opts.color || '#2f6bff') + '" stop-opacity="0"/>' +
      '</linearGradient></defs>' +
      grid + xlabels +
      '<path class="series-area" d="' + areaD + '"/>' +
      '<path class="series-line" d="' + lineD + '"' + (opts.color ? ' style="stroke:' + opts.color + '"' : '') + '/>' +
      points +
    '</svg>';
  }

  /** 饼图（分类分布）。data: [{label, value, color}] */
  function pieChart(data, opts) {
    opts = opts || {};
    var total = data.reduce(function (a, d) { return a + d.value; }, 0) || 1;
    var size = 220, r = 90, cx = size / 2, cy = size / 2, inner = 52;
    var angle = -Math.PI / 2;
    function pt(a, rad) { return [cx + Math.cos(a) * rad, cy + Math.sin(a) * rad]; }
    var slices = data.map(function (d) {
      var frac = d.value / total;
      var a2 = angle + frac * Math.PI * 2;
      var p1 = pt(angle, r), p2 = pt(a2, r);
      var i1 = pt(a2, inner), i2 = pt(angle, inner);
      var large = frac > 0.5 ? 1 : 0;
      var d0 = 'M' + p1[0].toFixed(2) + ',' + p1[1].toFixed(2) +
        ' A' + r + ',' + r + ' 0 ' + large + ' 1 ' + p2[0].toFixed(2) + ',' + p2[1].toFixed(2) +
        ' L' + i1[0].toFixed(2) + ',' + i1[1].toFixed(2) +
        ' A' + inner + ',' + inner + ' 0 ' + large + ' 0 ' + i2[0].toFixed(2) + ',' + i2[1].toFixed(2) + ' Z';
      angle = a2;
      return '<path d="' + d0 + '" fill="' + esc(d.color) + '" stroke="#fff" stroke-width="1.5"><title>' +
        esc(d.label + '：' + d.value + '（' + Math.round(frac * 100) + '%）') + '</title></path>';
    }).join('');
    return '<svg class="svg-chart" viewBox="0 0 ' + size + ' ' + size + '" style="max-width:220px" role="img" aria-label="' + esc(opts.ariaLabel || '分类分布饼图') + '">' +
      slices +
      '<text x="' + cx + '" y="' + (cy - 4) + '" text-anchor="middle" style="font-size:20px;font-weight:700;fill:#1f2329">' + num(total) + '</text>' +
      '<text x="' + cx + '" y="' + (cy + 14) + '" text-anchor="middle" style="font-size:11px;fill:#8a9199">条（去重后）</text>' +
    '</svg>';
  }

  /** 水平条形图。data: [{label, value, color}] */
  function barChart(data, opts) {
    opts = opts || {};
    var max = Math.max.apply(null, data.map(function (d) { return d.value; })) || 1;
    return '<div class="bar-chart" role="img" aria-label="' + esc(opts.ariaLabel || '条形图') + '">' +
      data.map(function (d) {
        var pct = Math.round((d.value / max) * 100);
        return '<div class="bar-row">' +
          '<span class="muted">' + esc(d.label) + '</span>' +
          '<span class="bar-track"><span class="bar-fill" style="width:' + pct + '%;background:' + esc(d.color || '#2f6bff') + '"></span></span>' +
          '<span class="bar-val">' + num(d.value) + '</span>' +
        '</div>';
      }).join('') + '</div>';
  }

  /* =========================================================================
   * 9. Toast
   * ====================================================================== */
  function toast(msg) {
    var wrap = document.querySelector('.toast-wrap');
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.className = 'toast-wrap';
      document.body.appendChild(wrap);
    }
    var el = document.createElement('div');
    el.className = 'toast';
    el.setAttribute('role', 'status');
    el.textContent = msg;
    wrap.appendChild(el);
    window.setTimeout(function () {
      el.style.opacity = '0';
      el.style.transition = 'opacity .2s ease';
      window.setTimeout(function () { if (el.parentNode) { el.parentNode.removeChild(el); } }, 220);
    }, 2600);
  }

  /* =========================================================================
   * 10. 顶栏渲染 + 事件委托（跨源展开 / Feed 地址）
   * ====================================================================== */
  function renderChrome(activeKey) {
    var h = document.getElementById('site-header');
    if (h) { h.innerHTML = siteHeader(activeKey); }
    var f = document.getElementById('site-footer');
    if (f) { f.innerHTML = siteFooter(); }
  }

  function bindGlobalClicks() {
    document.addEventListener('click', function (e) {
      var toggle = e.target.closest('[data-toggle-sources]');
      if (toggle) {
        var id = toggle.getAttribute('data-toggle-sources');
        var panel = document.querySelector('[data-source-panel="' + id + '"]');
        if (panel) {
          var open = panel.classList.toggle('hidden') === false;
          toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
        }
        return;
      }
      var feed = e.target.closest('[data-feed]');
      if (feed) {
        toast('Feed 源地址：' + feed.getAttribute('data-feed'));
      }
    });
  }

  return {
    // utils
    esc: esc, formatAbsolute: formatAbsolute, formatDate: formatDate,
    formatRelative: formatRelative, timeEl: timeEl, num: num, cssVar: cssVar,
    catMeta: catMeta, channel: channel, pad2: pad2, cnParts: cnParts,
    // components
    catTag: catTag, channelBadge: channelBadge, newBadge: newBadge,
    sourceBadge: sourceBadge, healthStatus: healthStatus, statusEl: statusEl,
    siteHeader: siteHeader, siteFooter: siteFooter,
    itemRow: itemRow, channelCard: channelCard,
    skeletonList: skeletonList, emptyState: emptyState,
    // charts
    trendChart: trendChart, pieChart: pieChart, barChart: barChart,
    // misc
    ICONS: ICONS, NAV: NAV, toast: toast,
    renderChrome: renderChrome, bindGlobalClicks: bindGlobalClicks
  };
})();
