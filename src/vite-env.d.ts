/// <reference types="vite/client" />

// T-P3-01 前端基础设施 — Vite 环境变量类型声明
// 允许 src/config/site.ts 读取 import.meta.env（默认指向本仓库的 fork）
interface ImportMetaEnv {
  readonly VITE_DATA_OWNER?: string;
  readonly VITE_DATA_REPO?: string;
  readonly DEV: boolean;
  readonly PROD: boolean;
  readonly MODE: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
