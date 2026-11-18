import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs'
import { zipSync, type Zippable } from 'fflate'
import { dirname, extname, isAbsolute } from 'node:path'
import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import { app } from 'electron'
import { IPC_CHANNELS, now, type ToolHostCapabilities } from '@sshk/shared'
import {
  entityId,
  posterOutputRel,
  readOutput,
  resolveSafe,
  writeOutput,
  outputSnapshotOptions,
  type Mail,
  type Poster,
  type Repository,
} from '@sshk/repository'
import { injectBadges, markBadges, parseDatasource } from '../core/index.js'
import {
  buildVisionMessages,
  DEFAULT_OCR_LAYOUT,
  parseVisionResult,
  toCsvText,
  type OcrLayoutConfig,
} from '../core/vision.js'
import { ensureAdapterScript, withAdapterArgs } from './adapter.js'
import { hashHtml } from './hash.js'
import type { StatRow } from '../core/datasource.js'
import { DEFAULT_URL_NORM } from '../core/url-norm.js'
import { extractRemoteImageRefs, replaceRefs, type RemoteImageRef } from '../core/remote-images.js'
import type { BadgeInjectConfig } from '../core/badge.js'

const VISION_KEY_NAME = 'visionApiKey'

// ── 外链图片内联（穿插⑦-6，EDM 验证清单 Q8 方案）：main 侧 Node fetch 无 CORS ──
const INLINE_MAX_IMAGES = 60
const INLINE_TIMEOUT_MS = 20_000
const INLINE_MAX_BYTES = 10 * 1024 * 1024

/** 下载单张外链图 → dataURL；失败抛错由调用方跳过（保留原 URL 不阻断生成） */
async function fetchAsDataUrl(url: string): Promise<string> {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(INLINE_TIMEOUT_MS),
    headers: { 'user-agent': 'Mozilla/5.0 sshk-tools (badge poster inline)' },
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const type = res.headers.get('content-type') ?? ''
  if (!type.startsWith('image/')) throw new Error(`非图片类型 ${type}`)
  const buf = Buffer.from(await res.arrayBuffer())
  if (buf.byteLength > INLINE_MAX_BYTES) throw new Error(`超过 10MB`)
  return `data:${type.split(';')[0]};base64,${buf.toString('base64')}`
}

/** 产物 HTML 外链图片全量内联：预览 srcdoc / snapdom 截图 / 分享页三出口同时受益 */
async function inlineRemoteImages(html: string): Promise<{ html: string; inlined: number }> {
  const refs = extractRemoteImageRefs(html)
  if (refs.length === 0) return { html, inlined: 0 }
  // 按 URL 去重下载（同一张图多处引用只 fetch 一次）
  const uniqueUrls = [...new Set(refs.map((r) => r.url))].slice(0, INLINE_MAX_IMAGES)
  const results = await Promise.allSettled(uniqueUrls.map(async (url) => ({ url, dataUrl: await fetchAsDataUrl(url) })))
  let out = html
  let inlined = 0
  for (const result of results) {
    if (result.status !== 'fulfilled') continue
    const hit: RemoteImageRef[] = refs.filter((r) => r.url === result.value.url)
    out = replaceRefs(out, hit, result.value.dataUrl)
    inlined += hit.length
  }
  return { html: out, inlined }
}
const IMAGE_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
}

function readHtmlFile(file: string, outputRoot: string): string {
  // 用户通过文件选择器主动选择的绝对路径（.html/.htm）直接读取；
  // 产物系统内的相对路径仍受 resolveSafe 防穿越保护
  if (isAbsolute(file)) {
    if (!/\.html?$/i.test(file)) throw new Error(`仅支持 .html/.htm 文件: ${file}`)
    return readFileSync(file, 'utf8')
  }
  return readFileSync(resolveSafe(outputRoot, file), 'utf8')
}

function resolveInputFile(file: string, outputRoot: string): string {
  return isAbsolute(file) ? file : resolveSafe(outputRoot, file)
}

/** 用户主动选择的图片：转 data URI 供视觉模型使用，限制体积避免撑爆请求 */
function readImageDataUri(file: string): string {
  const mime = IMAGE_MIME[extname(file).toLowerCase()]
  if (!mime) throw new Error('仅支持 png / jpg / webp / gif / bmp 图片')
  const buf = readFileSync(file)
  if (buf.byteLength > 8 * 1024 * 1024) throw new Error('图片超过 8MB，请压缩后重试')
  return `data:${mime};base64,${buf.toString('base64')}`
}

/** 命令参数模板：支持双 / 单引号包裹，{image} 由宿主替换为图片绝对路径 */
function parseArgs(template: string): string[] {
  const parts = template.match(/"[^"]*"|'[^']*'|\S+/g) ?? []
  return parts.map((part) => part.replace(/^["']|["']$/g, ''))
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
  /** N5 源邮件衍生关系：传了则 poster.source={type:'mail',mailId}，sourceHash 取邮件指纹 */
  mailId?: string
}

export interface ParseImageInput {
  file: string
  provider: 'cloud' | 'paddleocr' | 'manual'
  /** 应用级 Provider id：baseURL / 密钥由主进程注入，工具不重复配置 */
  providerId?: string
  /** 覆盖 Provider 上的模型名（用户可在页面上直接选） */
  model?: string
  paddleCommand?: string
  paddleArgs?: string
  /** 本机 OCR 版式：来自工具配置，宿主不猜 */
  ocrLayout?: OcrLayoutConfig
}

export interface BadgeIpcDeps {
  /** 与 tool.manifest.json 的 id 一致，宿主加载插件时注入；工具内不再硬编码 */
  toolId: string
  repository: Repository
  outputRoot: string
  /** 宿主能力（密钥 / 云端视觉 / 本机 OCR）；可选便于单测用最小依赖构造 */
  host?: ToolHostCapabilities
  /** 应用配置（只读）；N4 回滚快照开关（app.outputSnapshot）读取用 */
  config?: { get(key: string): unknown }
}

function kindOf(file: string): 'xlsx' | 'csv' | 'json' {
  const ext = extname(file).toLowerCase()
  if (ext === '.xlsx' || ext === '.xls') return 'xlsx'
  if (ext === '.json') return 'json'
  return 'csv'
}

/** 标记核对 CSV（BOM 头，Excel 直接打开不乱码）：url/点击/自定义指标列 + 生成后回填的实际标记数 */
function buildMarkCsv(stats: StatRow[], matchCounts: Record<string, number>): string {
  const metricKeys = [...new Set(stats.flatMap((r) => Object.keys(r.metrics ?? {})))]
  const esc = (v: unknown) => {
    const t = String(v ?? '')
    return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t
  }
  const head = ['url', 'clicks', 'totalClicks', ...metricKeys, '实际标记数']
  const rows = stats.map((r) =>
    [r.url, r.clicks, r.totalClicks, ...metricKeys.map((k) => r.metrics?.[k] ?? ''), matchCounts[r.url] ?? 0]
      .map(esc)
      .join(','),
  )
  return `\uFEFF${[head.join(','), ...rows].join('\n')}\n`
}

/**
 * Badge Studio IPC（数据契约 §5 badge 命名空间）。
 * 原 HTML 全程只读；badge 副本与海报产物覆盖式写入（D19）。
 */
export function registerBadgeIpc(ipc: IpcMain, deps: BadgeIpcDeps): void {
  const wrap = <T,>(fn: (payload: T) => unknown) =>
    (_event: IpcMainInvokeEvent, payload: T): unknown => fn(payload)
  const requireHost = (): ToolHostCapabilities => {
    if (!deps.host) throw new Error('宿主未提供图片识别能力')
    return deps.host
  }
  // ① 数据源解析：按扩展名分派（xlsx/csv/json）
  //    支持文件选择器给出的绝对路径（用户主动选择）与产物系统相对路径
  ipc.handle(IPC_CHANNELS.badgeParseDatasource, wrap((file: string) => {
    const abs = resolveInputFile(file, deps.outputRoot)
    return parseDatasource(kindOf(abs), readFileSync(abs))
  }))

  // ①-b 图片数据源：云端视觉模型 / 本机 PaddleOCR → 统一标准 StatRow[]
  ipc.handle(IPC_CHANNELS.badgeParseImage, wrap(async (input: ParseImageInput) => {
    const host = requireHost()
    const abs = resolveInputFile(input.file, deps.outputRoot)
    const warnings: string[] = []
    let text: string

    if (input.provider === 'cloud') {
      if (!input.providerId?.trim()) {
        throw new Error('请先在「模型控制台」配置 Provider，再在图片识别里选择')
      }
      // 复用应用级 Provider：端点、密钥一律由主进程注入，工具侧不再存 baseURL / apiKey
      text = await host.chatByProvider({
        providerId: input.providerId,
        model: input.model?.trim() || undefined,
        messages: buildVisionMessages([readImageDataUri(abs)]),
        temperature: 0,
        maxTokens: 4096,
      })
    } else if (input.provider === 'paddleocr') {
      if (!input.paddleCommand?.trim()) throw new Error('请先在工具配置里填写本机 PaddleOCR 命令')
      // 适配器脚本由宿主托管（userData/adapters），用户参数只负责 {image}；
      // 未写 .py 脚本时自动前置适配器路径，避免 python 把图片当源码执行
      const adapterPath = await ensureAdapterScript()
      const args = withAdapterArgs(
        parseArgs(input.paddleArgs ?? '{image}').map((arg) => arg.replaceAll('{image}', abs)),
        adapterPath,
      )
      if (!args.includes('--layout')) {
        args.push('--layout', JSON.stringify(input.ocrLayout ?? DEFAULT_OCR_LAYOUT))
      }
      text = await host.runLocalOcr({
        command: input.paddleCommand,
        args,
        imagePath: abs,
      })
    } else {
      throw new Error('当前为「仅人工校对」模式，请直接粘贴 CSV 文本')
    }

    const rows = parseVisionResult(text, warnings, { layout: input.ocrLayout })
    // 回填可校对 CSV：识别结果永远先过人眼，再进 badge 注入链路
    return { rows, warnings, csv: toCsvText(rows), raw: text.slice(0, 20_000) }
  }))

  // ①-c 视觉模型密钥：只写宿主 safeStorage，明文不进 settings.json、不回传渲染层
  ipc.handle(IPC_CHANNELS.badgeSetVisionKey, wrap((key: string) => {
    requireHost().setToolSecret(deps.toolId, VISION_KEY_NAME, String(key ?? '').trim())
    return true
  }))
  ipc.handle(IPC_CHANNELS.badgeVisionState, () => ({
    hasKey: Boolean(deps.host?.getToolSecret(deps.toolId, VISION_KEY_NAME)),
  }))

  // ② 读取外部 HTML：返回内容与指纹（sourceHash，源更新检测）
  ipc.handle(IPC_CHANNELS.badgeReadHtml, wrap((file: string) => {
    const html = readHtmlFile(file, deps.outputRoot)
    return { html, hash: hashHtml(html) }
  }))

  // ②-b N5 源更新检测：mail 型海报对比源邮件当前 sourceHash；返回行级 stale + 当前源产物 rel
  ipc.handle(IPC_CHANNELS.badgeSourceState, wrap(async (payload?: { posterIds?: string[] }) => {
    const posters = await deps.repository.list<Poster>('posters', { archived: false })
    const wanted = Array.isArray(payload?.posterIds) && payload!.posterIds.length > 0
      ? new Set(payload!.posterIds.map(String))
      : null
    const rows: { posterId: string; stale: boolean; sourceRel: string | null; mailId: string | null }[] = []
    for (const poster of posters) {
      if (wanted && !wanted.has(poster._id)) continue
      if (poster.source.type !== 'mail' || !poster.source.mailId) {
        rows.push({ posterId: poster._id, stale: false, sourceRel: null, mailId: null })
        continue
      }
      const mail = await deps.repository.get<Mail>('mails', poster.source.mailId)
      const currentHash = mail?.sourceHash
        ?? (mail?.outputs?.final ? hashHtml(readOutput(deps.outputRoot, mail.outputs.final)) : undefined)
      rows.push({
        posterId: poster._id,
        stale: Boolean(poster.sourceHash && currentHash && currentHash !== poster.sourceHash),
        sourceRel: mail?.outputs?.final ?? null,
        mailId: poster.source.mailId,
      })
    }
    return { rows }
  }))

  // ③ 批量补属性：给命中但未带属性的 <a> 补 badgeAttr（只在副本上，原文件不动）
  ipc.handle(IPC_CHANNELS.badgeMarkBadges, wrap((payload: { html: string; stats: StatRow[]; badgeAttr: string }) =>
    markBadges(payload.html, payload.stats, { badgeAttr: payload.badgeAttr, urlNorm: DEFAULT_URL_NORM })))

  // ④ 生成：badge 副本 + 海报记录（覆盖式产物；重新生成按 posterId 覆写）
  ipc.handle(IPC_CHANNELS.badgeGenerate, wrap(async (input: GenerateInput) => {
    const posterId = input.posterId ?? entityId('pst')
    const { html: badged, matchCounts } = injectBadges(input.sourceHtml, input.stats, input.config)
    // 标记核对报告（用户 2026-11-17：标记数据随海报保存）：CSV 落 assets，url→实际标记数
    const markReportRel = writeOutput(deps.outputRoot, `assets/uploads/${posterId}-marks.csv`, buildMarkCsv(input.stats, matchCounts))
    // 穿插⑦-6：外链图片 main 侧下载内联转 dataURL（snapdom 截图内联像素被 CORS 拦 → 灰占位的根因）
    const { html: finalHtml, inlined } = await inlineRemoteImages(badged)
    if (inlined > 0) console.log(`[badge] 已内联外链图片 ${inlined} 张（${posterId}）`)
    const badgedRel = writeOutput(deps.outputRoot, posterOutputRel(posterId, 'badged'), finalHtml, outputSnapshotOptions(deps.config, deps.toolId, app.getPath('userData')))

    // 源 HTML 落 assets（可复现；原上传文件也不动）
    const srcRel = writeOutput(deps.outputRoot, `assets/uploads/${posterId}-source.html`, input.sourceHtml)

    const snapshot: Poster['configSnapshot'] = {
      badgeAttr: input.config.badgeAttr,
      clicksField: input.config.clicksField,
      posterWidth: 680,
      scale: 2,
      badgePositionText: input.config.defaultPositions?.text,
      badgePositionImage: input.config.defaultPositions?.image,
    }
    const outputs: Poster['outputs'] = { badged: badgedRel }
    const datasources: Poster['datasources'] = input.statsFileRel
      ? [{ file: input.statsFileRel, kind: kindOf(input.statsFileRel) }]
      : []

    const existing = await deps.repository.get<Poster>('posters', posterId)
    // N5 衍生关系：显式传 mailId 优先；重生成既有 mail 型海报时保留原 mailId
    const mailId = input.mailId?.trim()
      || (existing?.source.type === 'mail' ? existing.source.mailId : undefined)
    // 源指纹：mail 型取源邮件 sourceHash（契约 §7 对比口径）；upload 型存源 HTML 内容哈希
    let sourceHash = hashHtml(input.sourceHtml)
    if (mailId) {
      const mail = await deps.repository.get<Mail>('mails', mailId)
      sourceHash = mail?.sourceHash ?? sourceHash
    }
    const source: Poster['source'] = mailId
      ? { type: 'mail', mailId, htmlPath: srcRel }
      : { type: 'upload', htmlPath: srcRel }
    if (existing) {
      await deps.repository.update<Poster>('posters', posterId, {
        name: input.name,
        source,
        sourceHash,
        datasources,
        configSnapshot: snapshot,
        statsSnapshot: input.stats,
        markCounts: matchCounts,
        markReport: markReportRel,
        outputs: { ...existing.outputs, badged: badgedRel },
        status: 'generated',
        lastGeneratedAt: now(),
      })
    } else {
      await deps.repository.insert<Poster>('posters', {
        name: input.name,
        source,
        sourceHash,
        statsSnapshot: input.stats,
        markCounts: matchCounts,
        markReport: markReportRel,
        datasources,
        configSnapshot: snapshot,
        outputs,
        status: 'generated',
        lastGeneratedAt: now(),
      })
    }
    return { posterId, badgedRel, html: finalHtml, matchCounts }
  }))

  // ④b 导出产物文件（badge 副本 + 海报长图）：目录来自用户选择，文件名取海报名
  // ④b 导出产物文件（badge 副本 + 海报长图）→ 单个 zip 包；批量时每个海报一个子目录
  ipc.handle(IPC_CHANNELS.badgeExportFiles, wrap(async (payload: { posterIds: string[]; outPath: string }) => {
    const outPath = String(payload.outPath || '')
    if (!outPath.toLowerCase().endsWith('.zip')) throw new Error('导出路径必须是 .zip 文件')
    const zipObj: Zippable = {}
    let exported = 0
    for (const posterId of payload.posterIds) {
      const poster = await deps.repository.get<Poster>('posters', posterId)
      if (!poster || !poster.outputs.badged) continue
      const safeName = (poster.name || posterId).replace(/[\\/:*?"<>|]/g, '_')
      zipObj[safeName + '.html'] = new Uint8Array(readFileSync(resolveSafe(deps.outputRoot, poster.outputs.badged)))
      if (poster.outputs.poster) {
        const posterPng = resolveSafe(deps.outputRoot, poster.outputs.poster)
        if (existsSync(posterPng)) zipObj[safeName + '.png'] = new Uint8Array(readFileSync(posterPng))
      }
      exported += 1
    }
    if (exported === 0) throw new Error('没有可导出的海报')
    mkdirSync(dirname(outPath), { recursive: true })
    writeFileSync(outPath, zipSync(zipObj))
    return { outPath, posters: exported }
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
  // ④c 保存修改：只更新名称与配置快照，不触发重新生成（改个名字不必重跑）
  ipc.handle(IPC_CHANNELS.badgeSavePosterMeta, wrap(async (payload: { posterId: string; name?: string; configSnapshot?: Poster['configSnapshot'] }) => {
    const poster = await deps.repository.get<Poster>('posters', payload.posterId)
    if (!poster) throw new Error('海报不存在（新海报请先生成一次）')
    await deps.repository.update<Poster>('posters', payload.posterId, {
      ...(payload.name ? { name: payload.name } : {}),
      ...(payload.configSnapshot ? { configSnapshot: payload.configSnapshot } : {}),
      updatedAt: now(),
    })
    return true
  }))
  ipc.handle(IPC_CHANNELS.badgeDeletePoster, wrap(async (posterId: string) => {
    await deps.repository.archive('posters', posterId)
    return true
  }))

  // ⑧ 下载已截图海报 PNG：复制产物到用户指定路径（渲染层经 pickSave 取路径）
  ipc.handle(IPC_CHANNELS.badgeDownloadPng, wrap(async (payload: { posterId: string; outPath: string }) => {
    const poster = await deps.repository.get<Poster>('posters', payload.posterId)
    if (!poster?.outputs.poster) throw new Error('该海报尚未截图保存 PNG，请先在生成页「截图保存 PNG」')
    const src = resolveSafe(deps.outputRoot, poster.outputs.poster)
    if (!existsSync(src)) throw new Error('海报图片文件不存在：' + poster.outputs.poster)
    mkdirSync(dirname(payload.outPath), { recursive: true })
    copyFileSync(src, payload.outPath)
    return { outPath: payload.outPath }
  }))

  // ⑨ 海报分享解析（plans/09）：posterId → { root, entry, label } 绝对路径。
  //    分享服务本体（token/TTL/状态/二维码/续期/撤销）统一由宿主 ShareHub + ShareDialog 承担，
  //    工具 main 只做「业务 id → 产物绝对路径」解析（这里最清楚 outputRoot 布局）。
  //    posterId 为空 = 列表级分享：root 仍为产物根（root 不变则前缀互通），entry='' 走目录列表页。
  ipc.handle(IPC_CHANNELS.badgeShareResolve, wrap(async (payload: { posterId: string }) => {
    if (!payload.posterId) {
      return { root: deps.outputRoot, entry: '', label: '海报列表' }
    }
    const poster = await deps.repository.get<Poster>('posters', payload.posterId)
    if (!poster?.outputs.badged) throw new Error('海报尚未生成，无法分享')
    // serve 产物根（html + assets 同源可访问）；entry 为 badged 相对路径
    const entry = poster.outputs.badged.replaceAll('\\', '/').replace(/^\/+/, '')
    const abs = resolveSafe(deps.outputRoot, entry)
    if (!existsSync(abs)) throw new Error('海报产物文件不存在：' + entry)
    return { root: deps.outputRoot, entry, label: `海报：${poster.name}` }
  }))

  // ⑩ 数据源模板下载（用户验收项4）：空表头 + 示例行；xlsx 含「填写说明」sheet；返回 base64 由渲染层落盘
  ipc.handle(IPC_CHANNELS.badgeTemplateDownload, wrap(async (fmt: 'xlsx' | 'csv' | 'json') => {
    const XLSX = await import('xlsx')
    const sample = {
      url: 'https://example.com/product/1',
      clicks: 12,
      totalClicks: 30,
    }
    const headers = ['url', 'clicks', 'totalClicks']
    let buf: Buffer
    let fileName: string
    if (fmt === 'json') {
      const json = JSON.stringify([sample], null, 2)
      buf = Buffer.from(json, 'utf8')
      fileName = 'badge-datasource-template.json'
    } else if (fmt === 'csv') {
      const csv = '\uFEFF' + headers.join(',') + '\n' + headers.map((h) => String(sample[h as keyof typeof sample])).join(',') + '\n'
      buf = Buffer.from(csv, 'utf8')
      fileName = 'badge-datasource-template.csv'
    } else {
      const wb = XLSX.utils.book_new()
      const ws = XLSX.utils.json_to_sheet([sample], { header: headers })
      XLSX.utils.book_append_sheet(wb, ws, '数据源')
      const guide = XLSX.utils.aoa_to_sheet([
        ['列名', '是否必填', '说明'],
        ['url', '必填', '商品/链接地址，用于匹配 HTML 中的链接并打角标'],
        ['clicks', '必填', '角标显示的数字（整数）'],
        ['totalClicks', '选填', '累计点击；也可用「角标取值列」切换为其它列'],
        ['自定义列', '选填', '如 uv / 下单数，应用内「新增数值列」即可扩展'],
        ['填写提示', '', '保持表头名称不变；第一行示例数据请删除或替换后保存'],
      ])
      XLSX.utils.book_append_sheet(wb, guide, '填写说明')
      buf = Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Uint8Array)
      fileName = 'badge-datasource-template.xlsx'
    }
    return { base64: buf.toString('base64'), fileName }
  }))
}
