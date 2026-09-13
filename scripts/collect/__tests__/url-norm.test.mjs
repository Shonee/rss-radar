// scripts/collect/__tests__/url-norm.test.mjs
// ARCH §4.1 R1~R12 + §4.2 退化链 4 模式
import { describe, it, expect } from 'vitest';
import { normalizeUrl, titleFingerprint, buildDedupKey, TRACKING_PARAMS } from '../lib/url-norm.mjs';
import { buildId, deriveKeyAndId } from '../lib/dedup-key.mjs';

describe('url-norm / R1 去 fragment', () => {
  it('R1: 去除 #hash', () => {
    expect(normalizeUrl('https://example.com/p/1#section')).toBe('https://example.com/p/1');
    expect(normalizeUrl('https://example.com/p/1#')).toBe('https://example.com/p/1');
  });
});

describe('url-norm / R2 去追踪参数', () => {
  it('R2: utm_* 全家桶 + fbclid/gclid/igshid/mc_cid/mc_eid/yclid/_ga/_gl/_hsenc/_hsmi/spm/share_*/from/ref/weibo_id', () => {
    expect(normalizeUrl('https://example.com/p?a=1&utm_source=x&utm_medium=y')).toBe('https://example.com/p?a=1');
    expect(normalizeUrl('https://example.com/p?id=9&utm_campaign=x&fbclid=abc')).toBe('https://example.com/p?id=9');
    expect(normalizeUrl('https://example.com/p?gclid=A&igshid=B&mc_cid=C&mc_eid=D&yclid=E&_ga=F&_gl=G')).toBe('https://example.com/p');
    expect(normalizeUrl('https://example.com/p?spm=1&share_token=2&share_source=3&from=x&ref=y&weibo_id=z')).toBe('https://example.com/p');
  });
  it('R2: 大小写不敏感（UTM_SOURCE、UTM_source、utm_Source 都剥）', () => {
    expect(normalizeUrl('https://example.com/p?UTM_SOURCE=x&utm_source=y&Utm_Source=z')).toBe('https://example.com/p');
  });
  it('R2: 保留合法 query', () => {
    expect(normalizeUrl('https://example.com/p?id=9&page=2&q=rust')).toBe('https://example.com/p?id=9&page=2&q=rust');
  });
});

describe('url-norm / R3 大小写', () => {
  it('R3: protocol + host 转小写（path/query 保留）', () => {
    expect(normalizeUrl('HTTPS://Example.COM/Post/123')).toBe('https://example.com/Post/123');
  });
});

describe('url-norm / R4 去默认端口', () => {
  it('R4: http:80 / https:443 去除', () => {
    expect(normalizeUrl('http://example.com:80/p')).toBe('http://example.com/p');
    expect(normalizeUrl('https://example.com:443/p')).toBe('https://example.com/p');
  });
  it('R4: 非默认端口保留', () => {
    expect(normalizeUrl('http://example.com:8080/p')).toBe('http://example.com:8080/p');
  });
});

describe('url-norm / R5/R6/R8/R9 路径处理', () => {
  it('R5: 去尾斜杠（path 长度 > 1）', () => {
    expect(normalizeUrl('https://example.com/a/b/')).toBe('https://example.com/a/b');
    expect(normalizeUrl('https://example.com/')).toBe('https://example.com/'); // 单 / 保留
  });
  it('R6: 合并连续 //', () => {
    expect(normalizeUrl('https://example.com//path///to/')).toBe('https://example.com/path/to');
  });
  it('R8: 去结尾空 ?', () => {
    expect(normalizeUrl('https://example.com/p?')).toBe('https://example.com/p');
  });
  it('R9: 去结尾 index.html / .htm / .php', () => {
    expect(normalizeUrl('https://example.com/a/b/index.html')).toBe('https://example.com/a/b');
    expect(normalizeUrl('https://example.com/a/b/index.htm')).toBe('https://example.com/a/b');
    expect(normalizeUrl('https://example.com/a/b/index.php')).toBe('https://example.com/a/b');
  });
});

describe('url-norm / R7 query 排序', () => {
  it('R7: 按 key 字典序重组', () => {
    expect(normalizeUrl('https://example.com/x?b=2&a=1&c=3')).toBe('https://example.com/x?a=1&b=2&c=3');
  });
  it('R7+R2: 排序 + 去追踪参数', () => {
    expect(normalizeUrl('https://site.com/p?id=9&utm_campaign=x&fbclid=abc&a=1'))
      .toBe('https://site.com/p?a=1&id=9');
  });
});

describe('url-norm / R10 百分号编码', () => {
  it('R10: 解码非必要编码（如 %E4%B8%AD → 中）', () => {
    const url = 'https://example.com/post/%E4%B8%AD%E6%96%87';
    expect(normalizeUrl(url)).toBe('https://example.com/post/%E4%B8%AD%E6%96%87'); // 标准百分号编码保留
  });
});

describe('url-norm / R11/R12 开关', () => {
  it('R11/R12 默认关', () => {
    expect(normalizeUrl('http://www.example.com/p')).toBe('http://www.example.com/p');
  });
  it('R11 开 → http→https', () => {
    expect(normalizeUrl('http://example.com/p', { r11HttpToHttps: true })).toBe('https://example.com/p');
  });
  it('R12 开 → 去 www.', () => {
    expect(normalizeUrl('https://www.example.com/p', { r12StripWww: true })).toBe('https://example.com/p');
  });
});

describe('url-norm / ARCH §4.1 示例对照', () => {
  it('示例 1: utm + hash 一起剥', () => {
    expect(normalizeUrl('https://Example.com/Post/123/?utm_source=rss&utm_medium=feed#comments'))
      .toBe('https://example.com/Post/123');
  });
  it('示例 5: 合法 id 保留，utm + fbclid 剥', () => {
    expect(normalizeUrl('https://site.com/p?id=9&utm_campaign=x&fbclid=abc'))
      .toBe('https://site.com/p?id=9');
  });
});

describe('url-norm / 抗错', () => {
  it('非法 URL 原样返回', () => {
    expect(normalizeUrl('not a url')).toBe('not a url');
    expect(normalizeUrl('')).toBe('');
  });
});

describe('dedup-key / 4 模式退化链', () => {
  it('模式 1: URL 是 http(s) → url: 键', () => {
    const r = buildDedupKey({ url: 'https://example.com/p/1' }, {});
    expect(r.mode).toBe('url');
    expect(r.key.startsWith('url:')).toBe(true);
  });
  it('模式 2: guid 是 URL → guid-url: 键', () => {
    const r = buildDedupKey({ guid: 'https://example.com/g/2', url: 'javascript:void(0)' }, {});
    expect(r.mode).toBe('guid-url');
  });
  it('模式 3: guid 非 URL + sourceId → guid:sourceId:guid 键', () => {
    const r = buildDedupKey({ guid: 'tag:foo,2026:abc', sourceId: 'src-1', url: 'foo' }, {});
    expect(r.mode).toBe('guid-source');
    expect(r.key.startsWith('guid:')).toBe(true);
  });
  it('模式 4: 仅 title → title:title-fingerprint 键', () => {
    const r = buildDedupKey({ title: 'Hello, World!' }, {});
    expect(r.mode).toBe('title');
  });
  it('同一 URL 不同 utm → 同 key', () => {
    const a = buildDedupKey({ url: 'https://example.com/p/1?utm_source=x' }, {});
    const b = buildDedupKey({ url: 'https://example.com/p/1?utm_source=y&fbclid=zz' }, {});
    expect(a.key).toBe(b.key);
  });
  it('同 URL 大小写 host 不同 → 同 key', () => {
    const a = buildDedupKey({ url: 'https://Example.com/p/1' }, {});
    const b = buildDedupKey({ url: 'https://example.com/p/1' }, {});
    expect(a.key).toBe(b.key);
  });
});

describe('dedup-key / id 稳定', () => {
  it('id = it_<sha256(dedupKey).slice(0,12)>', () => {
    const { id, key } = deriveKeyAndId({ url: 'https://example.com/p/1' });
    expect(id).toMatch(/^it_[0-9a-f]{12}$/);
    expect(id).toBe('it_' + key.replace(/^[^:]+:/, '').slice(0, 12)); // sha256hex 是 64 hex
  });
  it('同 URL 重复调 → 同 id', () => {
    const a = deriveKeyAndId({ url: 'https://example.com/p/1' });
    const b = deriveKeyAndId({ url: 'https://example.com/p/1?utm_source=x' });
    expect(a.id).toBe(b.id);
  });
});

describe('titleFingerprint', () => {
  it('NFKC + 大小写折叠 + 去标点', () => {
    expect(titleFingerprint('Hello, World!')).toBe('hello world');
    expect(titleFingerprint('  A　B  C  ')).toBe('a b c'); // 全角空格 → 单空格
    expect(titleFingerprint('ＡＢＣ')).toBe('abc'); // 全角 → 半角
  });
});