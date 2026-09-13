// classify.mjs — 关键词规则 → 分类打标
// P1 MVP：基于 config/keyword-rules.json 做关键词匹配
// P2 升级：与 T-P2-05 报告生成的 keyword 提取共享

/**
 * 加载 config/keyword-rules.json → Map<category, keywords[]>
 * @param {string} configPath 默认 config/keyword-rules.json
 */
export function loadKeywordRules(configPath) {
  const { readFileSync } = require('node:fs');
  // 用 ESM 写法：实际是 dynamic import；此处简化为顶层加载
  let rules;
  try {
    const fs = require('node:fs');
    rules = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (e) {
    throw new Error(`Failed to load keyword rules from ${configPath}: ${e.message}`);
  }
  const map = new Map();
  for (const r of rules.rules ?? []) {
    if (!map.has(r.category)) map.set(r.category, []);
    map.get(r.category).push(...(r.keywords ?? []));
  }
  return map;
}

/**
 * 给一个 Item 推断 category（叠加到 channel.category）
 * 返回合并后的 category 数组（去重）
 */
export function classifyItem(item, ruleMap) {
  const text = `${item.title || ''}\n${item.summary || ''}`.toLowerCase();
  const cat = new Set(item.category ?? []);
  for (const [category, kws] of ruleMap.entries()) {
    for (const kw of kws) {
      if (text.includes(String(kw).toLowerCase())) {
        cat.add(category);
        break;
      }
    }
  }
  return Array.from(cat);
}