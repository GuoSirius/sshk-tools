/**
 * H2 宿主能力零裸调：工具渲染层的统一安全宿主代理。
 *
 * 用法（各工具 renderer 建 host.ts）：
 *   export const host = createSafeHost({
 *     config: { get: IPC_CHANNELS.configGet, set: IPC_CHANNELS.configSet },
 *     badge: { readHtml: IPC_CHANNELS.badgeReadHtml, ... },
 *   })
 *   await host.badge.readHtml({ path })   // 与 window.api.badge.readHtml 同形
 *
 * 行为分层（复用 callHostApi 三层策略）：
 *   1) 登记了通道：具名方法存在 → 直调；缺失 → 通用 ipc.invoke(channel) 兜底；
 *   2) 未登记通道（事件订阅类，如 upload.onProgress / llm.onDelta）：具名方法直通——
 *      这类是 ipcRenderer.on 包装，无 invoke 语义，preload 快照里稳定存在；
 *   3) 全部不可用：抛 HOST_API_STALE_HINT 可操作提示，不裸抛 TypeError。
 */
import { IPC_CHANNELS } from '@sshk/shared'
import { callHostApi, HOST_API_STALE_HINT } from './host-api'

export interface SafeHostChannelMap {
  [group: string]: { [method: string]: string }
}

type AnyFn = (...args: unknown[]) => any

function apiBag(): Record<string, Record<string, unknown> | undefined> {
  return (globalThis as unknown as { api?: Record<string, Record<string, unknown>> }).api ?? {}
}

/** J-07（2026-11-22 复核）：config get/set 在 4 份 host.ts 逐字重复 → createSafeHost 内置默认映射；
 *  各工具 host.ts 显式传入的 config 段仍可覆盖默认 */
const DEFAULT_CONFIG_HOST = { get: IPC_CHANNELS.configGet, set: IPC_CHANNELS.configSet }

export function createSafeHost(map: SafeHostChannelMap): any {
  const merged: SafeHostChannelMap = { config: DEFAULT_CONFIG_HOST, ...map }
  // 返回 any：Proxy 双层树在 noUncheckedIndexedAccess 下无法用索引签名表达「必存在」，
  // 且方法集随各工具 host.ts 的通道映射静态确定，调用形态由调用方 TS 按需断言（与裸调 window.api 同形）。
  const cache = new Map<string, AnyFn>()
  const root = new Proxy(Object.create(null), {
    get(_t, group: string | symbol) {
      if (typeof group !== 'string') return undefined
      return new Proxy(Object.create(null), {
        get(_t2, method: string | symbol) {
          if (typeof method !== 'string') return undefined
          const key = `${group}.${method}`
          let fn = cache.get(key)
          if (!fn) {
            fn = (...args: unknown[]) => {
              const channel = merged[group]?.[method]
              if (channel) return callHostApi({ group, method, channel, label: key }, ...args)
              const named = apiBag()[group]?.[method]
              if (typeof named === 'function') return named(...args)
              return Promise.reject(new Error(`宿主能力 ${key} 不可用。${HOST_API_STALE_HINT}`))
            }
            cache.set(key, fn)
          }
          return fn
        },
      })
    },
  })
  return root
}
