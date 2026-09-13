/* =============================================================================
 * RSS Radar — 站点配置 / 用户偏好 Store（localStorage）
 * -----------------------------------------------------------------------------
 * 对应 PRD §6.2 配置项、B6「用户配置持久化 localStorage」。
 *
 * 设计：
 *   1. 站点默认配置来自 mock 的 site-config（mock-data.js → RR_MOCK.site）
 *   2. 用户改动（展示渠道 / 每卡片条数 / 排序 / 页面1 偏好）叠加其上，存 localStorage
 *   3. 无 localStorage 时（隐私模式等）自动降级为内存态，不报错
 * ========================================================================== */

window.RR_STORE = (function () {
  'use strict';

  var KEY = 'rss-radar.prototype.config.v1';

  /** localStorage 可用性探测（隐私模式 / file:// 下亦可能可用）。 */
  var memFallback = {};
  function storageAvailable() {
    try {
      var t = '__rr_probe__';
      window.localStorage.setItem(t, '1');
      window.localStorage.removeItem(t);
      return true;
    } catch (e) {
      return false;
    }
  }
  var hasLS = storageAvailable();

  function rawGet(k) {
    try { return hasLS ? window.localStorage.getItem(k) : (memFallback[k] || null); }
    catch (e) { return null; }
  }
  function rawSet(k, v) {
    try {
      if (hasLS) { window.localStorage.setItem(k, v); } else { memFallback[k] = v; }
      return true;
    } catch (e) { memFallback[k] = v; return false; }
  }

  /** 站点默认配置（对齐 site-config.example.json 的可读子集）。 */
  function defaults() {
    var s = (window.RR_MOCK && window.RR_MOCK.site) || {};
    var display = s.display || {};
    var history = s.history || {};
    return {
      // 页面2：配置抽屉
      channels: null,                 // null = 全部启用渠道；否则为选中的 channelId 数组
      cardLimit: display.cardLimit || 10,  // 每卡片条数 5 / 10 / 20
      cardLimitUserSet: false,        // 用户是否在抽屉里显式设置过（显式优先于移动端降级）
      cardSort: 'updatedAt',          // updatedAt | name
      // 页面1：默认排序
      page1Sort: display.defaultSort || 'updatedAt',  // updatedAt | publishedAt
      page1BatchSize: display.page1BatchSize || 20,
      page1BatchSizeUserSet: false,   // 用户是否显式改过每批条数
      // 页面4：趋势窗口
      historyWindow: history.windowDays || 90
    };
  }

  /** 读取配置（默认值 + 用户覆盖的深合并）。 */
  function get() {
    var base = defaults();
    var raw = rawGet(KEY);
    if (!raw) { return base; }
    var saved;
    try { saved = JSON.parse(raw); } catch (e) { return base; }
    if (!saved || typeof saved !== 'object') { return base; }
    Object.keys(base).forEach(function (k) {
      if (Object.prototype.hasOwnProperty.call(saved, k) && saved[k] !== undefined) {
        base[k] = saved[k];
      }
    });
    return base;
  }

  /** 保存部分配置（浅合并后写回）。 */
  function set(patch) {
    var cur = get();
    Object.keys(patch || {}).forEach(function (k) { cur[k] = patch[k]; });
    rawSet(KEY, JSON.stringify(cur));
    return cur;
  }

  /** 重置为站点默认配置。 */
  function reset() {
    try {
      if (hasLS) { window.localStorage.removeItem(KEY); } else { delete memFallback[KEY]; }
    } catch (e) { /* ignore */ }
    return defaults();
  }

  return { KEY: KEY, get: get, set: set, reset: reset, defaults: defaults, hasLocalStorage: hasLS };
})();
