// scripts/collect/connectors/feed-base.mjs
// 三种 feed 共享的解析逻辑：rss-parser + 统一 item 映射
// 由 feed-rss / feed-atom / feed-json 三个独立 connector 调用
// rss-parser 通过 dynamic import 注入，沙箱无 npm install 时不会阻断 connector 注册

let _parserPromise = null;
async function getParser() {
  if (!_parserPromise) {
    _parserPromise = import('rss-parser').then((mod) => {
      const Parser = mod.default || mod;
      return new Parser({
        timeout: 15000,
        customFields: {
          feed: ['language'],
          item: [
            ['author', 'author'],
            ['content:encoded', 'contentEncoded'],
            ['dc:creator', 'creator'],
          ],
        },
        headers: {
          'User-Agent': 'rss-radar-bot/1.0 (+https://github.com/<owner>/rss-radar)',
        },
      });
    });
  }
  return _parserPromise;
}

/** 解析 RSS 2.0 / RDF XML */
export async function parseRssXml(body) {
  const parser = await getParser();
  return parser.parseString(body);
}

/** 解析 Atom XML（共用 rss-parser，本质相同解析路径） */
export async function parseAtomXml(body) {
  const parser = await getParser();
  return parser.parseString(body);
}

/** 解析 JSON Feed (feed.json.org v1.1) —— 内置实现，不依赖 rss-parser */
export function parseJsonFeed(body) {
  const obj = JSON.parse(body);
  if (!obj || !Array.isArray(obj.items)) {
    throw new Error('JSON Feed 缺少 items[] 字段');
  }
  return {
    title: obj.title || '(untitled)',
    language: obj.language,
    items: obj.items.map((it) => ({
      title: it.title || it.summary || '(untitled)',
      link: it.url || it.external_url || '',
      guid: it.id || it.url || '',
      pubDate: it.date_published || it.date_modified,
      isoDate: it.date_published || it.date_modified,
      contentSnippet: it.summary,
      content: it.content_html || it.content_text || '',
      author: it.author || (it.authors && it.authors[0] && it.authors[0].name),
      creator: it.author,
    })),
  };
}

/** 把 rss-parser Item 映射到内部 raw 字段 */
export function mapRssItem(it, fallbackLang) {
  // author 可能是字符串也可能是 {name} 对象（JSON Feed / 部分 Atom）
  let author = it.creator || it.author;
  if (author && typeof author === 'object') {
    author = author.name ?? author['#text'] ?? undefined;
  }
  return {
    title: it.title || '(untitled)',
    url: it.link || it.guid || '',
    guid: it.guid || it.link || '',
    summary: it.contentSnippet || stripHtmlShort(it.content),
    author,
    publishedAt: it.pubDate || it.isoDate,
    updatedAt: it.pubDate || it.isoDate,
    language: fallbackLang,
  };
}

function stripHtmlShort(html) {
  if (!html) return '';
  return String(html).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300);
}
