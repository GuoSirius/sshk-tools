import { app, ipcMain } from 'electron'
import { IPC_CHANNELS } from '@sshk/shared'
import type { VerifySession } from '@app/shared/verify-steps'
import { contentList, contentGet, contentSave, contentRemove } from '../modules/file/content'
import { collectDiagnostics, exportDiagnosisZip } from '../diagnostics'
import { toolRecentErrors } from '../health'
import { handleOk } from '../ipc-wrap'
import { loadToolPlugins } from '../plugins'
import { logger } from '../logger'
import { findRepoRoot, listSessions, loadSession, resolveSessionsDir, runAutoCheck, saveSession } from '../verify-sessions'
import { collectUsageStats, clearUsage } from '../usage'
import type { IpcContext } from './context'

/** 杂项域（P3-1 registerIpc 拆分：content*、verify*、diag*、usage*、插件加载） */
export async function registerMiscIpc(ctx: IpcContext): Promise<void> {
  const services = ctx.services

  // ── 内容管理（plans/11）：文章 CRUD（contents 集合）──
  handleOk(IPC_CHANNELS.contentList, () => contentList(services.repository))
  handleOk(IPC_CHANNELS.contentGet, (_event, id: string) => contentGet(services.repository, id))
  handleOk(IPC_CHANNELS.contentSave, (_event, req: Parameters<typeof contentSave>[1]) => contentSave(services.repository, req))
  handleOk(IPC_CHANNELS.contentRemove, (_event, req: { id: string; hard?: boolean }) =>
    contentRemove(services.repository, req?.id, req?.hard === true))

  // ── U2 验证引导：会话存储 + main 侧自动判定（fileExists/catalogState/logScan）──
  // dev 落 <repo>/docs/verify-sessions（随 git 提交同步，跨设备/多人增量累计）；打包版落 userData
  const verifyDir = resolveSessionsDir(app.getPath('userData'), findRepoRoot(app.getAppPath()))
  handleOk(IPC_CHANNELS.verifySessionLoad, (_event, date?: string) => loadSession(verifyDir, date ? String(date) : undefined))
  handleOk(IPC_CHANNELS.verifySessionSave, (_event, session: unknown) => saveSession(verifyDir, session as VerifySession))
  handleOk(IPC_CHANNELS.verifySessionList, () => listSessions(verifyDir))
  handleOk(IPC_CHANNELS.verifyAutoCheck, (_event, req: { kind?: string; spec?: string }) => {
    const catalog = ctx.buildCatalog()
    const catalogMap: Record<string, { enabled: boolean; visible: boolean }> = {}
    for (const t of catalog.tools) catalogMap[t.id] = { enabled: t.enabled, visible: t.visible }
    const channelCounts: Record<string, number> = {}
    for (const m of ctx.allManifests()) channelCounts[m.id] = m.plugin?.channels?.length ?? 0
    return runAutoCheck(String(req?.kind ?? ''), String(req?.spec ?? ''), {
      catalog: catalogMap,
      channelCounts,
      lastErrors: (toolId) => toolRecentErrors(toolId),
      packagedResourceRoot: app.isPackaged ? process.resourcesPath : null,
    })
  })

  // ── N1 一键诊断：采集（预览）+ 导出 zip（report.md + 近 3 天日志）──
  handleOk(IPC_CHANNELS.diagCollect, () => collectDiagnostics(services, ctx.getPluginStatus(), ctx.buildCatalog()))
  handleOk(IPC_CHANNELS.diagExport, (_event, zipPath: string) =>
    exportDiagnosisZip(collectDiagnostics(services, ctx.getPluginStatus(), ctx.buildCatalog()), String(zipPath ?? '')))

  // ── D-Q1 模型用量日志：统计 / 清空 ──
  handleOk(IPC_CHANNELS.usageStats, async (_event, since?: string | null) =>
    collectUsageStats(services.repository, typeof since === 'string' && since ? since : null))
  handleOk(IPC_CHANNELS.usageClear, async (_event, keepDays?: number) => {
    const removed = await clearUsage(services.repository, Number(keepDays) || 0)
    logger.info('usage', `用量明细已清理：${removed} 条（keepDays=${Number(keepDays) || 0}）`)
    return { removed }
  })

  // ── 插件：按构建期发现的清单逐个加载，任一失败只影响它自己 ──
  ctx.setPluginStatus(await loadToolPlugins({
    ipcMain,
    repository: services.repository,
    outputRoot: services.outputRoot,
    host: services.host,
    config: services.config,
    isActive: ctx.isToolActive,
  }, ctx.allManifests(), { userDataDir: app.getPath('userData') }))
}
