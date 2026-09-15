#!/usr/bin/env bash
# =============================================================================
# RSS Radar · T-P5-02 回归测试一键脚本
# -----------------------------------------------------------------------------
# 流程：npm run build → 起 vite preview（自动选空闲端口，避免 strictPort 占用）
#       → 等就绪 → 跑 snapshot-harness.mjs → 关服务 → 透传退出码
#
# 用法：
#   bash tests/regression/run.sh
#   CHROME_PATH=/path/to/chrome bash tests/regression/run.sh
#   BASE_URL=https://xxx.pages.dev bash tests/regression/run.sh   # 跳过 build/preview，直连远程
# =============================================================================
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
cd "$ROOT"

# 若显式给定 BASE_URL，则跳过 build/preview，直接对远程站点跑（CI 在 CF Pages 上跑回归时用）
if [[ -n "${BASE_URL:-}" ]]; then
  echo "==> 直连 BASE_URL=$BASE_URL（跳过 build/preview）"
  ARGS=(--base-url "$BASE_URL")
  [[ -n "${CHROME_PATH:-}" ]] && ARGS+=(--chrome-path "$CHROME_PATH")
  node tests/regression/snapshot-harness.mjs "${ARGS[@]}"
  exit $?
fi

# 1) 构建
echo "==> npm run build"
npm run build
BUILD_CODE=$?
if [[ $BUILD_CODE -ne 0 ]]; then
  echo "✗ build 失败（exit=$BUILD_CODE），中止" >&2
  exit $BUILD_CODE
fi

# 2) 选一个空闲端口（vite preview strictPort 对占用端口会直接失败）
PORT="$(node -e "const net=require('net');const s=net.createServer();s.listen(0,()=>{const p=s.address().port;s.close(()=>console.log(p))})")"
BASE_URL="http://127.0.0.1:${PORT}"
echo "==> vite preview on $BASE_URL"

npx vite preview --port "$PORT" --strictPort >/tmp/rr-preview.log 2>&1 &
PREVIEW_PID=$!

# 3) 等就绪：轮询根路径直到返回 200（最多 30s）
READY=0
for i in $(seq 1 60); do
  if node -e "fetch('${BASE_URL}/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" 2>/dev/null; then
    READY=1
    break
  fi
  sleep 0.5
done
if [[ $READY -ne 1 ]]; then
  echo "✗ preview 未在 30s 内就绪，日志如下：" >&2
  tail -20 /tmp/rr-preview.log >&2
  kill "$PREVIEW_PID" 2>/dev/null || true
  wait "$PREVIEW_PID" 2>/dev/null || true
  exit 2
fi

# 4) 跑回归 harness
ARGS=(--base-url "$BASE_URL")
[[ -n "${CHROME_PATH:-}" ]] && ARGS+=(--chrome-path "$CHROME_PATH")
node tests/regression/snapshot-harness.mjs "${ARGS[@]}"
HARNESS_CODE=$?

# 5) 清理 preview 服务（返回码优先透传 harness 的结果）
kill "$PREVIEW_PID" 2>/dev/null || true
wait "$PREVIEW_PID" 2>/dev/null || true

exit $HARNESS_CODE
