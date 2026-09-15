#!/usr/bin/env bash
# scripts/smoke/run.sh — collect → validate → contract 三步
# 用法：bash scripts/smoke/run.sh
#
# ⚠️ 为什么跑完要还原（血泪教训，见 docs/VERIFICATION.md §2）
#   第 1 步的 collect 会**回写被 git 跟踪的运行时状态**：
#     config/sources.json         ← lastStatus / lastFetchAt / lastError（URL 健康检查）+ JSON 重排
#     public/data/today/*.json    ← 本次采集快照（dev-bridge 同步）
#   验证产物不得留在工作区，否则 `git add -A` 会把运行时状态提交进 master（本仓库发生过）。
#   所以这里**先备份 → 结束时原样还原**，而不是 `git checkout --`——
#   后者会连你本地未提交的源改动一起抹掉。
#   想保留本次结果：SMOKE_KEEP_STATE=1 bash scripts/smoke/run.sh
set -e

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

# 会被 collect 回写的「被 git 跟踪」文件；未跟踪的 public/data/today/*.json 不在其列
TRACKED_STATE=(config/sources.json public/data/today/snapshot.json)
BK="$(mktemp -d "${TMPDIR:-/tmp}/rss-radar-smoke.XXXXXX")"
slot() { printf '%s' "$1" | tr '/' '_'; }

for f in "${TRACKED_STATE[@]}"; do
  [ -f "$f" ] && cp "$f" "$BK/$(slot "$f")"
done

restore_state() {
  local code=$?
  if [ -n "${SMOKE_KEEP_STATE:-}" ]; then
    echo ""
    echo "ℹ️  SMOKE_KEEP_STATE 已设置：保留本次采集回写（未还原被跟踪文件）"
  else
    local n=0
    for f in "${TRACKED_STATE[@]}"; do
      local b="$BK/$(slot "$f")"
      if [ -f "$b" ]; then
        cp "$b" "$f" && n=$((n + 1))
      fi
    done
    echo ""
    echo "🧹 已还原 $n 个被跟踪的运行时文件 —— 验证产物未留在工作区"
  fi
  rm -rf "$BK"
  exit "$code"
}
trap restore_state EXIT

OUT_DIR="${SMOKE_OUT_DIR:-tmp/deploy}"

echo "=== [smoke 1/3] collect:once ==="
set +e
node scripts/collect/index.mjs --once --out "$OUT_DIR"
COLLECT=$?
set -e
# collect 退出码语义（scripts/collect/main.mjs:187-189）：0=全部源成功 / 1=全部源失败 / 2=部分源失败。
# 「部分源失败」在本地或受限网络下属常态（反爬、被墙），不阻断——契约断言的目的是「产物自洽」。
# 但全失败（1）是真故障，必须阻断；否则后两步会在空产物上假绿。
if [ "$COLLECT" -eq 1 ]; then
  echo "❌ collect 全部源失败（exit 1），smoke 阻断"
  exit 1
elif [ "$COLLECT" -eq 2 ]; then
  echo "⚠️  collect 部分源失败（exit 2）—— 属预期内，继续校验产物自洽性"
fi

echo ""
echo "=== [smoke 2/3] validate schema ==="
node scripts/validate-schema.mjs --config

echo ""
echo "=== [smoke 3/3] contract ==="
# ⚠️ 必须显式指向本次采集产物：snapshot-contract.mjs 的默认路径是 tmp/today/，
#    与 collect 的默认输出 tmp/deploy/ 对不上，会静默回退去校验过期的 demo fixture（假绿）。
SNAP="$(ls -1 "$OUT_DIR"/today/snapshot-*.json 2>/dev/null | sort | tail -1 || true)"
if [ -z "$SNAP" ]; then
  echo "❌ 未在 $OUT_DIR/today/ 找到本次采集产物；拒绝回退到过期 fixture"
  exit 1
fi
echo "[smoke] 本次产物 = $SNAP"
node scripts/smoke/snapshot-contract.mjs --file "$SNAP"

echo ""
echo "🎉 smoke 全绿"
