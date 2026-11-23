import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import { AppError } from '@sshk/shared'
import { seedSystemContent, seedCustomContent } from './edm-seed.js'
import { createEdmIpcContext, EDM_API_CHANNEL, type EdmIpcDeps, type Payload } from './ipc/context.js'
import { registerBrandActions } from './ipc/brand.js'
import { registerTemplateActions } from './ipc/template.js'
import { registerFragmentActions } from './ipc/fragment.js'
import { registerMailActions } from './ipc/mail.js'
import { registerSystemActions } from './ipc/system.js'
import { registerContentActions } from './ipc/content.js'

export type { EdmIpcDeps } from './ipc/context.js'

/**
 * EDM Studio IPC（数据契约 §5 edm 命名空间，M4/M5 用 action 白名单单通道）。
 * 版本不可变（D8）；删除一律软删除；产物覆盖式（D19）。
 *
 * P6-5 拆分（#156 · B37-F7）：action 处理器按域收进 `ipc/` 目录——
 * brand / template（含 version:render）/ fragment（含 candidates:pick）/ mail（含 share:resolve）/
 * system（含 system:derive）/ content，本文件只做装配入口：建上下文、注册期播种与遗留迁移、
 * 单通道 edm:api 白名单分发（handler 集合即白名单，与原 ACTIONS set + switch 语义一致）。
 * H1 契约保持现状：工具 main 不走 handleOk/wrapIpcHandler 属现状，仅拆文件不改分发语义。
 */
export function registerEdmIpc(ipc: IpcMain, deps: EdmIpcDeps): void {
  const ctx = createEdmIpcContext(deps)

  // R8 首次运行播种：系统内容注册进 NeDB 查询索引（逐实体幂等，激活即补种；不阻塞注册）
  seedSystemContent(ctx.repo, ctx.resolveEdmRoot()).catch((err: unknown) =>
    console.warn('[edm] 系统内容播种失败：', err instanceof Error ? err.message : err),
  )
  // R24 自定义根薄索引：扫描 custom-edm 文件根 → 同步 NeDB origin=custom（文件为真相源，邮件编辑器零改动）
  seedCustomContent(ctx.repo, ctx.resolveContentRoot('custom')).catch((err: unknown) =>
    console.warn('[edm] 自定义内容索引失败：', err instanceof Error ? err.message : err),
  )

  /** 各域 action 处理器集合（key 即白名单） */
  const handlers = new Map<string, (data: Payload) => Promise<unknown>>()
  registerBrandActions(ctx, handlers)
  registerTemplateActions(ctx, handlers)
  registerFragmentActions(ctx, handlers)
  registerMailActions(ctx, handlers)
  registerSystemActions(ctx, handlers)
  registerContentActions(ctx, handlers)

  ipc.handle(EDM_API_CHANNEL, async (_event: IpcMainInvokeEvent, payload: { action: string; data?: Payload }) => {
    const { action, data = {} as Payload } = payload
    if (!handlers.has(action)) throw new AppError(`非法 action: ${action}`)
    return handlers.get(action)!(data)
  })
}
