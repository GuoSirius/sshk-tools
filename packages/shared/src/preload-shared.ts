/**
 * preload 构建的 @sshk/shared 别名目标（electron.vite.config preloadAlias）：
 * index.ts 会级联引入 time.ts 的 dayjs，preload 产物要求零外部依赖；
 * 这里只聚合 preload 需要的纯常量与纯函数，单一真相源仍是各模块本身。
 */
export * from './ipc'
export { isIpcResult } from './ipc-result'
