/* =============================================================================
 * 页面3 — 分析报告（严格只做当天） 交互逻辑
 * 对应 PRD §6.3：概要数字卡 / 热点榜 TOP10（热度分进度条）/ 分类分布（原生 SVG）/
 *                分类分栏 / 渠道活跃排行 / 方法论说明（可折叠）/ 查看历史趋势入口 / 空态。
 * ========================================================================== */
(function () {
  'use strict';

  var MOCK = window.RR_MOCK;
  var report = MOCK.report;
  var simulateEmpty = false;

  function el(id) { return document.getElementById(id); }

  function init() {
    RR.renderChrome('page3');
    RR.bindGlobalClicks();
    render();
  }

  function render() {
    var hero = el('report-hero');
    var metrics = el('report-metrics');
    var body = el('report-body');
    var methodology = el('report-methodology');
    var footer = el('report-footer');

    if (simulateEmpty) {
      hero.innerHTML = '';
      metrics.innerHTML = '';
      body.innerHTML = RR.emptyState({
        title: '今日暂无数据',
        desc: '当天数据文件尚未生成（采集任务可能仍在进行），报告只基于当天数据，跨天会重置。',
        action: '<a class="btn btn-primary" href="page4-history.html">查看历史趋势</a>'
      });
      methodology.innerHTML = '';
      footer.innerHTML = '';
      return;
    }

    /* ---- 头部 ---- */
    hero.innerHTML =
      '<h1>RSS 日报 · ' + RR.esc(report.date) + '</h1>' +
      '<p class="hero-desc">当天信息全景 + 热点分析，<strong>只包含当天数据，每天重置</strong>。</p>' +
      '<div class="report-meta">' +
        '<span>生成时间：<time title="' + RR.esc(RR.formatAbsolute(report.generatedAt)) + '">' + RR.esc(RR.formatAbsolute(report.generatedAt)) + '</time></span>' +
        '<span>数据覆盖：<strong>' + report.activeChannels + '</strong> 个渠道 / <strong>' + RR.num(report.totalItems) + '</strong> 条</span>' +
        '<span>时间窗：' + RR.esc(RR.formatDate(report.windowStart)) + ' ~ ' + RR.esc(RR.formatDate(report.windowEnd)) + '</span>' +
        '<span>时区：' + RR.esc(report.timezone) + '</span>' +
      '</div>' +
      '<div class="report-summary">' + RR.esc(report.summary) + '</div>';

    /* ---- 概要数字卡 ---- */
    var hotCount = report.hotList.length;
    var catCount = report.categoryStats.length;
    metrics.innerHTML = [
      { label: '总条数（去重后）', value: RR.num(report.totalItems), hint: '今日全渠道' },
      { label: '活跃渠道数', value: report.activeChannels, hint: '今日有更新的渠道' },
      { label: '热点条数', value: hotCount, hint: '进入热点榜 TOP ' + hotCount },
      { label: '涉及分类数', value: catCount, hint: '按渠道分类统计' }
    ].map(function (m) {
      return '<div class="card metric"><div class="metric-label">' + RR.esc(m.label) + '</div>' +
        '<div class="metric-value">' + RR.esc(String(m.value)) + '</div>' +
        '<div class="metric-hint">' + RR.esc(m.hint) + '</div></div>';
    }).join('');

    /* ---- 主体 ---- */
    var cats = report.categoryStats.map(function (c) {
      return { key: c.category, label: c.label, value: c.itemCount, color: RR.catMeta(c.category).color, ratio: c.ratio };
    });

    body.innerHTML =
      // 热点区 + 分类分布（两栏）
      '<section class="section report-two-col">' +
        '<div class="card"><div class="card-header"><span class="card-title">热点榜 TOP ' + hotCount + '</span>' +
          '<span class="section-sub">按热度分（hotScore）倒序</span></div>' +
          '<div class="card-pad" style="padding-top:var(--space-2);padding-bottom:var(--space-2)">' +
            report.hotList.map(hotRow).join('') +
          '</div>' +
        '</div>' +
        '<div class="card"><div class="card-header"><span class="card-title">分类分布</span>' +
          '<span class="section-sub">条数 / 占比</span></div>' +
          '<div class="card-pad chart-wrap">' +
            RR.pieChart(cats, { ariaLabel: '分类分布饼图' }) +
            '<div style="width:100%">' + cats.map(function (c) {
              return '<div class="pie-legend-row"><span class="lbl"><span class="legend-swatch" style="background:' + RR.esc(c.color) + '"></span>' +
                RR.esc(c.label) + '</span><span class="val">' + c.value + ' · ' + Math.round(c.ratio * 100) + '%</span></div>';
            }).join('') + '</div>' +
          '</div>' +
        '</div>' +
      '</section>' +

      // 分类分栏
      '<section class="section">' +
        '<div class="section-head"><h2>分类分栏</h2><span class="section-sub">各分类当天代表条目（按分类多标签归入）</span></div>' +
        '<div class="cat-columns">' + report.categoryStats.map(catColumn).join('') + '</div>' +
      '</section>' +

      // 渠道活跃排行
      '<section class="section">' +
        '<div class="section-head"><h2>渠道活跃度排行</h2><span class="section-sub">今日条数（含 activityScore）</span></div>' +
        '<div class="card card-pad">' +
          RR.barChart(report.channelActivity.map(function (c) {
            return { label: c.channelName, value: c.itemCount, color: RR.catMeta((c.category || [])[0]).color };
          }), { ariaLabel: '渠道活跃度条形图' }) +
        '</div>' +
      '</section>' +

      // 跨源重合榜（PRD §6.3 :613 / F-063，P1）
      '<section class="section">' +
        '<div class="section-head"><h2>跨源重合榜</h2><span class="section-sub">同一主题被多个渠道报道 · 热点判定的关键信号</span></div>' +
        '<div class="card card-pad">' +
          (report.crossSource && report.crossSource.length
            ? report.crossSource.map(function (cs, i) {
                return '<div class="hot-row">' +
                  '<div class="hot-rank' + (i < 3 ? ' r' + (i + 1) : '') + '">' + (i + 1) + '</div>' +
                  '<div class="hot-main">' +
                    '<div class="hot-title">' + RR.esc(cs.topic) + '</div>' +
                    '<div class="hot-meta">' +
                      '<span class="tag tag-primary">共 ' + cs.sourceCount + ' 个渠道报道</span>' +
                      cs.channelNames.map(function (n) { return '<span class="badge-channel">' + RR.esc(n) + '</span>'; }).join(' ') +
                    '</div>' +
                  '</div>' +
                '</div>';
              }).join('')
            : '<p class="muted" style="font-size:var(--fs-sm)">今日无跨源重合主题。</p>') +
        '</div>' +
      '</section>' +

      // 关键词（P1，原型展示）
      '<section class="section">' +
        '<div class="section-head"><h2>当日关键词</h2><span class="section-sub">高频词（P1 · 词云数据的平面展示）</span></div>' +
        '<div class="card card-pad"><div class="chip-row">' +
          report.keywords.map(function (k) {
            var size = 13 + Math.round(k.weight * 9);
            return '<span class="tag tag-primary" style="font-size:' + size + 'px;height:auto;padding:4px 10px">' +
              RR.esc(k.word) + ' <span class="muted">' + k.count + '</span></span>';
          }).join('') +
        '</div></div>' +
      '</section>';

    /* ---- 方法论（可折叠） ---- */
    methodology.innerHTML =
      '<details class="accordion">' +
        '<summary>热点如何判定？（方法论说明）' + RR.ICONS.chevron + '</summary>' +
        '<div class="accordion-body">' +
          '<p class="muted" style="font-size:var(--fs-sm)">热度分 <code>hotScore</code> 由五个维度加权归一化得到（权重对齐 PRD §10.1 与 site-config）：</p>' +
          '<table class="table">' +
            '<thead><tr><th>维度</th><th>权重</th><th>说明</th></tr></thead><tbody>' +
            '<tr><td>跨源重合度</td><td class="num">' + report.weights.sourceOverlap + '</td><td>同一主题被多少渠道报道（log + max 归一化）</td></tr>' +
            '<tr><td>出现频次</td><td class="num">' + report.weights.frequency + '</td><td>关键词/主题当天出现次数</td></tr>' +
            '<tr><td>时间衰减</td><td class="num">' + report.weights.recency + '</td><td>越新权重越高，半衰期 ' + report.weights.halfLifeHours + ' 小时</td></tr>' +
            '<tr><td>渠道权重</td><td class="num">' + report.weights.channelWeight + '</td><td>高权威渠道加权（可配置）</td></tr>' +
            '<tr><td>关键词热度</td><td class="num">' + report.weights.keywordHeat + '</td><td>命中高热度词表</td></tr>' +
            '</tbody></table>' +
          '<p class="muted" style="font-size:var(--fs-sm);margin-top:var(--space-3)">' +
            '公式：<code>hotScore = w1·Z_重合 + w2·decay + w3·Z_频次 + w4·渠道权重 + w5·关键词</code>。' +
            '跨源重合是判定「真正热点」的重要信号（越多源报道 → 越热）。报告边界：<strong>只分析当天数据，跨天重置</strong>。</p>' +
        '</div>' +
      '</details>';

    /* ---- 底部 ---- */
    footer.innerHTML =
      '<div style="display:flex;flex-wrap:wrap;gap:var(--space-4);align-items:center;justify-content:space-between">' +
        '<p class="muted" style="font-size:var(--fs-xs);margin:0">' +
          RR.esc(MOCK.site.site.footer) + '<br>报告字段：ReportDate / TotalItems / ActiveChannels / CategoryStats / HotList / HotScore / CrossSourceCount / ChannelActivity / Summary / GeneratedAt。' +
          '<br>口径说明：分类统计按条目「主分类」归入，因此各分类条数之和恒等于总条数；仅展示当天有内容的分类（PRD 命名 8 类，空缺分类不占位）。' +
        '</p>' +
        '<a class="btn btn-primary" href="page4-history.html">查看历史趋势 →</a>' +
      '</div>' +
      '<div style="margin-top:var(--space-4)">' +
        '<button type="button" id="toggle-empty" class="btn btn-sm">演示空态（今日暂无数据）</button>' +
      '</div>';

    var te = el('toggle-empty');
    if (te) {
      te.addEventListener('click', function () {
        simulateEmpty = !simulateEmpty;
        render();
        if (!simulateEmpty) { return; }
      });
    }
  }

  function hotRow(h) {
    var pct = Math.round(h.hotScore * 100);
    return '<div class="hot-row">' +
      '<div class="hot-rank r' + (h.rank <= 3 ? h.rank : '') + '">' + h.rank + '</div>' +
      '<div class="hot-main">' +
        '<a class="hot-title" href="' + RR.esc(h.url) + '" target="_blank" rel="noopener">' + RR.esc(h.title) + '</a>' +
        '<div class="hot-meta">' +
          RR.channelBadge(h.channelId, h.channelName) +
          (h.category || []).map(RR.catTag).join(' ') +
          '<span class="muted" style="font-size:var(--fs-xs)">来源数 <strong>' + h.sourceCount + '</strong></span>' +
          '<span class="muted" style="font-size:var(--fs-xs)" title="' + RR.esc((h.channelNames || []).join('、')) + '">' +
            RR.esc((h.channelNames || []).join('、')) + '</span>' +
        '</div>' +
        '<div class="hot-score" style="margin-top:6px">' +
          '<span class="muted" style="font-size:var(--fs-xs)">热度</span>' +
          '<span class="hot-bar-wrap"><span class="progress"><span style="width:' + pct + '%"></span></span></span>' +
          '<span class="score-val">' + h.hotScore.toFixed(2) + '</span>' +
        '</div>' +
      '</div>' +
    '</div>';
  }

  function catColumn(cs) {
    var reps = MOCK.items
      .filter(function (it) { return !it.duplicateOf && (it.category || []).indexOf(cs.category) >= 0; })
      .sort(function (a, b) {
        var ah = a.hotScore || 0, bh = b.hotScore || 0;
        if (ah !== bh) { return bh - ah; }
        return a.updatedAt < b.updatedAt ? 1 : -1;
      })
      .slice(0, 4);
    var meta = RR.catMeta(cs.category);
    return '<div class="card cat-col">' +
      '<div class="cat-col-head">' +
        '<span class="legend-swatch" style="background:' + RR.esc(meta.color) + '"></span>' +
        '<strong>' + RR.esc(cs.label) + '</strong>' +
        '<span class="muted" style="margin-left:auto;font-size:var(--fs-xs)">' + cs.itemCount + ' 条 · ' + Math.round(cs.ratio * 100) + '%</span>' +
      '</div>' +
      '<ul class="cat-col-body">' +
        (reps.length ? reps.map(function (it) {
          return '<li><a href="' + RR.esc(it.url) + '" target="_blank" rel="noopener">' + RR.esc(it.title) + '</a>' +
            '<div class="chan-item-meta" style="margin-top:3px">' + RR.timeEl(it.updatedAt) +
            (it.sourceCount > 1 ? '<span class="badge-source" style="pointer-events:none">＋' + (it.sourceCount - 1) + ' 源</span>' : '') +
            '</div></li>';
        }).join('') : '<li class="muted">该分类当天暂无条目</li>') +
      '</ul>' +
    '</div>';
  }

  document.addEventListener('DOMContentLoaded', init);
})();
