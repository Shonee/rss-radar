/* =============================================================================
 * 页面2 — 渠道分栏看板 交互逻辑
 * 对应 PRD §6.2：响应式栅格（桌面 3~4 列 / 平板 2 列 / 移动 1 列）、
 *                配置抽屉（展示渠道 / 每卡片条数默认 10 / 卡片排序）、
 *                配置写 localStorage 并跨会话生效、渠道健康状态角标、卡片空态·失败态。
 * ========================================================================== */
(function () {
  'use strict';

  var MOCK = window.RR_MOCK;

  var cfg = null;               // 站点配置（含用户覆盖）
  var ui = {
    catFilter: {},              // 分类筛选（页面级，不持久化）
    sort: 'updatedAt'           // updatedAt | name
  };

  function el(id) { return document.getElementById(id); }

  var MQ_MOBILE = window.matchMedia('(max-width: 767px)');
  function isMobile() { return MQ_MOBILE.matches; }

  /**
   * 每卡片条数：移动端（<768px）默认 5 条、桌面默认取配置值（PRD §6.2）；
   * 用户一旦在配置抽屉显式设置过，则显式值优先，不随断点覆盖。
   */
  function effectiveCardLimit() {
    if (cfg.cardLimitUserSet) { return cfg.cardLimit; }
    return isMobile() ? 5 : cfg.cardLimit;
  }

  function init() {
    RR.renderChrome('page2');
    RR.bindGlobalClicks();
    cfg = window.RR_STORE.get();
    ui.sort = cfg.cardSort || 'updatedAt';

    renderHeader();
    renderCategoryFilter();
    el('board-controls').addEventListener('click', onControlsClick);
    renderBoard();
    bindConfigDrawer();

    // 断点切换时按 PRD 重新评估每卡片条数（不覆盖用户显式设置）
    if (MQ_MOBILE.addEventListener) { MQ_MOBILE.addEventListener('change', renderBoard); }
    else { window.addEventListener('resize', renderBoard); }
  }

  /* -------------------------------------------------------------------------
   * 顶部：标题 + 渠道总数 + 配置按钮
   * ---------------------------------------------------------------------- */
  function renderHeader() {
    var enabled = MOCK.channels.filter(function (c) { return c.enabled !== false; });
    el('board-head').innerHTML =
      '<div>' +
        '<h1 style="margin-bottom:4px">渠道看板</h1>' +
        '<p class="hero-desc">每个渠道一张卡片，专注看单渠道动态。共 <strong>' +
          MOCK.channels.length + '</strong> 个渠道（启用 <strong>' + enabled.length + '</strong> 个），当前展示 <strong id="shown-count">0</strong> 个。</p>' +
      '</div>' +
      '<button type="button" id="open-config" class="btn btn-primary">' + RR.ICONS.settings + '配置</button>';
    el('open-config').addEventListener('click', openDrawer);
  }

  /* -------------------------------------------------------------------------
   * 控制区：分类筛选 + 排序
   * ---------------------------------------------------------------------- */
  function renderCategoryFilter() {
    var cats = MOCK.categories.filter(function (cat) {
      return MOCK.channels.some(function (c) { return (c.category || []).indexOf(cat.key) >= 0; });
    });
    el('board-controls').innerHTML =
      '<div class="chip-row" role="group" aria-label="按分类筛选渠道">' +
        '<button type="button" class="chip" data-cat="" aria-pressed="' + (Object.keys(ui.catFilter).length === 0) + '">全部分类</button>' +
        cats.map(function (cat) {
          return '<button type="button" class="chip" data-cat="' + RR.esc(cat.key) + '" aria-pressed="' + !!ui.catFilter[cat.key] + '">' +
            '<span class="dot" style="color:' + RR.esc(cat.color) + '"></span>' + RR.esc(cat.label) + '</button>';
        }).join('') +
      '</div>' +
      '<div class="toolbar-spacer"></div>' +
      '<div class="segmented" role="group" aria-label="卡片排序">' +
        '<button type="button" id="csort-updated" aria-pressed="' + (ui.sort === 'updatedAt') + '">按最近更新</button>' +
        '<button type="button" id="csort-name" aria-pressed="' + (ui.sort === 'name') + '">按渠道名</button>' +
      '</div>';
  }

  function onControlsClick(e) {
    var chip = e.target.closest('.chip');
    if (chip) {
      var key = chip.getAttribute('data-cat');
      ui.catFilter = key ? {} : {};
      if (key) { ui.catFilter[key] = true; }
      renderCategoryFilter();
      renderBoard();
      return;
    }
    var b = e.target.closest('button');
    if (!b) { return; }
    if (b.id === 'csort-updated') { setSort('updatedAt'); }
    if (b.id === 'csort-name') { setSort('name'); }
  }

  function setSort(s) {
    ui.sort = s;
    window.RR_STORE.set({ cardSort: s });
    cfg.cardSort = s;
    el('csort-updated').setAttribute('aria-pressed', s === 'updatedAt');
    el('csort-name').setAttribute('aria-pressed', s === 'name');
    renderBoard();
  }

  /* -------------------------------------------------------------------------
   * 看板
   * ---------------------------------------------------------------------- */
  function visibleChannels() {
    var selected = cfg.channels; // null=全部启用
    var catKeys = Object.keys(ui.catFilter);
    return MOCK.channels.filter(function (c) {
      if (c.enabled === false && !(selected && selected.indexOf(c.id) >= 0)) { return false; }
      if (selected && selected.indexOf(c.id) < 0) { return false; }
      if (catKeys.length && !(c.category || []).some(function (k) { return catKeys.indexOf(k) >= 0; })) { return false; }
      return true;
    });
  }

  function itemsOfChannel(cid) {
    return MOCK.items
      .filter(function (it) { return !it.duplicateOf && it.channelId === cid; })
      .sort(function (a, b) { return a.updatedAt < b.updatedAt ? 1 : -1; });
  }

  function renderBoard() {
    var board = el('board');
    var chs = visibleChannels();

    // 排序
    chs = chs.slice().sort(function (a, b) {
      if (ui.sort === 'name') { return a.name < b.name ? -1 : (a.name > b.name ? 1 : 0); }
      var aMax = (itemsOfChannel(a.id)[0] || {}).updatedAt || '';
      var bMax = (itemsOfChannel(b.id)[0] || {}).updatedAt || '';
      if (aMax !== bMax) { return aMax < bMax ? 1 : -1; }
      return a.name < b.name ? -1 : 1;
    });

    var shownEl = el('shown-count');
    if (shownEl) { shownEl.textContent = chs.length; }

    if (!chs.length) {
      board.innerHTML = RR.emptyState({
        title: '没有可展示的渠道',
        desc: '当前分类筛选或配置下没有渠道。点击右上角「配置」选择要展示的渠道，或切换分类。',
        action: '<button type="button" class="btn btn-primary" onclick="document.getElementById(\'open-config\').click()">打开配置</button>'
      });
      return;
    }

    board.innerHTML = chs.map(function (c) {
      return RR.channelCard(c, itemsOfChannel(c.id), effectiveCardLimit());
    }).join('');
  }

  /* -------------------------------------------------------------------------
   * 配置抽屉
   * ---------------------------------------------------------------------- */
  function bindConfigDrawer() {
    el('drawer-scrim').addEventListener('click', closeDrawer);
    el('drawer-close').addEventListener('click', closeDrawer);
    el('drawer-body').addEventListener('change', onDrawerChange);
    el('drawer-body').addEventListener('click', onDrawerClick);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { closeDrawer(); }
    });
  }

  function openDrawer() {
    cfg = window.RR_STORE.get();
    var body = el('drawer-body');

    // 展示哪些渠道（按分类分组多选）
    var groupHtml = MOCK.categories.map(function (cat) {
      var chs = MOCK.channels.filter(function (c) { return (c.category || []).indexOf(cat.key) >= 0; });
      if (!chs.length) { return ''; }
      return '<div class="filter-group" style="margin-bottom:var(--space-4)">' +
        '<h3>' + RR.esc(cat.label) + '</h3>' +
        chs.map(function (c) {
          var checked = (cfg.channels === null) ? (c.enabled !== false) : (cfg.channels.indexOf(c.id) >= 0);
          return '<label class="check"><input type="checkbox" data-cfg-ch="' + RR.esc(c.id) + '"' + (checked ? ' checked' : '') + '>' +
            '<span>' + RR.esc(c.icon + ' ' + c.name) +
            (c.enabled === false ? ' <span class="muted">（已停用）</span>' : '') + '</span></label>';
        }).join('') +
      '</div>';
    }).join('');

    body.innerHTML =
      '<p class="muted" style="font-size:var(--fs-sm)">配置将保存到浏览器 localStorage，重新打开页面后仍然生效（对应 PRD B6）。</p>' +
      '<div class="filter-group"><h3>每卡片条数</h3>' +
        '<div class="segmented" role="group" aria-label="每卡片条数">' +
          [5, 10, 20].map(function (n) {
            return '<button type="button" data-cfg-limit="' + n + '" aria-pressed="' + (cfg.cardLimit === n) + '">' + n + ' 条</button>';
          }).join('') +
        '</div>' +
        '<p class="muted" style="font-size:var(--fs-xs);margin-top:6px">默认 10 条（PRD §6.2）；移动端（&lt;768px）默认降为 5 条，用户显式设置后以设置为准。</p>' +
      '</div>' +
      '<div class="filter-group"><h3>卡片排序方式</h3>' +
        '<div class="segmented" role="group" aria-label="卡片排序方式">' +
          '<button type="button" data-cfg-sort="updatedAt" aria-pressed="' + (cfg.cardSort === 'updatedAt') + '">按最近更新</button>' +
          '<button type="button" data-cfg-sort="name" aria-pressed="' + (cfg.cardSort === 'name') + '">按渠道名</button>' +
        '</div>' +
      '</div>' +
      '<hr>' +
      '<div class="filter-group"><h3>展示哪些渠道</h3>' + groupHtml + '</div>';

    el('drawer-scrim').classList.add('is-open');
    el('drawer').classList.add('is-open');
    el('drawer').setAttribute('aria-hidden', 'false');
    el('open-config').setAttribute('aria-expanded', 'true');
    var closeBtn = el('drawer-close');
    if (closeBtn) { closeBtn.focus(); }
  }

  function onDrawerChange(e) {
    var t = e.target;
    if (t.dataset && t.dataset.cfgCh) {
      var picked = Array.prototype.slice.call(
        el('drawer-body').querySelectorAll('[data-cfg-ch]:checked')
      ).map(function (i) { return i.getAttribute('data-cfg-ch'); });
      cfg.channels = picked;
      window.RR_STORE.set({ channels: picked });
    }
  }

  function onDrawerClick(e) {
    var t = e.target.closest('button');
    if (!t) { return; }
    if (t.dataset.cfgLimit) {
      var n = parseInt(t.dataset.cfgLimit, 10);
      cfg.cardLimit = n;
      cfg.cardLimitUserSet = true;   // 显式设置：此后移动端不再自动降级（P2-3）
      window.RR_STORE.set({ cardLimit: n, cardLimitUserSet: true });
      el('drawer-body').querySelectorAll('[data-cfg-limit]').forEach(function (b) {
        b.setAttribute('aria-pressed', parseInt(b.dataset.cfgLimit, 10) === n);
      });
    }
    if (t.dataset.cfgSort) {
      var s = t.dataset.cfgSort;
      cfg.cardSort = s;
      ui.sort = s;
      window.RR_STORE.set({ cardSort: s });
      el('drawer-body').querySelectorAll('[data-cfg-sort]').forEach(function (b) {
        b.setAttribute('aria-pressed', b.dataset.cfgSort === s);
      });
      var up = el('csort-updated'), nm = el('csort-name');
      if (up) { up.setAttribute('aria-pressed', s === 'updatedAt'); }
      if (nm) { nm.setAttribute('aria-pressed', s === 'name'); }
    }
  }

  function closeDrawer() {
    el('drawer-scrim').classList.remove('is-open');
    el('drawer').classList.remove('is-open');
    el('drawer').setAttribute('aria-hidden', 'true');
    var oc = el('open-config');
    if (oc) { oc.setAttribute('aria-expanded', 'false'); }
  }

  // 「应用」按钮：关闭抽屉并重绘（配置已即时写入 storage）
  document.addEventListener('DOMContentLoaded', function () {
    var apply = document.getElementById('drawer-apply');
    if (apply) {
      apply.addEventListener('click', function () {
        renderBoard();
        closeDrawer();
        RR.toast('配置已保存到本地，重新打开页面仍生效');
      });
    }
    var reset = document.getElementById('drawer-reset');
    if (reset) {
      reset.addEventListener('click', function () {
        window.RR_STORE.reset();
        cfg = window.RR_STORE.get();
        ui.sort = cfg.cardSort;
        renderBoard();
        renderCategoryFilter();
        openDrawer(); // 重新渲染抽屉内容
        RR.toast('已恢复默认配置（每卡片 10 条）');
      });
    }
  });

  document.addEventListener('DOMContentLoaded', init);
})();
