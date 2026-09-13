/* =============================================================================
 * 页面1 — 聚合热榜流 交互逻辑
 * 对应 PRD §6.1：排序切换 / 渠道·分类·时间筛选 / 搜索 / 每批 20 条懒加载 /
 *                NEW 徽标 / 「+N 源」跨源徽标 / 空态·异常态·加载态
 * ========================================================================== */
(function () {
  'use strict';

  var MOCK = window.RR_MOCK;

  var state = {
    sort: 'updatedAt',        // updatedAt | publishedAt
    channels: {},             // channelId -> true
    categories: {},           // categoryKey -> true
    timeRange: 'today',       // today | 2h
    q: '',
    limit: 20,                // 已展示条数
    batch: 20,                // 每批条数（默认 20）
    loading: false,
    simulateLoad: true         // 首屏模拟一次加载态（骨架屏）
  };

  var bound = { side: false };
  var MQ_MOBILE = window.matchMedia('(max-width: 767px)');

  function el(id) { return document.getElementById(id); }
  function isMobile() { return MQ_MOBILE.matches; }

  /**
   * 每批条数：移动端（<768px）默认 10 条、桌面默认 20 条（PRD §6.1）；
   * 用户一旦在工具条显式选择过，则显式值优先，不随断点覆盖。
   */
  function effectiveBatch() {
    var cfg = window.RR_STORE.get();
    if (cfg.page1BatchSizeUserSet) { return cfg.page1BatchSize; }
    return isMobile() ? 10 : (cfg.page1BatchSize || 20);
  }

  /* -------------------------------------------------------------------------
   * 初始化
   * ---------------------------------------------------------------------- */
  function init() {
    RR.renderChrome('page1');
    RR.bindGlobalClicks();

    state.sort = window.RR_STORE.get().page1Sort || 'updatedAt';
    state.batch = effectiveBatch();
    state.limit = state.batch;

    applyUrlParams();
    renderStatbar();
    renderAlerts();
    renderToolbar();
    renderFilters();
    renderList(true);

    // 断点切换时按 PRD 重新评估每批条数（不覆盖用户显式设置）
    if (MQ_MOBILE.addEventListener) { MQ_MOBILE.addEventListener('change', onViewportChange); }
    else { window.addEventListener('resize', onViewportChange); }
  }

  function onViewportChange() {
    var nb = effectiveBatch();
    if (nb !== state.batch) {
      state.batch = nb;
      state.limit = nb;
      var sel = el('batch-select');
      if (sel) { sel.value = String(nb); }
      renderList(false);
    }
  }

  /** 支持从页面2「查看全部」跳转带上 ?channel=<id>。 */
  function applyUrlParams() {
    var params = new URLSearchParams(window.location.search);
    var ch = params.get('channel');
    if (ch) { state.channels[ch] = true; }
  }

  /* -------------------------------------------------------------------------
   * 顶部数据状态条 + 异常提示
   * ---------------------------------------------------------------------- */
  function renderStatbar() {
    var items = allItems();
    var lastUpdated = items.reduce(function (max, it) {
      return (!max || it.updatedAt > max) ? it.updatedAt : max;
    }, null);
    var enabledChannels = MOCK.channels.filter(function (c) { return c.enabled !== false; }).length;
    // 「今日条数 / 涉及分类数」直接取报告派生口径，保证与页面3 完全一致（P2-2）
    el('statbar').innerHTML =
      '<span class="stat"><span class="dot-live" aria-hidden="true"></span>最近更新：<strong>' +
        RR.esc(RR.formatRelative(lastUpdated)) + '</strong></span>' +
      '<span class="stat">共 <strong>' + enabledChannels + '</strong> 个渠道</span>' +
      '<span class="stat">今日 <strong>' + MOCK.report.totalItems + '</strong> 条</span>' +
      '<span class="stat">涉及 <strong>' + MOCK.report.categoryStats.length + '</strong> 个分类</span>' +
      '<span class="stat muted">时间基准：' + RR.esc(MOCK.TODAY) + '（Mock）</span>';
  }

  function renderAlerts() {
    var failedIds = {};
    var failed = [];
    Object.keys(MOCK.sourceByChannel || {}).forEach(function (cid) {
      var srcs = MOCK.sourceByChannel[cid];
      if (srcs.some(function (s) { return s.lastStatus === 'error'; })) {
        failedIds[cid] = true;
        var ch = MOCK.channelById[cid];
        if (ch) { failed.push(ch); }
      }
    });
    // 「暂无内容」应排除「抓取失败」的渠道——失败渠道只出现在上方失败黄条，避免语义冲突（P3-2）
    var emptyChannels = MOCK.channels.filter(function (c) {
      if (c.enabled === false) { return false; }
      if (failedIds[c.id]) { return false; }
      return !itemsOfChannel(c.id).length;
    });

    var html = '';
    if (failed.length) {
      html += '<div class="alert alert-warning" role="alert">' + RR.ICONS.alert +
        '<div><span class="alert-title">' + failed.length + ' 个渠道本次抓取失败</span>：' +
        failed.map(function (c) { return RR.esc(c.name); }).join('、') +
        '。该渠道本次无入库条目，其余渠道数据正常，页面仍可正常浏览。</div></div>';
    }
    if (emptyChannels.length) {
      html += '<div class="alert alert-info" role="status">' + RR.ICONS.info +
        '<div>' + emptyChannels.length + ' 个渠道今日暂无内容（已标记为「无新内容」）：' +
        emptyChannels.map(function (c) { return RR.esc(c.name); }).join('、') + '。</div></div>';
    }
    el('alerts').innerHTML = html;
  }

  /* -------------------------------------------------------------------------
   * 工具条
   * ---------------------------------------------------------------------- */
  function renderToolbar() {
    el('toolbar').innerHTML =
      '<div class="segmented" role="group" aria-label="排序方式">' +
        '<button type="button" id="sort-updated" aria-pressed="' + (state.sort === 'updatedAt') + '">按更新时间</button>' +
        '<button type="button" id="sort-published" aria-pressed="' + (state.sort === 'publishedAt') + '">按创建时间</button>' +
      '</div>' +
      '<label class="visually-hidden" for="search-input">搜索标题或摘要</label>' +
      '<div class="grow" style="position:relative">' +
        '<input id="search-input" class="input" type="search" placeholder="搜索标题 / 摘要关键词…" value="' + RR.esc(state.q) + '" aria-label="搜索">' +
      '</div>' +
      '<label class="visually-hidden" for="batch-select">每批条数</label>' +
      '<select id="batch-select" class="select" aria-label="每批条数">' +
        [10, 20, 40].map(function (n) {
          return '<option value="' + n + '"' + (n === state.batch ? ' selected' : '') + '>每批 ' + n + ' 条</option>';
        }).join('') +
      '</select>' +
      '<button type="button" id="mobile-filter-toggle" class="btn mobile-filter-toggle" aria-expanded="false">筛选</button>';

    el('search-input').addEventListener('input', function (e) {
      state.q = e.target.value.trim();
      state.limit = state.batch;
      renderList(true);
    });
    el('sort-updated').addEventListener('click', function () { setSort('updatedAt'); });
    el('sort-published').addEventListener('click', function () { setSort('publishedAt'); });
    el('batch-select').addEventListener('change', function (e) {
      state.batch = parseInt(e.target.value, 10) || 20;
      // 显式选择：标记为「用户已设置」，此后断点切换不再覆盖（P2-3）
      window.RR_STORE.set({ page1BatchSize: state.batch, page1BatchSizeUserSet: true });
      state.limit = state.batch;
      renderList(true);
    });
    el('mobile-filter-toggle').addEventListener('click', function (e) {
      var layout = el('layout');
      var open = layout.classList.toggle('side-open');
      e.target.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
  }

  function setSort(key) {
    state.sort = key;
    window.RR_STORE.set({ page1Sort: key });
    el('sort-updated').setAttribute('aria-pressed', key === 'updatedAt');
    el('sort-published').setAttribute('aria-pressed', key === 'publishedAt');
    state.limit = state.batch;
    renderList(true);
  }

  /* -------------------------------------------------------------------------
   * 侧栏筛选
   * ---------------------------------------------------------------------- */
  function renderFilters() {
    var out = '';

    // 时间范围
    out += '<div class="filter-group"><h3>时间范围</h3>' +
      '<div class="segmented" role="group" aria-label="时间范围">' +
        '<button type="button" id="range-today" aria-pressed="' + (state.timeRange === 'today') + '">今天</button>' +
        '<button type="button" id="range-2h" aria-pressed="' + (state.timeRange === '2h') + '">近 2 小时</button>' +
      '</div></div>';

    // 渠道多选（按分类分组）
    out += '<div class="filter-group"><h3>渠道（按分类分组）</h3>';
    MOCK.categories.forEach(function (cat) {
      var chs = MOCK.channels.filter(function (c) {
        return c.enabled !== false && (c.category || []).indexOf(cat.key) >= 0;
      });
      if (!chs.length) { return; }
      out += '<div style="margin-bottom:10px">' +
        '<div class="muted" style="font-size:var(--fs-xs);margin-bottom:4px">' + RR.esc(cat.label) + '</div>';
      chs.forEach(function (c) {
        var cnt = itemsOfChannel(c.id).length;
        out += '<label class="check"><input type="checkbox" data-ch="' + RR.esc(c.id) + '"' +
          (state.channels[c.id] ? ' checked' : '') + '>' +
          '<span>' + RR.esc(c.name) + ' <span class="muted">(' + cnt + ')</span></span></label>';
      });
      out += '</div>';
    });
    out += '</div>';

    // 分类多选
    out += '<div class="filter-group"><h3>分类</h3>';
    MOCK.categories.forEach(function (cat) {
      var cnt = allItems().filter(function (it) { return (it.category || []).indexOf(cat.key) >= 0; }).length;
      if (!cnt) { return; }
      out += '<label class="check"><input type="checkbox" data-cat="' + RR.esc(cat.key) + '"' +
        (state.categories[cat.key] ? ' checked' : '') + '>' +
        '<span>' + RR.esc(cat.label) + ' <span class="muted">(' + cnt + ')</span></span></label>';
    });
    out += '</div>';

    out += '<div class="filter-actions">' +
      '<button type="button" id="clear-filters" class="btn btn-sm btn-block">清除全部筛选</button></div>';

    el('side').innerHTML = '<div class="card card-pad">' + out + '</div>';

    el('range-today').addEventListener('click', function () { setRange('today'); });
    el('range-2h').addEventListener('click', function () { setRange('2h'); });
    el('clear-filters').addEventListener('click', function () {
      state.channels = {}; state.categories = {}; state.timeRange = 'today'; state.q = '';
      el('search-input').value = '';
      renderFilters(); renderList(true);
      RR.toast('已清除全部筛选');
    });
    if (!bound.side) {
      el('side').addEventListener('change', function (e) {
        var t = e.target;
        if (t.dataset.ch) {
          if (t.checked) { state.channels[t.dataset.ch] = true; } else { delete state.channels[t.dataset.ch]; }
        } else if (t.dataset.cat) {
          if (t.checked) { state.categories[t.dataset.cat] = true; } else { delete state.categories[t.dataset.cat]; }
        }
        state.limit = state.batch;
        renderList(true);
      });
      bound.side = true;
    }
  }

  function setRange(r) {
    state.timeRange = r;
    el('range-today').setAttribute('aria-pressed', r === 'today');
    el('range-2h').setAttribute('aria-pressed', r === '2h');
    state.limit = state.batch;
    renderList(true);
  }

  /* -------------------------------------------------------------------------
   * 数据准备
   * ---------------------------------------------------------------------- */
  /** 所有「主条目」（排除 duplicateOf 指向别处的重复项，与真实去重逻辑一致）。 */
  function allItems() {
    return MOCK.items.filter(function (it) { return !it.duplicateOf; });
  }
  /** 今日主条目（与报告口径一致，按 GMT+8 自然日）。 */
  function todayMainItems() {
    return allItems().filter(function (it) { return RR.formatDate(it.updatedAt) === MOCK.TODAY; });
  }
  function itemsOfChannel(cid) {
    return todayMainItems().filter(function (it) { return it.channelId === cid; });
  }
  function countCategories(items) {
    var set = {};
    items.forEach(function (it) { (it.category || []).forEach(function (c) { set[c] = true; }); });
    return Object.keys(set).length;
  }

  function filtered() {
    var now = new Date(MOCK.NOW).getTime();
    var twoHours = 2 * 3600 * 1000;
    var chKeys = Object.keys(state.channels);
    var catKeys = Object.keys(state.categories);
    var q = state.q.toLowerCase();

    var list = allItems().filter(function (it) {
      if (chKeys.length && chKeys.indexOf(it.channelId) < 0) { return false; }
      if (catKeys.length && !(it.category || []).some(function (c) { return catKeys.indexOf(c) >= 0; })) { return false; }
      if (state.timeRange === '2h') {
        var diff = now - new Date(it.updatedAt).getTime();
        if (diff > twoHours) { return false; }
      } else {
        // today：与 TODAY 同一自然日（GMT+8）
        if (RR.formatDate(it.updatedAt) !== MOCK.TODAY) { return false; }
      }
      if (q) {
        var hay = (it.title + ' ' + (it.summary || '') + ' ' + (it.author || '')).toLowerCase();
        if (hay.indexOf(q) < 0) { return false; }
      }
      return true;
    });

    list.sort(function (a, b) {
      var av = a[state.sort] || '', bv = b[state.sort] || '';
      if (av !== bv) { return av < bv ? 1 : -1; }
      // 同值按渠道名稳定排序
      var an = a.channelName || '', bn = b.channelName || '';
      if (an !== bn) { return an < bn ? -1 : 1; }
      return a.id < b.id ? -1 : 1;
    });
    return list;
  }

  /* -------------------------------------------------------------------------
   * 渲染列表（含加载态 / 空态）
   * ---------------------------------------------------------------------- */
  function renderList(showSkeleton) {
    var list = filtered();
    var countEl = el('result-count');
    countEl.innerHTML = '共 <strong>' + list.length + '</strong> 条符合当前条件' +
      (list.length ? '，已显示 <strong>' + Math.min(state.limit, list.length) + '</strong> 条' : '');

    var listEl = el('list');
    var pagerEl = el('pager');

    if (showSkeleton && state.simulateLoad) {
      listEl.innerHTML = RR.skeletonList(4);
      pagerEl.innerHTML = '';
      state.simulateLoad = false;
      window.setTimeout(function () { paintList(list); }, 420);
      return;
    }
    paintList(list);
  }

  function paintList(list) {
    var listEl = el('list');
    var pagerEl = el('pager');
    if (!list.length) {
      listEl.innerHTML = RR.emptyState({
        title: '暂无数据',
        desc: '当前筛选条件下没有条目。请检查源配置、放宽筛选条件，或等待下一次采集（每 30 分钟一次）。',
        action: '<a class="btn btn-primary" href="page2-channels.html">前往渠道看板</a>'
      });
      pagerEl.innerHTML = '';
      return;
    }
    var slice = list.slice(0, state.limit);
    listEl.innerHTML = slice.map(function (it, i) { return RR.itemRow(it, { rank: i + 1 }); }).join('');

    if (state.limit < list.length) {
      var remain = list.length - state.limit;
      pagerEl.innerHTML = '<button type="button" id="load-more" class="btn btn-primary">加载更多（剩余 ' + remain + ' 条）</button>';
      el('load-more').addEventListener('click', function () {
        state.loading = true;
        var btn = el('load-more');
        btn.disabled = true; btn.textContent = '加载中…';
        window.setTimeout(function () {
          state.limit += state.batch;
          state.loading = false;
          renderList(false);
        }, 350);
      });
    } else {
      pagerEl.innerHTML = '<span class="muted" style="font-size:var(--fs-sm)">— 已到底部，共 ' + list.length + ' 条 —</span>';
    }
  }

  function bindEvents() { /* 事件已在渲染时绑定 */ }

  document.addEventListener('DOMContentLoaded', init);
})();
