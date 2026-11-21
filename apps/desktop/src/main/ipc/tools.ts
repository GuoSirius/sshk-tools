import { ACCESS_GRANT, AppError, IPC_CHANNELS, type ToolOverrides } from '@sshk/shared'
import { MANIFESTS } from '../discovery'
import { handleOk } from '../ipc-wrap'
import type { IpcContext } from './context'

/** 工具目录（P3-1 registerIpc 拆分：toolsList/Enabled/Grant/Dependencies/Overrides/Distribution/Cleanup/accessKeySet） */
export function registerToolsIpc(ctx: IpcContext): void {
  const cfg = ctx.services.config

  handleOk(IPC_CHANNELS.toolsList, () => ctx.buildCatalog())
  handleOk(IPC_CHANNELS.toolsSetEnabled, (_event, id: string, enabled: boolean) => {
    ctx.assertKnownTool(id)
    cfg.set(`tools.${id}.enabled`, Boolean(enabled))
    return ctx.buildCatalog()
  })
  handleOk(IPC_CHANNELS.toolsSetGrant, (_event, id: string, grant: string) => {
    ctx.assertKnownTool(id)
    if (grant && grant !== ACCESS_GRANT) throw new AppError(`未知权限要求: ${grant}`, 'permission')
    cfg.set(`tools.${id}.requiredGrant`, grant || '')
    return ctx.buildCatalog()
  })
  handleOk(IPC_CHANNELS.toolsSetDependencies, (_event, id: string, raw: unknown) => {
    ctx.assertKnownTool(id)
    if (!Array.isArray(raw)) throw new AppError('依赖必须是工具 id 数组')
    const ids = Array.from(new Set(raw.filter((dep): dep is string =>
      typeof dep === 'string' && dep !== id && MANIFESTS.some((t) => t.id === dep))))
    cfg.set(`tools.${id}.dependsOn`, ids)
    return ctx.buildCatalog()
  })
  handleOk(IPC_CHANNELS.toolsSetOverrides, (_event, id: string, raw: unknown) => {
    ctx.assertKnownTool(id)
    const all = ctx.readRecord<ToolOverrides>('app.toolOverrides')
    all[id] = ctx.pickOverrides(raw)
    cfg.set('app.toolOverrides', all)
    return ctx.buildCatalog()
  })
  handleOk(IPC_CHANNELS.toolsSetDistribution, (_event, raw: unknown) => {
    const ids = Array.isArray(raw)
      ? raw.filter((id): id is string => typeof id === 'string' && ctx.allManifests().some((t) => t.id === id))
      : null
    cfg.set('app.distribution.includeTools', ids)
    return ctx.buildCatalog()
  })
  handleOk(IPC_CHANNELS.toolsCleanupOrphans, () => {
    for (const id of ctx.buildCatalog().orphans) cfg.remove(`tools.${id}`)
    return ctx.buildCatalog()
  })
  handleOk(IPC_CHANNELS.accessKeySet, (_event, key: string) => {
    ctx.services.setAccessKey(String(key ?? ''))
    return ctx.buildCatalog()
  })
}
