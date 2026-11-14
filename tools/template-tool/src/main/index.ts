import type { IpcMain } from 'electron'
import type { ToolHostCapabilities } from '@sshk/shared'

/**
 * 模板工具主进程入口（builtin 契约：默认导出 (ipcMain, deps) => void）。
 *
 * 这里集中演示「工具包可能拥有的全部 7 项宿主能力」：
 *   getToolSecret / setToolSecret / chat / listProviders /
 *   chatByProvider / listModelsByProvider / runLocalOcr
 * 每个能力都注册一个 IPC 通道，渲染层经 window.api.ipc.invoke 调用，
 * 主进程再把调用转发给宿主注入的 deps.host（密钥永不下发到渲染层）。
 *
 * 注意：builtin 工具与运行时外部包共用同一份逻辑，区别只在入口签名：
 *   builtin -> (ipcMain, deps)
 *   external -> (deps) 且 deps.ipcMain 内嵌
 * 下方默认导出兼容 builtin；external 版见 examples/template-tool/dist/main.js。
 *
 * 通道前缀一律用宿主注入的 deps.toolId（源自 manifest.id），不在源码里写死工具 id，
 * 保证「id 源唯一、便于维护」。
 */
export default function registerToolMain(
  ipcMain: IpcMain,
  deps: { toolId: string; repository?: unknown; outputRoot?: string; host: ToolHostCapabilities },
): void {
  const host = deps.host
  const ch = (name: string) => `${deps.toolId}:${name}`

  // 1) 列出应用级 Provider（只读元信息，绝不含密钥）
  ipcMain.handle(ch('listProviders'), () => host.listProviders())

  // 2) OpenAI 兼容 /chat/completions（支持 image_url 多模态），返回纯文本
  ipcMain.handle(ch('chat'), async (_event, req: Parameters<ToolHostCapabilities['chat']>[0]) =>
    host.chat(req),
  )

  // 3) 按 Provider id 调用模型（baseURL / 密钥由主进程注入）
  ipcMain.handle(ch('chatByProvider'), async (_event, req: Parameters<ToolHostCapabilities['chatByProvider']>[0]) =>
    host.chatByProvider(req),
  )

  // 4) 按 Provider id 真实查询 /models
  ipcMain.handle(ch('listModelsByProvider'), async (_event, providerId: string, apiKey?: string) =>
    host.listModelsByProvider(providerId, apiKey),
  )

  // 5) 写入工具专属密钥（落 safeStorage，明文永不下发）
  ipcMain.handle(ch('setSecret'), (_event, name: string, value: string) => {
    host.setToolSecret(deps.toolId, name, value)
    return true
  })

  // 6) 读取工具专属密钥
  ipcMain.handle(ch('getSecret'), (_event, name: string) => host.getToolSecret(deps.toolId, name))

  // 7) 本机 OCR（无 shell、带超时，stdout 作为识别文本返回）
  ipcMain.handle(ch('runOcr'), async (_event, req: Parameters<ToolHostCapabilities['runLocalOcr']>[0]) =>
    host.runLocalOcr(req),
  )
}
