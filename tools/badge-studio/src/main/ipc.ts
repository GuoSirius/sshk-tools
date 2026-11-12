import { readFileSync } from 'node:fs'
import { extname, isAbsolute } from 'node:path'
import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import { IPC_CHANNELS, now } from '@sshk/shared'
import {
  entityId,
  posterOutputRel,
  resolveSafe,
  writeOutput,
  type Poster,
  type Repository,
} from '@sshk/repository'
import { hashHtml, injectBadges, markBadges, parseDatasource } from '../core/index.js'
import type { StatRow } from '../core/datasource.js'
import { DEFAULT_URL_NORM } from '../core/url-norm.js'
import type { BadgeInjectConfig } from '../core/badge.js'

function readHtmlFile(file: string, outputRoot: string): string {
  // 用户通过文件选择器主动选择的绝对路径（.html/.htm）直接读取；
  // 产物系统内的相对路径仍受 resolveSafe 防穿越保护
  if (isAbsolute(file)) {
    if (!/\.html?$/i.test(file)) throw new Error(`仅支持 .html/.htm 文件: ${file}`)
    return readFileSync(file, 'utf8')
  }
  return readFileSync(resolveSafe(outputRoot, file), 'utf8')
}

/** badge 生成入参（渲染层传内容与相对路径，不信任绝对路径） */
export interface GenerateInput {
  name: string
  /** 上传源 HTML 内容（整包字符串；原文件永不修改） */
  sourceHtml: string
  stats: StatRow[]
  config: BadgeInjectConfig
  /** stats 来源文件（已落 assets 的相对路径，用于重生成） */
  statsFileRel?: string
  posterId?: string
}

export interface BadgeIpcDeps {
  repository: Repository
  outputRoot: string
}

function kindOf(file: string): 'xlsx' | 'csv' | 'json' {
  const ext = extname(file).toLowerCase()
  if (ext === '.xlsx' || ext === '.xls') return 'xlsx'
  if (ext === '.json') return 'json'
  return 'csv'
}

/**
 * Badge Studio IPC（数据契约 §5 badge 命名空间）。
 * 原 HTML 全程只读；badge 副本与海报产物覆盖式写入（D19）。
 */
export function registerBadgeIpc(ipc: IpcMain, deps: BadgeIpcDeps): void {
  const wrap = <T,>(fn: (payload: T) => unknown) =>
    (_event: IpcMainInvokeEvent, payload: T): unknown => fn(payload)

  // ① 数据源解析：按扩展名分派（xlsx/csv/json）；image 走渲染层 csv 文本通道。
  //    支持文件选择器给出的绝对路径（用户主动选择）与产物系统相对路径
  ipc.handle(IPC_CHANNELS.badgeParseDatasource, wrap((file: string) => {
    const abs = isAbsolute(file) ? file : resolveSafe(deps.outputRoot, file)
    return parseDatasource(kindOf(abs), readFileSync(abs))
  }))

  // ② 读取外部 HTML：返回内容与指纹（sourceHash，源更新检测）
  ipc.handle(IPC_CHANNELS.badgeReadHtml, wrap((file: string) => {
    const html = readHtmlFile(file, deps.outputRoot)
    return { html, hash: hashHtml(html) }
  }))

  // ③ 批量补属性：给命中但未带属性的 <a> 补 badgeAttr（只在副本上，原文件不动）
  ipc.handle(IPC_CHANNELS.badgeMarkBadges, wrap((payload: { html: string; stats: StatRow[]; badgeAttr: string }) =>
    markBadges(payload.html, payload.stats, { badgeAttr: payload.badgeAttr, urlNorm: DEFAULT_URL_NORM })))

  // ④ 生成：badge 副本 + 海报记录（覆盖式产物；重新生成按 posterId 覆写）
  ipc.handle(IPC_CHANNELS.badgeGenerate, wrap(async (input: GenerateInput) => {
    const posterId = input.posterId ?? entityId('pst')
    const badged = injectBadges(input.sourceHtml, input.stats, input.config)
    const badgedRel = writeOutput(deps.outputRoot, posterOutputRel(posterId, 'badged'), badged)

    // 源 HTML 落 assets（可复现；原上传文件也不动）
    const srcRel = writeOutput(deps.outputRoot, `assets/uploads/${posterId}-source.html`, input.sourceHtml)

    const snapshot: Poster['configSnapshot'] = {
      badgeAttr: input.config.badgeAttr,
      clicksField: input.config.clicksField,
      posterWidth: 680,
      scale: 2,
    }
    const outputs: Poster['outputs'] = { badged: badgedRel }
    const datasources: Poster['datasources'] = input.statsFileRel
      ? [{ file: input.statsFileRel, kind: kindOf(input.statsFileRel) }]
      : []

    const existing = await deps.repository.get<Poster>('posters', posterId)
    if (existing) {
      await deps.repository.update<Poster>('posters', posterId, {
        name: input.name,
        source: { type: 'upload', htmlPath: srcRel },
        datasources,
        configSnapshot: snapshot,
        outputs: { ...existing.outputs, badged: badgedRel },
        status: 'generated',
        lastGeneratedAt: now(),
      })
    } else {
      await deps.repository.insert<Poster>('posters', {
        name: input.name,
        source: { type: 'upload', htmlPath: srcRel },
        datasources,
        configSnapshot: snapshot,
        outputs,
        status: 'generated',
        lastGeneratedAt: now(),
      })
    }
    return { posterId, badgedRel, html: badged }
  }))

  // ⑤ 海报 PNG 落盘（渲染层 snapdom 截图后回传 base64）
  ipc.handle(IPC_CHANNELS.badgeSavePosterPng, wrap((payload: { posterId: string; base64: string }) => {
    const rel = writeOutput(
      deps.outputRoot,
      posterOutputRel(payload.posterId, 'poster'),
      Buffer.from(payload.base64, 'base64'),
    )
    return rel
  }))

  // ⑥ 海报列表
  ipc.handle(IPC_CHANNELS.badgeListPosters, wrap(() => deps.repository.list('posters')))

  // ⑦ 删除（软删除归档；产物文件保留，硬删清理目录走二次确认流程）
  ipc.handle(IPC_CHANNELS.badgeDeletePoster, wrap(async (posterId: string) => {
    await deps.repository.archive('posters', posterId)
    return true
  }))
}
