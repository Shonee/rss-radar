// connectors/index.mjs — 显式注册 3 个首批连接器
import { register } from './registry.mjs';
import * as feed from './feed.mjs';
import * as localJson from './local-json.mjs';
import * as localCsv from './local-csv.mjs';

// 三合一 feed
register('rss', feed);
register('atom', feed);
register('json_feed', feed);

register('local_json', localJson);
register('local_csv', localCsv);

export { register } from './registry.mjs';