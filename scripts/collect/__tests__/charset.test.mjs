// scripts/collect/__tests__/charset.test.mjs
// 响应体编码嗅探与解码契约。背景（2026-09-16）：
//   此前 fetchText 用 `res.text()` —— WHATWG 规范规定它**始终按 UTF-8 解码并忽略
//   响应头的 charset**。GBK 站点（52pojie / Discuz：HTTP 头只给 `application/xml`
//   不带 charset，编码写在内嵌声明里）因此整源乱码：实测 33/33 条标题变成
//   U+FFFD，单次抓取 4963 个坏字符；按 GBK 解码后完全正常（Excel通用财务账模板）。
//
// 本套件锁两件事，缺一不可：
//   ① 非 UTF-8 源能被正确解码（治已病）
//   ② UTF-8 源不被改坏（不引入新病）—— 单向测试会漏掉「修好一个、弄坏一批」
//
// 特别注意 `latin1` 那条：错信这类声明**不会产生 U+FFFD**，而是静默解成
// `ä¸æ–‡` 形态，肉眼像"有内容"、程序也不报错，是最难发现的损坏。
// 以此类推，本模块的总原则是「不盲信任何单一声明，用内容反证」。
import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  decodeBody,
  sniffCharset,
  sniffBom,
  sniffHttpCharset,
  sniffInnerDeclaration,
  normalizeEncodingLabel,
  countReplacements,
} from '../lib/charset.mjs';

/** 「中文」的 GBK 字节：D6D0 CEC4 */
const GBK_ZHONGWEN = Buffer.from([0xd6, 0xd0, 0xce, 0xc4]);
/** 「中文」的 UTF-8 字节：E4B8AD E69687 */
const UTF8_ZHONGWEN = Buffer.from('中文', 'utf8');
const BOM_UTF8 = Buffer.from([0xef, 0xbb, 0xbf]);

describe('normalizeEncodingLabel — 标签归一化与可信度', () => {
  it('GBK 系一律上收到 gb18030（超集，能解的更多）', () => {
    for (const label of ['gbk', 'GBK', 'gb2312', 'gb_2312', 'csgb2312', 'x-gbk', 'gb18030']) {
      assert.equal(normalizeEncodingLabel(label), 'gb18030', label);
    }
  });

  it('UTF-8 的常见别名收敛到 utf-8', () => {
    for (const label of ['utf-8', 'UTF8', 'utf8', 'unicode-1-1-utf-8']) {
      assert.equal(normalizeEncodingLabel(label), 'utf-8', label);
    }
  });

  it('★ 不可信声明返回 null —— 不许拿 latin1/ascii 当真', () => {
    for (const label of ['latin1', 'iso-8859-1', 'us-ascii', 'windows-1252', 'binary', 'unknown']) {
      assert.equal(normalizeEncodingLabel(label), null, label);
    }
  });

  it('空值 / 纯空白 / 带引号均安全', () => {
    assert.equal(normalizeEncodingLabel(undefined), null);
    assert.equal(normalizeEncodingLabel(null), null);
    assert.equal(normalizeEncodingLabel(''), null);
    assert.equal(normalizeEncodingLabel('   '), null);
    assert.equal(normalizeEncodingLabel('"gbk"'), 'gb18030');
    assert.equal(normalizeEncodingLabel("'GB2312'"), 'gb18030');
  });

  it('未收录的标签原样返回（交由 TextDecoder 判定可用性）', () => {
    assert.equal(normalizeEncodingLabel('utf-32le'), 'utf-32le');
  });
});

describe('嗅探：BOM / HTTP / 内嵌声明及优先级', () => {
  it('BOM 被识别（UTF-8 / UTF-16LE / UTF-16BE）', () => {
    assert.deepEqual(sniffBom(Buffer.concat([BOM_UTF8, UTF8_ZHONGWEN])), { encoding: 'utf-8', source: 'bom' });
    assert.deepEqual(sniffBom(Buffer.from([0xff, 0xfe, 0x61, 0x00])), { encoding: 'utf-16le', source: 'bom' });
    assert.deepEqual(sniffBom(Buffer.from([0xfe, 0xff, 0x00, 0x61])), { encoding: 'utf-16be', source: 'bom' });
    assert.equal(sniffBom(UTF8_ZHONGWEN), null);
  });

  it('HTTP charset 被识别；不可信声明被跳过', () => {
    assert.deepEqual(sniffHttpCharset('application/xml; charset=gbk'), { encoding: 'gb18030', source: 'http' });
    assert.deepEqual(sniffHttpCharset('text/xml;charset="GB2312"'), { encoding: 'gb18030', source: 'http' });
    assert.deepEqual(sniffHttpCharset('application/rss+xml; charset=utf-8'), { encoding: 'utf-8', source: 'http' });
    assert.equal(sniffHttpCharset('text/xml; charset=latin1'), null);
    assert.equal(sniffHttpCharset('application/xml'), null);
    assert.equal(sniffHttpCharset(undefined), null);
  });

  it('XML 声明与 HTML meta 均被识别', () => {
    const xml = Buffer.concat([Buffer.from('<?xml version="1.0" encoding="gbk"?>'), GBK_ZHONGWEN]);
    assert.deepEqual(sniffInnerDeclaration(xml), { encoding: 'gb18030', source: 'xml' });
    const html = Buffer.concat([Buffer.from('<meta charset="gb2312">'), GBK_ZHONGWEN]);
    assert.deepEqual(sniffInnerDeclaration(html), { encoding: 'gb18030', source: 'html' });
    assert.equal(sniffInnerDeclaration(GBK_ZHONGWEN), null);
  });

  it('优先级：BOM > HTTP > 内嵌声明', () => {
    const xmlDecl = Buffer.from('<?xml version="1.0" encoding="gbk"?>');
    const withBom = Buffer.concat([BOM_UTF8, xmlDecl, UTF8_ZHONGWEN]);
    assert.deepEqual(sniffCharset(withBom, 'text/xml; charset=big5'), { encoding: 'utf-8', source: 'bom' });
    assert.deepEqual(sniffCharset(xmlDecl, 'text/xml; charset=utf-8'), { encoding: 'utf-8', source: 'http' });
    assert.deepEqual(sniffCharset(xmlDecl), { encoding: 'gb18030', source: 'xml' });
  });
});

describe('decodeBody — 治已病：非 UTF-8 源正确解码', () => {
  it('★ 复现 52pojie：GBK 字节 + XML 声明 → 正确中文', () => {
    const body = Buffer.concat([Buffer.from('<?xml version="1.0" encoding="gbk"?>'), GBK_ZHONGWEN]);
    const d = decodeBody(body, 'application/xml');
    assert.equal(d.text.endsWith('中文'), true);
    assert.equal(d.encoding, 'gb18030');
    assert.equal(d.source, 'xml');
    assert.equal(d.replacements, 0);
  });

  it('★ 对照证据：同一份 GBK 字节若强制按 UTF-8 解码即产生替换字符', () => {
    // 这条断言是「为什么不能用 res.text()」的物证，防止有人把它改回去
    const forceUtf8 = GBK_ZHONGWEN.toString('utf8');
    assert.ok(countReplacements(forceUtf8) > 0, '精确按 UTF-8 解 GBK 字节必须产生替换字符');
    assert.notEqual(forceUtf8, '中文');
  });

  it('GBK 字节无任何声明 → UTF-8 试探失败后回退 gb18030', () => {
    const d = decodeBody(GBK_ZHONGWEN, 'application/xml');
    assert.equal(d.text, '中文');
    assert.equal(d.encoding, 'gb18030');
    assert.equal(d.source, 'probe');
    assert.equal(d.replacements, 0);
  });

  it('HTTP 头带 charset=gbk 时同样正确', () => {
    const d = decodeBody(GBK_ZHONGWEN, 'text/xml; charset=gbk');
    assert.equal(d.text, '中文');
    assert.equal(d.encoding, 'gb18030');
    assert.equal(d.source, 'http');
  });

  it('声明为 big5 时按 big5 解，不乱选 gb18030', () => {
    const big5 = Buffer.from([0xa4, 0xa4]);
    const d = decodeBody(big5, 'text/xml; charset=big5');
    assert.equal(d.encoding, 'big5');
    assert.equal(d.replacements, 0);
  });
});

describe('decodeBody — 不引入新病：UTF-8 源不被改坏', () => {
  it('UTF-8 字节 + UTF-8 声明 → 原样通过', () => {
    const d = decodeBody(UTF8_ZHONGWEN, 'application/rss+xml; charset=utf-8');
    assert.equal(d.text, '中文');
    assert.equal(d.encoding, 'utf-8');
    assert.equal(d.source, 'http');
    assert.equal(d.replacements, 0);
  });

  it('UTF-8 字节无声明 → 判为 utf-8（严格试探成功）', () => {
    const d = decodeBody(UTF8_ZHONGWEN, undefined);
    assert.equal(d.text, '中文');
    assert.equal(d.encoding, 'utf-8');
    assert.equal(d.source, 'probe');
  });

  it('★ 双向：真 UTF-8 内容不会被误判成 GBK', () => {
    const d = decodeBody(UTF8_ZHONGWEN, 'application/xml');
    assert.equal(d.text, '中文');
    assert.notEqual(d.encoding, 'gb18030');
  });

  it('含 BOM 的 UTF-8：正确解码且 BOM 不残留在文本里', () => {
    const d = decodeBody(Buffer.concat([BOM_UTF8, UTF8_ZHONGWEN]), undefined);
    assert.equal(d.text.includes('中文'), true);
    assert.equal(d.text.charCodeAt(0) === 0xfeff, false, 'BOM 必须被剥离');
    assert.equal(d.source, 'bom');
  });

  it('★ latin1 声明必须被忽略 —— 错信它会把 UTF-8 中文静默解成 ä¸æ–‡', () => {
    const d = decodeBody(UTF8_ZHONGWEN, 'application/xml; charset=latin1');
    assert.equal(d.text, '中文');
    assert.equal(d.encoding, 'utf-8');
    assert.notEqual(d.encoding, 'latin1');

    // 对照：真按 latin1 解会得到什么（无替换字符，故程序不会报错 —— 最危险之处）
    const ifTrusted = UTF8_ZHONGWEN.toString('latin1');
    assert.notEqual(ifTrusted, '中文');
    assert.equal(countReplacements(ifTrusted), 0, 'latin1 误用不产生替换字符，属静默损坏');
  });

  it('★ 内容反证声明：声明 gbk 但实际是 UTF-8 → 采信内容', () => {
    const d = decodeBody(UTF8_ZHONGWEN, 'text/xml; charset=gbk');
    assert.equal(d.text, '中文');
    assert.equal(d.encoding, 'utf-8');
    assert.equal(d.source, 'probe-override');
  });

  it('宽字符声明（utf-16le）能被正确解码，不被 UTF-8 试探抢走', () => {
    const d = decodeBody(Buffer.from('中文', 'utf16le'), 'text/xml; charset=utf-16le');
    assert.equal(d.text, '中文');
    assert.equal(d.encoding, 'utf-16le');
  });

  it('纯 ASCII 内容按声明走，结果一致（不制造 probe-override 噪音）', () => {
    const d = decodeBody(Buffer.from('<rss><title>Hello</title></rss>'), 'text/xml; charset=gbk');
    assert.equal(d.text, '<rss><title>Hello</title></rss>');
    assert.equal(d.replacements, 0);
  });

  it('纯 ASCII 无声明 → utf-8', () => {
    const d = decodeBody(Buffer.from('<rss/>'), undefined);
    assert.equal(d.encoding, 'utf-8');
    assert.equal(d.source, 'probe');
  });
});

describe('decodeBody — 兜底与边界：任何输入都不中断采集', () => {
  it('含非法字节时宽松解码，可读部分保留、不抛错', () => {
    const d = decodeBody(Buffer.from([0x61, 0xff, 0x62]), undefined);
    assert.equal(typeof d.text, 'string');
    assert.equal(d.text.includes('a'), true);
    assert.equal(d.text.includes('b'), true);
  });

  it('空字节流安全返回空串', () => {
    const d = decodeBody(Buffer.alloc(0), undefined);
    assert.equal(d.text, '');
    assert.equal(d.replacements, 0);
  });

  it('单字节输入不崩', () => {
    const d = decodeBody(Buffer.from([0x3c]), undefined);
    assert.equal(d.text, '<');
  });

  it('字符串输入原样透传（调用方已自行解码的场景）', () => {
    const d = decodeBody('中文', undefined);
    assert.equal(d.text, '中文');
    assert.equal(d.encoding, 'passthrough');
  });

  it('null / undefined 输入不崩', () => {
    assert.equal(decodeBody(null, undefined).text, '');
    assert.equal(decodeBody(undefined, undefined).text, '');
  });
});

describe('countReplacements — 度量口径', () => {
  it('统计准确', () => {
    assert.equal(countReplacements(''), 0);
    assert.equal(countReplacements('abc'), 0);
    assert.equal(countReplacements('a\uFFFDb'), 1);
    assert.equal(countReplacements('\uFFFD\uFFFD\uFFFD'), 3);
    assert.equal(countReplacements(undefined), 0);
    assert.equal(countReplacements(null), 0);
  });

  it('可读的合法中文不计入', () => {
    assert.equal(countReplacements('通用财务账模板'), 0);
  });
});
