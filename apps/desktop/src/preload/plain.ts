/**
 * IPC 结构化克隆边界（宿主能力，工具无需各自 toRaw）。
 * P0-8（B7/N3）：实现唯一核心在 plain/plain-core.ts（keepFunctions 参数化），
 * 本文件是 preload 侧薄封装——IPC 入参是纯数据语义，函数 / symbol / undefined 丢弃。
 */
import { toPlainCore } from '../plain/plain-core'

export function toPlain<T>(value: T): T {
  return toPlainCore(value)
}
