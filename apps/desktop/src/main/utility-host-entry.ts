/**
 * utilityProcess 子进程入口（沙箱内的外部包加载器）：
 * - argv 末三位：toolId、包目录、外部 main 文件
 * - 动态 import 外部 main（编译后 ESM），调用 default/register(deps)
 * - deps.ipcMain 为伪对象：handle/channel 注册回传宿主，渲染层调用经宿主转发进来
 * - deps.host 为代理：所有能力调用经宿主白名单转发（capability 由宿主裁决）
 */

import { pathToFileURL } from 'node:url'
import { asUtilityMessage, parseChildArgv } from './utility-protocol.js'

const { toolId, packageDir, mainFile } = parseChildArgv(process.argv)

type Handler = (payload: unknown) => unknown | Promise<unknown>
const handlers = new Map<string, Handler>()

const pseudoIpcMain = {
  handle: (channel: string, handler: Handler) => {
    handlers.set(channel, handler)
    process.parentPort.postMessage({ t: 'register', channel })
  },
  on: () => pseudoIpcMain,
  once: () => pseudoIpcMain,
  removeAllListeners: () => pseudoIpcMain,
  handleOnce: (channel: string, handler: Handler) => {
    handlers.set(channel, async (payload: unknown) => {
      handlers.delete(channel)
      return handler(payload)
    })
    process.parentPort.postMessage({ t: 'register', channel })
  },
}

const pendingHost = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()
let hostReqId = 0
const hostProxy = new Proxy({}, {
  get(_target, method: string) {
    return async (...args: unknown[]) => {
      const reqId = ++hostReqId
      return new Promise((resolve, reject) => {
        pendingHost.set(reqId, { resolve, reject })
        process.parentPort.postMessage({ t: 'host-invoke', reqId, method, args })
      })
    }
  },
})

process.parentPort.on('message', async (e: { data: unknown }) => {
  const msg = asUtilityMessage(e.data)
  if (!msg) return
  if (msg.t === 'ipc-invoke') {
    const handler = handlers.get(msg.channel)
    if (!handler) {
      process.parentPort.postMessage({ t: 'ipc-result', reqId: msg.reqId, ok: false, error: `未注册的通道 ${msg.channel}` })
      return
    }
    try {
      const data = await handler(msg.args[0])
      process.parentPort.postMessage({ t: 'ipc-result', reqId: msg.reqId, ok: true, data })
    } catch (err) {
      process.parentPort.postMessage({ t: 'ipc-result', reqId: msg.reqId, ok: false, error: (err as Error).message })
    }
    return
  }
  if (msg.t === 'host-result') {
    const p = pendingHost.get(msg.reqId)
    if (!p) return
    pendingHost.delete(msg.reqId)
    if (msg.ok) p.resolve(msg.data)
    else p.reject(new Error(msg.error ?? '宿主能力调用失败'))
  }
})

void (async () => {
  const url = pathToFileURL(mainFile).href
  const mod = (await import(url)) as Record<string, unknown>
  const candidate = mod['default'] ?? mod['register']
  if (typeof candidate !== 'function') {
    throw new Error(`外部 main 入口 ${mainFile} 未默认导出注册函数`)
  }
  ;(candidate as (deps: unknown) => void)({
    toolId,
    packageDir,
    ipcMain: pseudoIpcMain,
    outputRoot: '',
    host: hostProxy,
  })
  process.parentPort.postMessage({ t: 'ready' })
})().catch((err: Error) => {
  process.parentPort.postMessage({ t: 'ipc-result', reqId: -1, ok: false, error: `沙箱加载失败：${err.message}` })
})
