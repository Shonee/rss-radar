// scripts/collect/connectors/index.mjs
// 显式注册所有连接器（T-P2-07 7 个 type + P1 2 个 local_*）
// 顺序无关；register() 拒绝重名
import { register } from './registry.mjs';

// 三合一 feed 已拆分为独立 connector（T-P2-07）
// 自注册：feed-rss / feed-atom / feed-json 模块顶部
import './feed-rss.mjs';
import './feed-atom.mjs';
import './feed-json.mjs';

// 本地文件（保留）
import * as localJson from './local-json.mjs';
import * as localCsv from './local-csv.mjs';
import './feishu-bitable.mjs';
import './notion-db.mjs';
import './generic-api.mjs';

register('local_json', localJson);
register('local_csv', localCsv);

export { register } from './registry.mjs';
