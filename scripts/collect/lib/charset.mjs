// lib/charset.mjs — 响应体编码嗅探与解码
//
// 为什么需要这个模块
// ------------------
// WHATWG fetch 规范规定 `Response.text()` **始终按 UTF-8 解码，并忽略响应头的
// charset**。对 GBK 站点（典型：Discuz 论坛发 `<?xml encoding="gbk"?>` 而 HTTP 头
// 只给 `application/xml` 不带 charset）会导致整源中文变成 U+FFFD 替换字符。
// 2026-09-16 实测 52pojie：33/33 条标题全坏（`Excelͨ?ò?????ģ??`），按 GBK 解码
// 后完全正常（`Excel通用财务账模板`）。
//
// 设计原则：**不盲信任何单一声明**
// ------------------------------
// 按信任度递减确定编码：
//   1. BOM                     —— 物理信号，最强
//   2. HTTP Content-Type charset
//   3. 内容内声明              —— XML `<?xml encoding>` / HTML `<meta charset>`
//   4. UTF-8 严格解码试探      —— 无声明时的合理默认（当前 ~95% 源为 UTF-8）
//   5. GB18030                 —— GBK 超集，覆盖简体中文老站点
//   6. 宽松解码选替换字符最少者 —— 最后兜底：宁可留少量 U+FFFD 也不抛错中断采集
//
// 刻意不做的两件事
// ----------------
// - **不把 latin1/ascii/windows-1252 当真**：大量服务器（尤其老 PHP 站、图床、
//   CDN 默认配置）无条件声明 `latin1`，真按它解会把 UTF-8 中文解成 `Ã¥` 系列，
//   比 U+FFFD 更难辨识、更容易被误认为"正常内容"。这类声明一律降级为「无声明」。
// - **不在正文上做有损美化**：上游本身已含 U+FFFD 的数据（36kr 实测，源站原始
//   字节即带坏字）无法还原，本模块原样保留，交由上层检测告警，不伪造内容。

/** BOM 表：按长度降序，避免 UTF-16 的短 BOM 抢先匹配 UTF-8 场景 */
const BOMS = [
  { bytes: [0xef, 0xbb, 0xbf], encoding: 'utf-8' },
  { bytes: [0xff, 0xfe], encoding: 'utf-16le' },
  { bytes: [0xfe, 0xff], encoding: 'utf-16be' },
];

/** 编码别名 → 标准名。GBK 系一律上收到 GB18030（超集，能解的更多） */
const ALIASES = new Map([
  ['gbk', 'gb18030'],
  ['gb2312', 'gb18030'],
  ['gb_2312', 'gb18030'],
  ['gb2312-80', 'gb18030'],
  ['csgb2312', 'gb18030'],
  ['x-gbk', 'gb18030'],
  ['gb18030', 'gb18030'],
  ['utf8', 'utf-8'],
  ['utf-8', 'utf-8'],
  ['unicode-1-1-utf-8', 'utf-8'],
  ['big5', 'big5'],
  ['big5-hkscs', 'big5'],
  ['x-x-big5', 'big5'],
  ['shift_jis', 'shift_jis'],
  ['shift-jis', 'shift_jis'],
  ['sjis', 'shift_jis'],
  ['x-sjis', 'shift_jis'],
  ['euc-jp', 'euc-jp'],
  ['euc-kr', 'euc-kr'],
  ['ks_c_5601-1987', 'euc-kr'],
  ['utf-16', 'utf-16le'],
  ['utf-16le', 'utf-16le'],
  ['utf-16be', 'utf-16be'],
]);

/**
 * 不可信声明：这些标签在真实互联网上被大量错误使用，按它解码的破坏性
 * 大于收益。遇到即视为「无声明」，交给内容试探。
 */
const UNTRUSTED = new Set([
  'latin1', 'latin-1', 'iso-8859-1', 'iso8859-1', 'iso_8859-1', 'l1',
  'ascii', 'us-ascii', 'ansi_x3.4-1968',
  'windows-1252', 'cp1252', 'x-cp1252',
  'unicode', 'unknown', 'binary',
]);

/**
 * 归一化编码标签。
 * @param {string|undefined|null} label
 * @returns {string|null} 标准编码名；null 表示「不可信 / 无有效声明」
 */
export function normalizeEncodingLabel(label) {
  if (!label) return null;
  const k = String(label).trim().toLowerCase().replace(/^["']|["']$/g, '');
  if (!k) return null;
  if (UNTRUSTED.has(k)) return null;
  if (ALIASES.has(k)) return ALIASES.get(k);
  return k;
}

/** 读 BOM。返回 { encoding, source:'bom' } 或 null */
export function sniffBom(bytes) {
  for (const bom of BOMS) {
    if (bytes.length < bom.bytes.length) continue;
    let hit = true;
    for (let i = 0; i < bom.bytes.length; i += 1) {
      if (bytes[i] !== bom.bytes[i]) {
        hit = false;
        break;
      }
    }
    if (hit) return { encoding: bom.encoding, source: 'bom' };
  }
  return null;
}

/** 从 Content-Type 取 charset。返回 { encoding, source:'http' } 或 null */
export function sniffHttpCharset(contentType) {
  if (!contentType) return null;
  const m = /;\s*charset\s*=\s*"?([\w.:_-]+)"?/i.exec(String(contentType));
  if (!m) return null;
  const enc = normalizeEncodingLabel(m[1]);
  if (!enc) return null;
  return { encoding: enc, source: 'http' };
}

/**
 * 从内容头部读内嵌声明。
 *
 * 声明区必须是 ASCII 兼容的（XML 规范要求），故用 latin1 读前 2KB 做正则匹配安全 ——
 * 即使正文是 GBK/UTF-16，声明片段本身在 latin1 视角下仍可匹配。
 * 返回 { encoding, source:'xml'|'html' } 或 null
 */
export function sniffInnerDeclaration(bytes) {
  const head = Buffer.from(bytes.subarray(0, 2048)).toString('latin1');
  const xml = /<\?xml[^>]*\bencoding\s*=\s*["']([\w.:_-]+)["']/i.exec(head);
  if (xml) {
    const enc = normalizeEncodingLabel(xml[1]);
    if (enc) return { encoding: enc, source: 'xml' };
  }
  const meta = /<meta[^>]*\bcharset\s*=\s*["']?([\w.:_-]+)/i.exec(head);
  if (meta) {
    const enc = normalizeEncodingLabel(meta[1]);
    if (enc) return { encoding: enc, source: 'html' };
  }
  return null;
}

/** 统计替换字符（U+FFFD）数量 —— 解码质量的度量 */
export function countReplacements(text) {
  if (!text) return 0;
  const m = String(text).match(/\uFFFD/g);
  return m ? m.length : 0;
}

/** 尝试解码。成功返回字符串，不可用/非法返回 null */
function tryDecode(bytes, encoding, strict) {
  try {
    // stream:true —— 字节流若正好停在多字节序列中间，视为「待续」而不是非法。
    //
    // 这一条是为「只读前 N 字节」的诊断场景准备的：读满 N 字节就断开时，末尾极可能
    // 正好切断一个多字节字符，若按完整模式解码会报非法 → 退化成 lossy → 凭空多出
    // 1 个 U+FFFD。实测 104 源全量探测里有 13 个源「恰好 1 个坏字」，全是这个伪影
    // （整齐到反常，正是测量误差的特征）。
    //
    // 对采集场景无副作用：真实响应是完整的，不会以半个字符结尾；若源本身真在末尾
    // 发了非法序列，那丢掉的也只是那半个残字，而不是把整份内容判成非 UTF-8。
    return new TextDecoder(encoding, { fatal: strict }).decode(bytes, { stream: true });
  } catch {
    // ① 该编码不被本运行时支持（如 small-icu 构建无 gb18030）→ RangeError
    // ② 严格模式下遇到非法字节序列 → TypeError
    return null;
  }
}

/**
 * 嗅探「声明」层面的编码（不做内容试探）。供诊断脚本使用。
 * @param {Uint8Array|Buffer} bytes
 * @param {string} [contentType]
 * @returns {{encoding:string, source:string}|null}
 */
export function sniffCharset(bytes, contentType) {
  return sniffBom(bytes) ?? sniffHttpCharset(contentType) ?? sniffInnerDeclaration(bytes);
}

/**
 * 解码响应体（主入口）。
 *
 * 判定顺序（**不盲信声明**，见下方注释里对每个判断的理由）：
 *   ① BOM                —— 物理信号
 *   ② 宽字符声明         —— UTF-16/32 声明必须抢在 UTF-8 试探之前
 *   ③ UTF-8 严格试探      —— 成功率极高的判据，可纠正「声明与实际不符」
 *   ④ 声明（HTTP → 内嵌）
 *   ⑤ GB18030 兜底
 *   ⑥ 宽松解码 / latin1  —— 保证链路不中断
 *
 * @param {Uint8Array|Buffer|string} input 原始字节；传字符串则原样返回
 * @param {string} [contentType] HTTP 响应头 Content-Type
 * @returns {{text:string, encoding:string, source:string, replacements:number}}
 */
export function decodeBody(input, contentType) {
  if (typeof input === 'string') {
    return { text: input, encoding: 'passthrough', source: 'string-input', replacements: countReplacements(input) };
  }
  const bytes = Buffer.isBuffer(input) ? input : Buffer.from(input ?? []);

  // ① BOM：最强信号，直接采信
  const bom = sniffBom(bytes);
  if (bom) {
    const text = tryDecode(bytes, bom.encoding, true) ?? tryDecode(bytes, bom.encoding, false);
    if (text !== null) {
      return { text, encoding: bom.encoding, source: 'bom', replacements: countReplacements(text) };
    }
  }

  const declared = sniffHttpCharset(contentType) ?? sniffInnerDeclaration(bytes);

  // ② 宽字符声明必须先于 UTF-8 试探：UTF-16 字节流里的 0x00 是**合法 UTF-8**，
  //    交给 UTF-8 试探会"假装成功"并解出 `H\0e\0l\0l\0o\0` 这种带 NUL 的垃圾，
  //    比报错更难察觉。
  if (declared && /^utf-(16|32)(le|be)?$/.test(declared.encoding)) {
    const text = tryDecode(bytes, declared.encoding, true) ?? tryDecode(bytes, declared.encoding, false);
    if (text !== null) {
      return { text, encoding: declared.encoding, source: declared.source, replacements: countReplacements(text) };
    }
  }

  // ③ UTF-8 严格试探 —— 本模块最关键的判据。
  //    严格模式下任一非法字节即抛错，而 GBK/Big5 的多字节序列（首字节高位、
  //    次字节跨 0x40-0xFE）几乎不可能构成合法 UTF-8 序列。故：
  //      · 成功且含非 ASCII 多字节 ⇒ 内容确为 UTF-8，**即便声明说别的也采信内容**
  //        （能纠正站点误配 charset 的源，这类站真实存在）
  //      · 成功但纯 ASCII ⇒ 任何编码结果一致，不构成证据，让给声明（④）
  //      · 失败 ⇒ 内容不是 UTF-8，让给声明（④）或 GB18030（⑤）
  const utf8Strict = tryDecode(bytes, 'utf-8', true);
  if (utf8Strict !== null) {
    const hasMultiByte = /[^\x00-\x7F]/.test(utf8Strict);
    if (!declared || hasMultiByte) {
      return {
        text: utf8Strict,
        encoding: 'utf-8',
        source: declared ? (declared.encoding === 'utf-8' ? declared.source : 'probe-override') : 'probe',
        replacements: 0,
      };
    }
  }

  // ④ 按声明解码
  if (declared) {
    const text = tryDecode(bytes, declared.encoding, true);
    if (text !== null) {
      return { text, encoding: declared.encoding, source: declared.source, replacements: 0 };
    }
  }

  // ⑤ GB18030 兜底（GBK 超集）：无有效声明，或声明解不动时的中文老站退路
  const gbStrict = tryDecode(bytes, 'gb18030', true);
  if (gbStrict !== null) {
    return { text: gbStrict, encoding: 'gb18030', source: 'probe', replacements: 0 };
  }

  // ⑥ 全部严格失败 → 宽松解码，取替换字符最少的方案（有损，但采集不中断）
  /** @type {Array<{encoding:string, source:string}>} */
  const order = [];
  if (declared) order.push(declared);
  if (!order.some((c) => c.encoding === 'utf-8')) order.push({ encoding: 'utf-8', source: 'probe' });
  if (!order.some((c) => c.encoding === 'gb18030')) order.push({ encoding: 'gb18030', source: 'probe' });

  let best = null;
  for (const cand of order) {
    const text = tryDecode(bytes, cand.encoding, false);
    if (text === null) continue;
    const replacements = countReplacements(text);
    if (!best || replacements < best.replacements) {
      best = { text, encoding: cand.encoding, source: `${cand.source}+lossy`, replacements };
    }
  }
  if (best) return best;

  // 最后兜底：latin1 永不失败，至少保证采集链路不中断
  const text = bytes.toString('latin1');
  return { text, encoding: 'latin1', source: 'last-resort', replacements: countReplacements(text) };
}
