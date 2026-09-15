// scripts/__tests__/deploy-paths.test.mjs
//
// 契约锁：指针路径（pointerPath）在三处必须保持一致。
//
// 背景（见任务说明）：前端 src/services/dataClient.ts 用三层降级读数据，第一层是
// raw.githubusercontent.com/<owner>/<repo>/<dataBranch>/<pointerPath>。config 里
// pointerPath 约定在 today/ 子目录（config/site-config.json 的 deploy.pointerPath
// = "today/latest.json"，ARCHITECTURE.md:829 与 dev bridge 软链也如此），但旧版
// collect.yml 曾把指针 cp 到分支根目录（./latest.json），导致前端请求
// deploy/today/latest.json 必然 404。本测试把这条契约钉死，任何一处漂移都直接失败。
//
// 只锁三处，不碰 scripts/collect/write.mjs（那是软链路径，语义不同，容易写成脆断言）。
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..', '..');

const SITE_CONFIG = resolve(repoRoot, 'config', 'site-config.json');
const COLLECT_YML = resolve(repoRoot, '.github', 'workflows', 'collect.yml');
const MIRROR_YML = resolve(repoRoot, '.github', 'workflows', 'mirror-data.yml');

describe('deploy pointer path 契约锁', () => {
  test('config/site-config.json 的 deploy.pointerPath === "today/latest.json"', () => {
    assert.ok(existsSync(SITE_CONFIG), `缺少 ${SITE_CONFIG}`);
    const cfg = JSON.parse(readFileSync(SITE_CONFIG, 'utf8'));
    assert.equal(
      cfg?.deploy?.pointerPath,
      'today/latest.json',
      `deploy.pointerPath 应为 "today/latest.json"，实际为 ${JSON.stringify(cfg?.deploy?.pointerPath)}`,
    );
  });

  test('collect.yml 发布指针的 cp 目标 === "./" + pointerPath（本次 bug 锁）', () => {
    assert.ok(existsSync(COLLECT_YML), `缺少 ${COLLECT_YML}`);
    const yml = readFileSync(COLLECT_YML, 'utf8');

    const cfg = JSON.parse(readFileSync(SITE_CONFIG, 'utf8'));
    const pointerPath = cfg?.deploy?.pointerPath;
    assert.equal(pointerPath, 'today/latest.json', '前置：pointerPath 必须仍是 today/latest.json');
    const expectedDst = './' + pointerPath;

    // 抓取发布指针的那条 cp：源是 /tmp/deploy-data/latest.json，目标是某路径。
    // 注意排除 `cp -R ...`（写入 today/ stats/ history/ 的那几条），它们源不是 latest.json。
    const re = /cp\s+\/tmp\/deploy-data\/latest\.json\s+(\S+)/;
    const m = re.exec(yml);
    assert.ok(
      m,
      'collect.yml 中未找到发布指针的 `cp /tmp/deploy-data/latest.json <dst>` 行；' +
        '本次修复要求指针落在 today/ 子目录，请检查 Publish 步骤是否遗漏该 cp。',
    );

    const dst = m[1].replace(/\s+$/, '');
    assert.equal(
      dst,
      expectedDst,
      `指针 cp 的目标路径应为 "${expectedDst}"（指针需放在 today/ 子目录），实际为 "${dst}"`,
    );
  });

  test('mirror-data.yml 存在且 push refspec 指向 deploy 分支', () => {
    assert.ok(existsSync(MIRROR_YML), `缺少 ${MIRROR_YML}（新增的镜像工作流）`);
    const yml = readFileSync(MIRROR_YML, 'utf8');

    // 推送命令形如 `git push --force public HEAD:deploy`，refspec 右侧必须是 deploy 分支。
    const re = /git push\b[^\n]*\b\w+:deploy\b/;
    assert.ok(
      re.test(yml),
      'mirror-data.yml 中应存在 `git push ... <src>:deploy` 的 refspec，并指向 deploy 分支',
    );
  });
});
