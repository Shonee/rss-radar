// vitest.config.mjs — P3 前端单测配置
//
// 只收集 src/**/__tests__/**/*.test.ts（TS + vitest API）。
// scripts/**/*.test.mjs 是 node:test 语法，由 `npm run test:node` 负责，不在此收集。
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/__tests__/**/*.test.ts'],
    environment: 'node',
    testTimeout: 10000,
  },
});
