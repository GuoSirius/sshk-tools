/**
 * 本地类型声明（IDE 无关的关键）。
 *
 * 原先用 `/// <reference types="vite/client" />` + tsconfig `types:["vite/client"]`，
 * 但这要求 TS 语言服务能解析到 `node_modules/vite/client.d.ts`：本仓库是 pnpm
 * workspace，vite 只装在 apps/desktop/node_modules，根目录没有。IDE 一旦把
 * apps/desktop/src/** 挂到「根项目 / 推断项目」，就会报
 * 「找不到 vite/client 的类型定义」「ImportMeta 上不存在属性 glob」——
 * 重载窗口也修不好，因为问题在解析基准，不在缓存。
 *
 * 这里改成仓库内自带的全局声明，并用相对路径三斜线引用硬绑定到使用它的文件：
 * 无论 IDE 选中哪个 tsconfig、甚至是推断项目，都能拿到类型，且不丢 Vite 真实行为。
 * 只声明本项目实际用到的 import.meta.glob，其余能力由 env.d.ts 的模块声明覆盖。
 */
interface ImportMetaEnv {
  readonly DEV: boolean
  readonly PROD: boolean
  readonly MODE: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
  glob<T = unknown>(
    pattern: string,
    options: { eager: true; import?: string; query?: string },
  ): Record<string, T>
  glob<T = unknown>(
    pattern: string,
    options?: { eager?: false; import?: string; query?: string },
  ): Record<string, () => Promise<T>>
}
