// vitest.config.mjs — P1 测试配置
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['scripts/**/__tests__/**/*.test.mjs'],
    environment: 'node',
    testTimeout: 10000,
  },
});