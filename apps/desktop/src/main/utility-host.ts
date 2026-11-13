import { utilityProcess, type UtilityProcess } from 'electron'
import { asUtilityMessage, parseChildArgv } from './utility-protocol.js'
import type {
  UtilityIpcInvoke,
  UtilityMessage,
} from './utility-protocol.js'

/**
 * utilityProcess 宿主（parent 侧）：
 * fork 宿主辅助入口（utility-host-entry），加载外部包 main 于独立进程；
 * parent ↔ child 全部消息经 MessagePort 序列化，无 Node 集成。
 * 安全边界：child 能注册的 channel 由 manifest ipcAllowlist 决定（loadToolPlugins 控），
 * host 能力转发按方法名白名单执行（forward 参数）。
 */

export interface UtilityInstance {
  toolId: string
  process: UtilityProcess
  /** 渲染层 channel → child 内 handler 的调用（reqId 配对） */
  call(channel: string, args: unknown[]): Promise<unknown>
  /** child 请求的 host 能力转发（如 llm/config），由宿主提供白名单实现 */
  kill(): void
}

export interface ForkOptions {
  /** 宿主辅助入口（构建产物 out/main/utility-host-entry.mjs） */
  entryPath: string
  toolId: string
  /** 已安装包目录与外部 main 文件（绝对路径） */
  packageDir: string
  mainFile: string
  /** host 能力白名单转发；不在白名单的方法一律拒绝 */
  forward: (method: string, args: unknown[]) => Promise<unknown>
  /** child 注册了新 channel（供主进程建转发 handler） */
  onRegister?: (channel: string) => void
}

export function forkUtilityTool(opts: ForkOptions): UtilityInstance {
  const child = utilityProcess.fork(
    opts.entryPath,
    [opts.toolId, opts.packageDir, opts.mainFile],
    { serviceName: `tool-${opts.toolId}`, stdio: 'inherit' },
  )
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()
  let reqId = 0

  child.on('message', (raw: unknown) => {
    const msg = asUtilityMessage(raw)
    if (!msg) return
    if (msg.t === 'ipc-result') {
      const p = pending.get(msg.reqId)
      if (!p) return
      pending.delete(msg.reqId)
      if (msg.ok) p.resolve(msg.data)
      else p.reject(new Error(msg.error ?? 'utility 调用失败'))
      return
    }
    if (msg.t === 'host-invoke') {
      void opts
        .forward(msg.method, msg.args)
        .then((data) => post(child, { t: 'host-result', reqId: msg.reqId, ok: true, data }))
        .catch((err: Error) => post(child, { t: 'host-result', reqId: msg.reqId, ok: false, error: err.message }))
      return
    }
    if (msg.t === 'register') opts.onRegister?.(msg.channel)
  })
  child.on('exit', () => {
    for (const [, p] of pending) p.reject(new Error(`工具 ${opts.toolId} 的沙箱进程已退出`))
    pending.clear()
  })

  function post(childProc: UtilityProcess, msg: UtilityMessage): void {
    childProc.postMessage(msg)
  }

  return {
    toolId: opts.toolId,
    process: child,
    kill: () => child.kill(),
    call(channel: string, args: unknown[]): Promise<unknown> {
      const id = ++reqId
      const invoke: UtilityIpcInvoke = { t: 'ipc-invoke', reqId: id, channel, args }
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject })
        child.postMessage(invoke)
      })
    },
  }
}

export { parseChildArgv }
