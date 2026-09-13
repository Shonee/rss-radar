/* =============================================================================
 * 页面4 — 历史趋势与回看 交互逻辑
 * 对应 PRD §6.4 与 ARCHITECTURE §13：趋势（读 history-index.json，1 次请求）/
 *                月度明细下钻（懒加载）/ 日历回看某天（有数据·无数据·已归档三态）/
 *                归档区（只读元数据 + 跳 Release 下载）/ 移动端降级。
 * ========================================================================== */
(function () {
  'use strict';

  var MOCK = window.RR_MOCK;
  var days = MOCK.historyIndex.days;                 // 90 天
  var state = {
    window: window.RR_STORE.get().historyWindow || 90,
    series: 'totalItems',                            // totalItems | activeChannels | aiRatio
    calYear: 2026,
    calMonth: 9,                                     // 1-12
    selectedDate: MOCK.TODAY
  };

  function el(id) { return document.getElementById(id); }

  function init() {
    RR.renderChrome('page4');
    RR.bindGlobalClicks();
    applyUrlParams();
    renderTrend();
    renderMonths();
    renderCalendar();
    renderLookback(state.selectedDate);
    renderArchive();
  }

  function applyUrlParams() {
    var p = new URLSearchParams(window.location.search);
    if (p.get('date')) { state.selectedDate = p.get('date'); }
  }

  /* -------------------------------------------------------------------------
   * 趋势区
   * ---------------------------------------------------------------------- */
  function seriesOf(key, slice) {
    if (key === 'activeChannels') {
      return slice.map(function (d) { return { date: d.date, value: d.activeChannels }; });
    }
    if (key === 'aiRatio') {
      return slice.map(function (d) {
        var total = d.totalItems || 1;
        var ai = (d.categoryStats && d.categoryStats.ai) || 0;
        return { date: d.date, value: Math.round((ai / total) * 1000) / 10 };
      });
    }
    return slice.map(function (d) { return { date: d.date, value: d.totalItems }; });
  }

  function renderTrend() {
    var slice = days.slice(Math.max(0, days.length - state.window));
    var meta = {
      totalItems: { unit: '条', label: '总条数', color: RR.cssVar('--color-chart-1') || '#2f6bff' },
      activeChannels: { unit: '个渠道', label: '活跃渠道数', color: RR.cssVar('--color-chart-2') || '#f57c00' },
      aiRatio: { unit: '%', label: 'AI 类占比（%）', color: RR.cssVar('--color-chart-3') || '#00897b' }
    }[state.series];

    el('trend-head').innerHTML =
      '<div class="section-head" style="margin-bottom:var(--space-3)">' +
        '<h2>趋势：' + RR.esc(meta.label) + '</h2>' +
        '<div class="segmented" role="group" aria-label="趋势窗口">' +
          [90, 180, 365].map(function (w) {
            return '<button type="button" data-window="' + w + '" aria-pressed="' + (state.window === w) + '">近 ' + w + ' 天</button>';
          }).join('') +
        '</div>' +
      '</div>' +
      '<div class="segmented" role="group" aria-label="趋势指标" style="margin-bottom:var(--space-4)">' +
        '<button type="button" data-series="totalItems" aria-pressed="' + (state.series === 'totalItems') + '">总条数</button>' +
        '<button type="button" data-series="activeChannels" aria-pressed="' + (state.series === 'activeChannels') + '">活跃渠道数</button>' +
        '<button type="button" data-series="aiRatio" aria-pressed="' + (state.series === 'aiRatio') + '">分类占比走势</button>' +
      '</div>';

    var chartCard = el('trend-chart');
    chartCard.innerHTML = RR.trendChart(seriesOf(state.series, slice), {
      unit: meta.unit, color: meta.color,
      ariaLabel: '近 ' + state.window + ' 天' + meta.label + '趋势图'
    }) +
    '<div class="chart-note"><strong>数据契约说明：</strong>本趋势图 = <code>history-index.json</code> 的 <strong>1 次请求</strong> 即可绘制（消费 days[] 的 date / totalItems / activeChannels / categoryStats），无需读取 N 个文件。</div>';

    var wl = el('win-label');
    if (wl) { wl.textContent = state.window; }

    if (!el('trend-head').dataset.bound) {
      el('trend-head').dataset.bound = '1';
      el('trend-head').addEventListener('click', function (e) {
        var b = e.target.closest('button');
        if (!b) { return; }
        if (b.dataset.window) {
          state.window = parseInt(b.dataset.window, 10);
          window.RR_STORE.set({ historyWindow: state.window });
        }
        if (b.dataset.series) { state.series = b.dataset.series; }
        renderTrend();
      });
    }
  }

  /* -------------------------------------------------------------------------
   * 月度明细下钻（懒加载）
   * ---------------------------------------------------------------------- */
  function renderMonths() {
    var monthKeys = Object.keys(MOCK.historyMonths).sort().reverse();
    var container = el('months');
    container.innerHTML = '<div class="month-list">' + monthKeys.map(function (mk) {
      var rows = MOCK.historyMonths[mk];
      var year = mk.slice(0, 4), m = mk.slice(5);
      return '<details class="month-row" data-month="' + RR.esc(mk) + '">' +
        '<summary>' +
          '<span>' + year + ' 年 ' + parseInt(m, 10) + ' 月明细</span>' +
          '<span class="muted" style="font-size:var(--fs-xs)">' + rows.length + ' 条（示例）· 点击展开 ' + RR.ICONS.chevron + '</span>' +
        '</summary>' +
        '<div class="month-body" data-loaded="0"></div>' +
      '</details>';
    }).join('') + '</div>';

    // ⚠️ <details> 的 toggle 事件【不冒泡】，必须逐个绑到 <details> 元素本身（P2-1）
    container.querySelectorAll('details.month-row').forEach(function (d) {
      d.addEventListener('toggle', onMonthToggle);
    });
  }

  /** 月份展开 → 模拟懒加载 history/YYYY/MM/items.ndjson（1 请求/月）。 */
  function onMonthToggle(e) {
    var d = e.currentTarget;
    if (!d.open) { return; }
    var body = d.querySelector('.month-body');
    if (!body || body.dataset.loaded === '1') { return; }

    body.innerHTML = RR.skeletonList(3);
    var mk = d.getAttribute('data-month');
    window.setTimeout(function () {
      var rows = MOCK.historyMonths[mk] || [];
      body.innerHTML = '<p class="muted" style="font-size:var(--fs-xs);padding:var(--space-2) 0">' +
        '已加载 <code>history/' + mk.replace('-', '/') + '/items.ndjson</code>（月度明细 · 精简行）</p>' +
        rows.map(function (r) {
          return '<div class="mini-item">' +
            '<span class="mi-title"><a href="#" onclick="return false" title="原型演示">' + RR.esc(r.title) + '</a></span>' +
            RR.catTag((r.category || [])[0]) +
            '<span class="muted" style="font-size:var(--fs-xs)">' + RR.esc(r.channelName) + '</span>' +
            RR.timeEl(r.publishedAt) +
            (r.sourceCount > 1 ? '<span class="badge-source" style="pointer-events:none">＋' + (r.sourceCount - 1) + ' 源</span>' : '') +
          '</div>';
        }).join('');
      body.dataset.loaded = '1';
    }, 420);
  }

  /* -------------------------------------------------------------------------
   * 日历回看
   * ---------------------------------------------------------------------- */
  function dateKey(y, m, d) { return y + '-' + RR.pad2(m) + '-' + RR.pad2(d); }
  function daysInMonth(y, m) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); }
  function indexMap() {
    var map = {};
    days.forEach(function (d) { map[d.date] = d; });
    return map;
  }
  var IDX = indexMap();

  function renderCalendar() {
    var y = state.calYear, m = state.calMonth;
    var first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay(); // 0=Sun
    var total = daysInMonth(y, m);
    var cells = '';
    for (var i = 0; i < first; i++) { cells += '<span></span>'; }
    for (var d = 1; d <= total; d++) {
      var key = dateKey(y, m, d);
      var has = !!IDX[key];
      var cls = ['cal-day'];
      if (has) { cls.push('has-data'); }
      else { cls.push('empty'); }
      if (key === MOCK.TODAY) { cls.push('today'); }
      if (key === state.selectedDate) { cls.push('selected'); }
      var future = key > MOCK.TODAY;
      cells += '<button type="button" class="' + cls.join(' ') + '" data-date="' + key + '"' +
        (future ? ' disabled' : '') +
        ' aria-pressed="' + (key === state.selectedDate) + '"' +
        ' title="' + (has ? '有数据' : (future ? '未来日期' : '无数据 / 已归档')) + '">' + d + '</button>';
    }

    el('calendar').innerHTML =
      '<div class="cal-head">' +
        '<button type="button" class="btn btn-sm btn-icon" id="cal-prev" aria-label="上个月">‹</button>' +
        '<strong>' + y + ' 年 ' + m + ' 月</strong>' +
        '<button type="button" class="btn btn-sm btn-icon" id="cal-next" aria-label="下个月">›</button>' +
      '</div>' +
      '<div class="cal-grid">' +
        ['日', '一', '二', '三', '四', '五', '六'].map(function (d) { return '<span class="cal-dow">' + d + '</span>'; }).join('') +
        cells +
      '</div>' +
      '<p class="muted" style="font-size:var(--fs-xs);margin-top:var(--space-3)">' +
        '<span class="legend-item"><span class="legend-swatch" style="background:var(--color-primary-weak);border:1px solid var(--color-primary-weak-2)"></span>有数据</span> ' +
        '深色为选中；灰色为无数据/已归档。共 ' + days.length + ' 天在站内可交互范围内。</p>';

    el('cal-prev').addEventListener('click', function () { shiftMonth(-1); });
    el('cal-next').addEventListener('click', function () { shiftMonth(1); });

    if (!el('calendar').dataset.delegated) {
      el('calendar').dataset.delegated = '1';
      el('calendar').addEventListener('click', function (e) {
        var b = e.target.closest('.cal-day');
        if (!b || b.disabled) { return; }
        state.selectedDate = b.getAttribute('data-date');
        renderCalendar();
        renderLookback(state.selectedDate);
      });
    }
  }

  function shiftMonth(delta) {
    var m = state.calMonth + delta, y = state.calYear;
    if (m < 1) { m = 12; y -= 1; }
    if (m > 12) { m = 1; y += 1; }
    state.calMonth = m; state.calYear = y;
    renderCalendar();
  }

  /* -------------------------------------------------------------------------
   * 回看结果（三态：有数据 / 无数据 / 已归档）
   * ---------------------------------------------------------------------- */
  function renderLookback(date) {
    var box = el('lookback');
    var snap = MOCK.daySnapshots[date];
    var idxDay = IDX[date];

    var headHtml = '<div class="lb-head"><strong>回看：' + RR.esc(date) + '</strong>' +
      '<a class="btn btn-sm" href="index.html#contract" title="原型说明">数据来源</a></div>';

    // 状态 1：已归档（>1 年）
    if (snap && snap.status === 'archived') {
      box.innerHTML = headHtml +
        '<div class="alert alert-info" role="status">' + RR.ICONS.info +
          '<div><span class="alert-title">该日期已归档（超过一年）</span>：' + RR.esc(date) +
          ' 的数据不在站内可交互范围内。站内仅展示只读元数据，请前往 GitHub Release 下载归档包。</div></div>' +
        '<div class="card card-pad" style="margin-top:var(--space-3)"><div class="lookback-stat">' +
          '<span>归档年份：<strong>' + RR.esc(snap.year) + '</strong></span>' +
          '<span>Release：<strong>' + RR.esc(snap.releaseTag) + '</strong></span>' +
        '</div>' +
        '<button type="button" class="btn btn-primary" data-release="' + RR.esc(snap.releaseTag) + '">' + RR.ICONS.download + '前往 GitHub Release 下载</button></div>';
      bindRelease();
      return;
    }

    // 状态 2：无数据
    if (!snap && !idxDay) {
      box.innerHTML = headHtml +
        '<div class="empty" style="padding:var(--space-8)">' +
          '<div class="empty-icon" aria-hidden="true">' + RR.ICONS.inbox + '</div>' +
          '<div class="empty-title">该日期无数据</div>' +
          '<p class="empty-desc">该日可能未采集，或已超出站内可交互范围（一年内）。可与「已归档」区分：已归档需前往 Release 下载。</p>' +
        '</div>';
      return;
    }
    if (snap && snap.status === 'empty') {
      box.innerHTML = headHtml +
        '<div class="empty" style="padding:var(--space-8)">' +
          '<div class="empty-icon" aria-hidden="true">' + RR.ICONS.inbox + '</div>' +
          '<div class="empty-title">该日期无数据</div>' +
          '<p class="empty-desc">当天采集结果为空（源全部失败或未运行），无快照可回看。</p>' +
        '</div>';
      return;
    }

    // 状态 3：有数据
    var totalItems = snap ? snap.totalItems : (idxDay ? idxDay.totalItems : 0);
    var activeChannels = snap ? snap.activeChannels : (idxDay ? idxDay.activeChannels : 0);
    var tops = (snap && snap.topItems) || [];
    var cats = idxDay ? idxDay.categoryStats : null;

    box.innerHTML = headHtml +
      '<div class="card card-pad">' +
        '<div class="lookback-stat">' +
          '<span>条目数（去重后）：<strong>' + RR.num(totalItems) + '</strong></span>' +
          '<span>活跃渠道：<strong>' + activeChannels + '</strong></span>' +
          '<span>数据来源：<code>' + (snap ? 'snapshot-' + date + '.json' : 'history-index.json') + '</code></span>' +
        '</div>' +
        (cats ? '<div class="chip-row" style="margin-bottom:var(--space-3)">' +
          Object.keys(cats).map(function (k) {
            return RR.catTag(k) + '<span class="muted" style="font-size:var(--fs-xs);margin-right:10px">' + cats[k] + '</span>';
          }).join('') + '</div>' : '') +
        (tops.length
          ? '<table class="table"><thead><tr><th>#</th><th>热点 TopN</th><th>渠道</th><th class="num">热度</th></tr></thead><tbody>' +
            tops.map(function (t) {
              return '<tr><td>' + t.rank + '</td><td><a href="' + RR.esc(t.url) + '" target="_blank" rel="noopener">' +
                RR.esc(t.title) + '</a></td><td>' + RR.esc(t.channelName) + '</td><td class="num">' + t.hotScore.toFixed(2) + '</td></tr>';
            }).join('') + '</tbody></table>'
          : '<p class="muted" style="font-size:var(--fs-sm)">该日未提供逐条快照（原型仅对部分日期提供 TopN），趋势数据仍可查。</p>') +
        (snap && date === MOCK.TODAY ? '<p class="muted" style="font-size:var(--fs-xs);margin-top:var(--space-3)">今天是当天快照（today/snapshot.json），非历史文件。</p>' : '') +
      '</div>';
  }

  function bindRelease() {
    el('lookback').querySelectorAll('[data-release]').forEach(function (b) {
      b.addEventListener('click', function () {
        RR.toast('原型阶段不真实跳转；真实实现将打开 GitHub Release 下载 tar.zst 归档包');
      });
    });
  }

  /* -------------------------------------------------------------------------
   * 归档区
   * ---------------------------------------------------------------------- */
  function renderArchive() {
    el('archive').innerHTML = MOCK.archives.map(function (a) {
      return '<div class="card card-pad archive-year">' +
        '<div style="display:flex;flex-wrap:wrap;gap:var(--space-3);align-items:center;justify-content:space-between">' +
          '<div><strong>' + a.year + ' 年归档</strong> ' +
            '<span class="muted" style="font-size:var(--fs-sm)">· 共 ' + a.months.length + ' 个月 · Release ' + RR.esc(a.releaseTag) + '</span></div>' +
          '<button type="button" class="btn" data-artifact="' + RR.esc(a.releaseTag) + '">' + RR.ICONS.download + '前往 GitHub Release 下载</button>' +
        '</div>' +
        '<div class="archive-months">' +
          a.months.map(function (m) {
            return '<div class="archive-month"><div class="am-num">' + RR.esc(m.month) + '</div>' +
              '<div class="muted">' + RR.num(m.itemCount) + ' 条 · ' + (m.bytes / 1048576).toFixed(1) + ' MB</div></div>';
          }).join('') +
        '</div>' +
      '</div>';
    }).join('') +
    '<p class="muted" style="font-size:var(--fs-xs)">站内仅只读展示归档元数据；因 Release 资产无稳定 raw/CORS 直读端点且体积较大，站内不解析，统一跳转下载（PRD Q15 / ARCHITECTURE §13.3）。</p>';

    el('archive').addEventListener('click', function (e) {
      var b = e.target.closest('[data-artifact]');
      if (b) { RR.toast('原型阶段不真实跳转；真实实现将打开 GitHub Release（' + b.getAttribute('data-artifact') + '）'); }
    });
  }

  document.addEventListener('DOMContentLoaded', init);
})();
