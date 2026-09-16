#!/usr/bin/env node
// scripts/diagnose-charset.mjs
// 全量探测源站响应编码，找出所有非 UTF-8 源与上游脏数据。
//
// 为什么需要它
// ------------
// 2026-09-16 发现 52pojie（Discuz 论坛，GBK）整源乱码 —— 这类问题**只在抓取时才
// 暴露**，且加新源时随时可能复发。本脚本用「只读前 2KB 即断开」的轻量方式扫描全部
// 启用源，输出每源的『HTTP 声明 / 内容内声明 / 实际判定 / 残留替换字符』，让编码
// 问题在**进入采集链路之前**就被看见。
//
// 它同时能区分两类问题（这正是 52pojie 与 36kr 的差别）：
//   · 判定编码 ≠ utf-8        ⇒ 我们的解码路径与默认不同（可修）
//   · 判定为 utf-8 但含坏字   ⇒ 源站数据本身已损坏（不可修，只能告警）
//
// 用法：
//   node scripts/diagnose-charset.mjs                 # 全量探测
//   node scripts/diagnose-charset.mjs --only 52pojie  # 只测匹配的源
//   node scripts/diagnose-charset.mjs --json          # 机器可读输出
//   node scripts/diagnose-charset.mjs --concurrency 8 # 调整并发（默认 6）
//
// 注意：本脚本**只读不写** config/sources.json，也不会触发健康检查回写。

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { decodeBody, sniffCharset, countReplacements } from './collect/lib/charset.mjs';
import { DEFAULT_UA } from './collect/lib/http.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const CONFIG = join(ROOT, 'config/sources.json');

/** 只读这么多字节就够判定编码（XML 声明区 + 若干正文） */
const SNIFF_BYTES = 2048;
const DEFAULT_TIMEOUT_MS = 12000;

function parseArgs(argv) {
  const out = { only: null, json: false, concurrency: 6, timeoutMs: DEFAULT_TIMEOUT_MS, snapshot: null };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--json') out.json = true;
    else if (a === '--only') out.only = argv[++i] ?? null;
    else if (a === '--snapshot') out.snapshot = argv[++i] ?? null;
    else if (a === '--concurrency') out.concurrency = Number(argv[++i]) || 6;
    else if (a === '--timeout') out.timeoutMs = Number(argv[++i]) || DEFAULT_TIMEOUT_MS;
    else if (a === '--help' || a === '-h') {
      console.log(
        [
          '用法:',
          '  node scripts/diagnose-charset.mjs                      全量探测启用源的响应编码',
          '  node scripts/diagnose-charset.mjs --only 52pojie       只测匹配的源',
          '  node scripts/diagnose-charset.mjs --json               机器可读输出',
          '  node scripts/diagnose-charset.mjs --concurrency 8      并发数（默认 6）',
          '  node scripts/diagnose-charset.mjs --snapshot <file>    改为扫描已产出快照里的坏字',
        ].join('\n'),
      );
      process.exit(0);
    }
  }
  return out;
}

/**
 * 扫描已产出的快照文件，找出「文本里含 U+FFFD」的条目。
 *
 * 与在线探测互补：在线探测只看响应头部 2KB（够判编码），而坏字可能出现在正文任何
 * 位置；且源头自带坏字（36kr 实测：源站原始字节即含）只能在完整数据里看见。
 * 这类坏字**无法通过解码修复**（一个汉字变 3 个 U+FFFD 属信息已丢失），本脚本只做
 * 暴露，不做美化 —— 掩盖它比显示它更糟。
 */
function scanSnapshot(file) {
  const snap = JSON.parse(readFileSync(file, 'utf8'));
  const items = Array.isArray(snap.items) ? snap.items : [];
  const byChannel = new Map();
  for (const it of items) {
    let n = 0;
    for (const k of ['title', 'summary', 'author']) {
      if (typeof it[k] === 'string') n += countReplacements(it[k]);
    }
    if (n === 0) continue;
    const key = it.channelId ?? '(unknown)';
    const e = byChannel.get(key) ?? { items: 0, chars: 0 };
    e.items += 1;
    e.chars += n;
    byChannel.set(key, e);
  }

  console.log(`===== 快照坏字扫描：${file} =====`);
  console.log(`  生成时间: ${snap.generatedAt ?? '-'}   条目数: ${items.length}`);
  if (byChannel.size === 0) {
    console.log('\n  ✓ 未发现含替换字符（U+FFFD）的条目');
    return 0;
  }
  console.log(`\n  含坏字的渠道共 ${byChannel.size} 个（按坏字字符数降序）：`);
  const rows = [...byChannel.entries()].sort((a, b) => b[1].chars - a[1].chars);
  for (const [ch, e] of rows) {
    console.log(`    ${ch.padEnd(28)} 条目=${String(e.items).padStart(4)}  坏字=${String(e.chars).padStart(5)}`);
  }
  console.log('\n  如何区分两类坏字（重要）：');
  console.log('    · 先跑一次在线探测（不带 --snapshot）：若该渠道判定编码非 utf-8，');
  console.log('      说明坏字来自**解码**——修好解码后重采即恢复（52pojie 属此类，已修）。');
  console.log('    · 若判定为 utf-8 却仍有坏字，则坏字来自**源站自身**，原文已丢失，');
  console.log('      无法恢复（36kr 属此类）。');
  console.log('    本项目刻意不做美化清洗 —— 掩盖坏字比显示它更糟。');
  return rows.length;
}

/**
 * 轻量探测：读前 SNIFF_BYTES 字节即主动断流。
 * 刻意不复用 fetchText —— 那是采集路径（全量下载 + 重试 + 条件请求），
 * 诊断场景要的是「少量字节 + 快」，不能给源站造成与采集同等压力。
 */
async function probe(source, timeoutMs) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(source.url, {
      headers: {
        'User-Agent': DEFAULT_UA,
        Accept: 'application/rss+xml, application/atom+xml, application/feed+json, application/json, text/xml, */*;q=0.5',
      },
      signal: ac.signal,
      redirect: 'follow',
    });
    const contentType = res.headers.get('content-type') ?? '';

    let buf = Buffer.alloc(0);
    if (res.body) {
      const reader = res.body.getReader();
      try {
        while (buf.length < SNIFF_BYTES) {
          const { done, value } = await reader.read();
          if (done) break;
          buf = Buffer.concat([buf, Buffer.from(value)]);
        }
      } finally {
        try {
          await reader.cancel();
        } catch {
          // 断流失败无所谓，定时器会兜底
        }
      }
    }

    const declared = sniffCharset(buf, contentType);
    const decoded = decodeBody(buf, contentType);
    return {
      ok: res.ok,
      status: res.status,
      contentType,
      bytesRead: buf.length,
      declared: declared ? `${declared.encoding}@${declared.source}` : null,
      encoding: decoded.encoding,
      encodingSource: decoded.source,
      replacements: decoded.replacements,
      error: null,
    };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      contentType: '',
      bytesRead: 0,
      declared: null,
      encoding: null,
      encodingSource: null,
      replacements: 0,
      error: err && err.name === 'AbortError' ? `timeout>${timeoutMs}ms` : String((err && err.message) || err),
    };
  } finally {
    clearTimeout(timer);
  }
}

/** 固定并发的工作池 */
async function runPool(items, limit, fn) {
  const results = new Array(items.length);
  let cursor = 0;
  const size = Math.max(1, Math.min(limit, items.length));
  await Promise.all(
    Array.from({ length: size }, async () => {
      for (;;) {
        const idx = cursor;
        cursor += 1;
        if (idx >= items.length) return;
        results[idx] = await fn(items[idx], idx);
      }
    }),
  );
  return results;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  // --snapshot 模式：离线扫描已产出快照，不触网
  if (args.snapshot) {
    process.exitCode = scanSnapshot(args.snapshot) > 0 ? 1 : 0;
    return;
  }

  const cfg = JSON.parse(readFileSync(CONFIG, 'utf8'));
  const all = (cfg.sources ?? []).filter((s) => s.enabled !== false && s.url);

  // 按 URL 去重：同一 feed 被多源引用时只探一次，避免重复请求同一渠道
  const seen = new Set();
  const targets = [];
  for (const s of all) {
    if (args.only && !s.id.includes(args.only) && !(s.channelId ?? '').includes(args.only)) continue;
    if (seen.has(s.url)) continue;
    seen.add(s.url);
    targets.push(s);
  }

  if (!args.json) {
    console.log(`===== 编码探测：${targets.length} 个启用源（按 URL 去重，原 ${all.length} 条）=====`);
    console.log(`只读前 ${SNIFF_BYTES} 字节即断开，不改动 config，不触发健康检查\n`);
  }

  const rows = await runPool(targets, args.concurrency, async (s, i) => {
    const r = await probe(s, args.timeoutMs);
    if (!args.json) {
      const mark = r.error ? 'ERR ' : r.ok ? 'ok  ' : `HTTP${r.status}`;
      const flag =
        r.encoding && r.encoding !== 'utf-8' ? '  << 非 UTF-8' : r.replacements > 0 ? '  << 含坏字' : '';
      const line =
        `[${String(i + 1).padStart(3)}/${targets.length}] ${mark.padEnd(5)} ` +
        `${(s.id || '').padEnd(28)} ` +
        `声明=${String(r.declared ?? '-').padEnd(16)} ` +
        `判定=${String(r.encoding ?? '-').padEnd(10)}@${String(r.encodingSource ?? '-').padEnd(14)} ` +
        `坏字=${String(r.replacements).padStart(3)}${flag}`;
      console.log(line);
    }
    return { id: s.id, channelId: s.channelId, type: s.type, url: s.url, ...r };
  });

  if (args.json) {
    console.log(JSON.stringify(rows, null, 2));
    return;
  }

  const nonUtf8 = rows.filter((r) => !r.error && r.encoding && r.encoding !== 'utf-8');
  const dirty = rows.filter((r) => !r.error && r.replacements > 0);
  const failed = rows.filter((r) => r.error || !r.ok);

  console.log('\n===== 汇总 =====');
  console.log(`  总计        : ${rows.length}`);
  console.log(`  非 UTF-8    : ${nonUtf8.length}${nonUtf8.length ? '  ← 解码路径与默认不同（我们可控）' : ''}`);
  console.log(`  含替换字符  : ${dirty.length}${dirty.length ? '  ← 源站数据已损坏（我们不可修，只告警）' : ''}`);
  console.log(`  探测失败    : ${failed.length}`);

  if (nonUtf8.length) {
    console.log('\n--- 非 UTF-8 源明细 ---');
    for (const r of nonUtf8) {
      console.log(`  ${(r.id || '').padEnd(30)} 判定=${r.encoding}(${r.encodingSource})  声明=${r.declared ?? '-'}  ct=${r.contentType}`);
    }
  }
  if (dirty.length) {
    console.log('\n--- 上游含替换字符明细 ---');
    for (const r of dirty) {
      console.log(`  ${(r.id || '').padEnd(30)} 坏字=${r.replacements}  判定=${r.encoding}(${r.encodingSource})`);
    }
  }
  if (failed.length) {
    console.log('\n--- 探测失败明细 ---');
    for (const r of failed) {
      console.log(`  ${(r.id || '').padEnd(30)} ${r.error || `HTTP ${r.status}`}`);
    }
  }

  // 非 UTF-8 或数据损坏都算「需要人看一眼」，据此给退出码
  process.exitCode = nonUtf8.length || dirty.length ? 1 : 0;
}

main().catch((err) => {
  console.error('diagnose-charset 失败:', err);
  process.exitCode = 2;
});
