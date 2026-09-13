#!/usr/bin/env bash
# scripts/smoke/run.sh — collect → validate → contract 三步
# 用法：bash scripts/smoke/run.sh
set -e

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

echo "=== [smoke 1/3] collect:once ==="
node scripts/collect/index.mjs --once

echo ""
echo "=== [smoke 2/3] validate schema ==="
node scripts/validate-schema.mjs --config

echo ""
echo "=== [smoke 3/3] contract ==="
node scripts/smoke/snapshot-contract.mjs

echo ""
echo "🎉 smoke 全绿"