import { computed, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { snapdom } from '@zumer/snapdom'
import { parseCsvText, rowsToCsv, sanitizeMetricKey, toStatRows } from '@sshk/badge-studio'
import type { StatRow } from '@sshk/badge-studio'
import { DEFAULT_BADGE_ATTR, DEFAULT_CLICKS_FIELD, DEFAULT_POSTER_WIDTH, format, toFileName } from '@sshk/shared'
import { host } from '../host'
import { configKey, textConfig } from './base'
import {
  imageFiles, loadProviders, ocrLayout, recognizing, vision, visionModel, visionProviderId, visionRaw,
} from './vision'
import {
  copyCode, currentGenerated, currentPosterId, deleteOpen, deleteTarget, downloadPosterPng, exportPosterHtml,
  loadPosters, openShare, posters, sourceStates,
} from './posters'

/**
 * 工作区域 store（P6-5 自 state.ts 三分拆出，模块级单例语义不变）：
 * 海报工作区（HTML / 统计表 / 识别配置 / 角标样式）+ 生成/保存/截图/下载 + 未保存检测基线
 * + 识别执行编排（读 vision 域配置、写本域统计表）+ 列表行动作分发（调 posters 域动作）。
 * 依赖方向恒为 workspace → {base, vision, posters}，无环；「编辑」从海报列表跳回生成页并
 * 回填工作区，状态必须活在单例里而非页面组件内。
 */

// ── 角标 / URL 归一 / 海报尺寸：全部来自工具配置，生成页不写死 ──
export const badgeAttr = ref(DEFAULT_BADGE_ATTR)
export const badgeStyle = reactive({ background: '#e60012', color: '#fff', size: 18, offsetY: 0, offsetX: 0 })
/** 角标样式覆盖（工具配置 → 角标样式覆盖）：common 公共 + 九位置单独，留空 = 内置默认 */
export const badgeStyleCss = reactive({
  common: '',
  positions: {} as Record<string, string>,
})
export const posterName = ref('')
export const badgePositionText = ref('top-right')
export const badgePositionImage = ref('center')
export const badgePositionOptions = [
  { label: '左上', value: 'top-left' }, { label: '上中', value: 'top-center' }, { label: '右上', value: 'top-right' },
  { label: '左中', value: 'left-center' }, { label: '居中', value: 'center' }, { label: '右中', value: 'right-center' },
  { label: '左下', value: 'bottom-left' }, { label: '下中', value: 'bottom-center' }, { label: '右下', value: 'bottom-right' },
]
export const urlNorm = reactive({ stripUtm: true, stripHash: true, stripTrailingSlash: true, sortQuery: true, lowercaseHost: true })
export const posterWidth = ref(DEFAULT_POSTER_WIDTH)
export const captureScale = ref(2)
/** 角标取值列：可填 clicks / totalClicks / 任意自定义数值列名 */
export const clicksField = ref(DEFAULT_CLICKS_FIELD)

// ── HTML 输入：选择文件 / 粘贴源码（二选一）；最近使用是持久化在本机配置里的历史记录 ──
export interface RecentHtml {
  path: string
  name: string
  usedAt: string
}
export const htmlPath = ref('')
export const pastedHtml = ref('')
export const recentHtmls = ref<RecentHtml[]>([])

// ── 数据源：文件 / 粘贴文本 / 图片识别，最终统一进同一张可编辑表格 ──
export const statsFile = ref('')
export const pastedStats = ref('')
export const statRows = ref<StatRow[]>([])
export const statsWarnings = ref<string[]>([])
export const definedMetrics = ref<string[]>([])
export const newMetricKey = ref('')

// ── 生成结果 ──
export const generating = ref(false)
export const previewHtml = ref('')
export const capturing = ref(false)

export const hasHtml = computed(() => htmlPath.value !== '' || pastedHtml.value.trim() !== '')
export const hasStats = computed(() => statRows.value.length > 0)

/** 列定义 + 实际数据里的自定义列并集，保证空表格也能先建列 */
export const customMetricKeys = computed(() => Array.from(new Set([
  ...definedMetrics.value,
  ...statRows.value.flatMap((row) => Object.keys(row.metrics ?? {})),
])))
export const fieldOptions = computed(() => Array.from(new Set(['clicks', 'totalClicks', ...customMetricKeys.value])))

export async function loadConfigAndRecent(): Promise<void> {
  badgeAttr.value = await textConfig('badgeAttr', DEFAULT_BADGE_ATTR)
  clicksField.value = await textConfig('clicksField', DEFAULT_CLICKS_FIELD)
  const savedStyle = (await host.config.get(configKey('badgeStyle'))) as Partial<typeof badgeStyle> | null
  if (savedStyle && typeof savedStyle === 'object') Object.assign(badgeStyle, savedStyle)
  // 2026-11-16 定位改造一次性迁移：旧出厂偏移 (-9,-11) 是 margin 语义的外飘值，
  // 新体系 translate(calc(-50% ± off)) 已含居中，旧值叠加会双重偏移导致角标外飘。
  // 只清旧出厂默认值，用户手调过的其它数值不动。
  if (badgeStyle.offsetY === -9 && badgeStyle.offsetX === -11) {
    badgeStyle.offsetY = 0
    badgeStyle.offsetX = 0
    void host.config.set(configKey('badgeStyle'), { ...badgeStyle })
  }
  const savedCss = (await host.config.get(configKey('badgeStyleCss'))) as
    | Partial<typeof badgeStyleCss>
    | null
  if (savedCss && typeof savedCss === 'object') {
    badgeStyleCss.common = typeof savedCss.common === 'string' ? savedCss.common : ''
    badgeStyleCss.positions = { ...(savedCss.positions ?? {}) }
  }
  badgePositionText.value = await textConfig('badgePositionText', 'top-right')
  badgePositionImage.value = await textConfig('badgePositionImage', 'center')
  const savedNorm = (await host.config.get(configKey('urlNorm'))) as Partial<typeof urlNorm> | null
  if (savedNorm && typeof savedNorm === 'object') Object.assign(urlNorm, savedNorm)
  posterWidth.value = Number(await host.config.get(configKey('posterWidth'))) || DEFAULT_POSTER_WIDTH
  captureScale.value = Number(await host.config.get(configKey('scale'))) || 2
  const recent = (await host.config.get(configKey('recentHtmls'))) as RecentHtml[] | null
  recentHtmls.value = Array.isArray(recent) ? recent : []
  // C-Q1：已存的 paddleocr 配置回落 cloud（数据保留，UI 不露出）
  const provider = await textConfig('vision.provider', 'cloud')
  vision.value.provider = provider === 'manual' ? 'manual' : 'cloud'
  vision.value.paddleCommand = await textConfig('vision.paddleCommand', 'python')
  vision.value.paddleArgs = await textConfig('vision.paddleArgs', '{image}')
  const savedLayout = (await host.config.get(configKey('ocrLayout'))) as Partial<typeof ocrLayout> | null
  if (savedLayout && typeof savedLayout === 'object') Object.assign(ocrLayout, savedLayout)
  await loadProviders()
  snapshotWorkspaceBaseline() // 初始基线：新建海报空工作区，此后变化计入返回列表 dirty
}

export async function rememberRecent(path: string): Promise<void> {
  const name = path.split(/[\\/]/).pop() ?? path
  const next = [{ path, name, usedAt: format() }, ...recentHtmls.value.filter((r) => r.path !== path)].slice(0, 10)
  recentHtmls.value = next
  await host.config.set(configKey('recentHtmls'), next)
}

export async function pickHtml(): Promise<void> {
  const [file] = await host.os.pickFile({
    filters: [{ name: '邮件 HTML', extensions: ['html', 'htm'] }],
  })
  if (!file) return
  const { html } = await host.badge.readHtml(file)
  pastedHtml.value = html
  htmlPath.value = file
  sourceMailId.value = null
  await rememberRecent(file)
}

export async function useRecent(item: RecentHtml): Promise<void> {
  try {
    const { html } = await host.badge.readHtml(item.path)
    htmlPath.value = item.path
    pastedHtml.value = html
    sourceMailId.value = null
  } catch {
    ElMessage.warning('该文件已不存在或被移动，已从最近使用中移除')
    await removeRecent(item)
  }
}

// ── N5 源邮件衍生：从 EDM 邮件选择源 HTML，打标时记录 mailId + sourceHash ──
export interface EdmMailOption {
  _id: string
  name: string
  lastGeneratedAt?: string
  outputs?: { final?: string }
}
export const edmMails = ref<EdmMailOption[]>([])
export const edmMailsLoading = ref(false)
/** 已选源邮件 id：非空时生成的海报与该邮件建立衍生关系（源重生成后提示重新打标） */
export const sourceMailId = ref<string | null>(null)

export async function loadEdmMails(): Promise<void> {
  edmMailsLoading.value = true
  try {
    edmMails.value = ((await host.edm.api('mail:list')) as EdmMailOption[]) ?? []
  } catch {
    // 静默降级（2026-11-18）：构建含 SSHK_BUILD_TOOLS 裁剪时 edm-studio 可能未装（edm:api 无 handler），
    // 每次进页面弹全局 toast 很吵——列表置空即可，源邮件下拉自然无选项
    edmMails.value = []
  } finally {
    edmMailsLoading.value = false
  }
}

export async function pickEdmMail(mail: EdmMailOption): Promise<void> {
  if (!mail.outputs?.final) {
    ElMessage.warning('该邮件尚未生成产物，请先在 EDM 内容管理里「生成」')
    return
  }
  try {
    const { html } = await host.badge.readHtml(mail.outputs.final)
    pastedHtml.value = html
    htmlPath.value = `edm:${mail.outputs.final}`
    sourceMailId.value = mail._id
    if (!posterName.value.trim()) posterName.value = mail.name
    ElMessage.success(`已载入源邮件「${mail.name}」（源邮件重新生成后会提示重新打标）`)
  } catch (err) {
    ElMessage.error(`源邮件产物读取失败：${(err as Error).message}`)
  }
}

/** 清除衍生关系（选择器清空 / 改用外部文件） */
export function clearSourceMail(): void {
  sourceMailId.value = null
}

/** 清空 HTML 选择：清除路径与编辑区内容（用户 2026-11-18：清空选择框 = 清除已选且清空 HTML 内容） */
export function clearHtmlSelection(): void {
  htmlPath.value = ''
  pastedHtml.value = ''
  previewHtml.value = ''
  clearSourceMail()
}

export async function removeRecent(item: RecentHtml): Promise<void> {
  recentHtmls.value = recentHtmls.value.filter((r) => r.path !== item.path)
  await host.config.set(configKey('recentHtmls'), recentHtmls.value)
}

export async function clearRecent(): Promise<void> {
  recentHtmls.value = []
  await host.config.set(configKey('recentHtmls'), [])
  ElMessage.success('最近使用已清空（只清历史记录，不影响已粘贴的内容）')
}

export function syncCsvFromRows(): void {
  pastedStats.value = rowsToCsv(statRows.value)
}

function applyRows(rows: StatRow[], warnings: string[], source = ''): void {
  statRows.value = rows
  statsWarnings.value = warnings
  statsFile.value = source
  definedMetrics.value = Array.from(new Set(rows.flatMap((row) => Object.keys(row.metrics ?? {}))))
  syncCsvFromRows()
}

export async function pickStats(): Promise<void> {
  const [file] = await host.os.pickFile({
    filters: [{ name: '点击统计', extensions: ['xlsx', 'xls', 'csv', 'tsv', 'json'] }],
  })
  if (!file) return
  try {
    const parsed = (await host.badge.parseDatasource(file)) as { rows: StatRow[]; warnings: string[] }
    applyRows(parsed.rows, parsed.warnings, file)
    if (parsed.rows.length > 0) ElMessage.success(`解析出 ${parsed.rows.length} 行，请在表格中核对`)
  } catch (err) {
    ElMessage.error((err as Error).message)
  }
}

export function parsePastedStats(): void {
  try {
    const warnings: string[] = []
    const rows = parseCsvText(pastedStats.value, warnings)
    applyRows(rows, warnings)
    if (rows.length > 0) ElMessage.success(`解析出 ${rows.length} 行，请在表格中核对`)
  } catch (err) {
    ElMessage.error((err as Error).message)
  }
}

export function addRow(): void {
  const metrics: Record<string, number> = {}
  for (const key of customMetricKeys.value) metrics[key] = 0
  statRows.value.push({ url: '', clicks: 0, totalClicks: 0, ...(customMetricKeys.value.length ? { metrics } : {}) })
  syncCsvFromRows()
}
export function removeRow(index: number): void {
  statRows.value.splice(index, 1)
  syncCsvFromRows()
}
export function clearRows(): void {
  statRows.value = []
  statsWarnings.value = []
  statsFile.value = ''
  pastedStats.value = ''
}
export function addMetric(): void {
  const key = sanitizeMetricKey(newMetricKey.value)
  if (!key) return
  if (['url', 'clicks', 'totalClicks'].includes(key) || customMetricKeys.value.includes(key)) {
    ElMessage.warning('列名重复或为保留列（url / clicks / totalClicks）')
    return
  }
  definedMetrics.value = [...definedMetrics.value, key]
  for (const row of statRows.value) row.metrics = { ...(row.metrics ?? {}), [key]: 0 }
  newMetricKey.value = ''
  syncCsvFromRows()
}
export function removeMetric(key: string): void {
  definedMetrics.value = definedMetrics.value.filter((k) => k !== key)
  for (const row of statRows.value) {
    if (!row.metrics) continue
    const { [key]: _, ...rest } = row.metrics
    row.metrics = Object.keys(rest).length ? rest : undefined
  }
  if (clicksField.value === key) clicksField.value = DEFAULT_CLICKS_FIELD
  syncCsvFromRows()
}
export function metricOf(row: StatRow, key: string): number {
  return row.metrics?.[key] ?? 0
}
export function setMetric(row: StatRow, key: string, raw: unknown): void {
  const num = Number(raw)
  row.metrics = { ...(row.metrics ?? {}), [key]: Number.isFinite(num) ? Math.round(num) : 0 }
  syncCsvFromRows()
}

/** 多张图片逐张识别，结果合并进同一张可编辑表格，人工核对后才可生成。
 *  （识别执行编排放工作区：读 vision 域配置、写本域统计表——保持 域→base 单向依赖无环） */
export async function recognizeImages(): Promise<void> {
  if (imageFiles.value.length === 0) {
    ElMessage.warning('请先选择至少一张点击统计截图 / 表格图片')
    return
  }
  if (vision.value.provider === 'manual') {
    ElMessage.info('当前为「仅人工校对」模式，请在上方文本框粘贴 CSV')
    return
  }
  if (!visionProviderId.value) {
    ElMessage.warning('请先在「模型控制台」配置 Provider，再在这里选择')
    return
  }
  recognizing.value = true
  const collected: StatRow[] = []
  const warnings: string[] = []
  const raws: string[] = []
  try {
    for (const file of imageFiles.value) {
      const result = await host.badge.parseImage({
        file,
        provider: vision.value.provider,
        providerId: visionProviderId.value,
        model: visionModel.value,
      })
      collected.push(...result.rows)
      warnings.push(...result.warnings)
      raws.push(`### ${file.split(/[\\/]/).pop()}\n${result.raw}`)
    }
    statRows.value = [...statRows.value, ...collected]
    statsWarnings.value = warnings
    statsFile.value = ''
    definedMetrics.value = Array.from(new Set([
      ...definedMetrics.value,
      ...collected.flatMap((row) => Object.keys(row.metrics ?? {})),
    ]))
    syncCsvFromRows()
    visionRaw.value = raws.join('\n\n')
    ElMessage.success(`识别 ${imageFiles.value.length} 张图片，追加 ${collected.length} 行；请在表格核对 5/S、0/O 等误识别`)
  } catch (err) {
    ElMessage.error((err as Error).message)
  } finally {
    recognizing.value = false
  }
}

/** 批量补属性：给未带 badgeAttr 的链接补空属性（只在生成的副本里生效，原文件不动）。
 *  用户 2026-11-18：只要有 HTML 内容就能补，不必等统计数据；无数据时补全部 http(s) 链接。 */
export async function markBeforeGenerate(): Promise<void> {
  if (!hasHtml.value) { ElMessage.warning('请先选择或粘贴邮件 HTML'); return }
  pastedHtml.value = await host.badge.markBadges({ html: pastedHtml.value, stats: statRows.value, badgeAttr: badgeAttr.value })
  ElMessage.success(hasStats.value
    ? '已在工作区副本中补齐命中链接的 badge 属性，可直接生成'
    : '已给工作区副本中全部链接补上 badge 属性（暂无统计数据，后续补数据即可注入）')
}

export async function generate(): Promise<void> {
  if (!hasHtml.value) {
    ElMessage.warning('请先选择或粘贴邮件 HTML（数据可空，但 HTML 是生成的前提）')
    return
  }
  // 流程定版（用户 2026-11-18）：数据可填可不填——没有点击数据时二次确认由用户抉择
  if (!hasStats.value) {
    try {
      await ElMessageBox.confirm(
        '尚未提供点击统计数据，生成的副本将不注入任何 badge 数据（角标不会出现）。确定继续生成吗？',
        '无数据生成确认',
        { type: 'warning', confirmButtonText: '继续生成', cancelButtonText: '先去补数据', closeOnClickModal: false, closeOnPressEscape: false },
      )
    } catch { return }
  }
  generating.value = true
  try {
    const name = posterName.value.trim() || htmlPath.value.split(/[\\/]/).pop()?.replace(/\.html?$/i, '') || `海报 ${toFileName()}`
    const res = await host.badge.generate({
      name,
      sourceHtml: pastedHtml.value,
      stats: statRows.value,
      statsFileRel: statsFile.value,
      posterId: currentPosterId.value || undefined,
      mailId: sourceMailId.value ?? undefined,
      config: {
        badgeAttr: badgeAttr.value,
        clicksField: clicksField.value,
        urlNorm: { ...urlNorm },
        badgeStyle: { ...badgeStyle },
        defaultPositions: { text: badgePositionText.value as never, image: badgePositionImage.value as never },
        customCss: {
          common: badgeStyleCss.common,
          positions: { ...badgeStyleCss.positions },
        },
      },
    })
    currentPosterId.value = res.posterId
    previewHtml.value = res.html
    // 回填每个 URL 的实际标记次数，未匹配行在表格中标红并可一键定位
    let unmatched = 0
    for (const row of statRows.value) {
      const count = res.matchCounts[row.url]
      row.matched = typeof count === 'number' ? count : 0
      if (!row.matched) unmatched += 1
    }
    ElMessage.success(
      unmatched > 0
        ? `已生成 badge 副本（${res.badgedRel}）；${unmatched} 个 URL 未被标记，见表格红色行`
        : `已生成 badge 副本（${res.badgedRel}），全部 URL 均已标记`,
    )
    snapshotWorkspaceBaseline() // 生成即保存了名称/配置/内容/统计快照 → 基线重置，返回列表不再误报 dirty
    await loadPosters()
  } catch (err) {
    ElMessage.error((err as Error).message)
  } finally {
    generating.value = false
  }
}

/** 只保存名称与角标配置（不触发重新生成）；流程定版（用户 2026-11-18）：
 *  海报名必填（为空 → 发「聚焦提示」自动展开配置并高亮，不保存）；HTML/数据可空不影响保存；
 *  新海报（无 id）直接创建草稿记录（main upsert），生成后续按返回 id 覆盖 */
export const nameAttention = ref(0)
export async function savePosterMeta(): Promise<void> {
  if (!posterName.value.trim()) {
    nameAttention.value += 1 // GeneratePage watch：展开配置折叠面板并聚焦海报名输入
    ElMessage.warning('海报名必填，请填写后再保存')
    return
  }
  try {
    const res = await host.badge.savePosterMeta({
      posterId: currentPosterId.value || undefined,
      name: posterName.value.trim(),
      configSnapshot: {
        badgeAttr: badgeAttr.value,
        clicksField: clicksField.value,
        badgePositionText: badgePositionText.value,
        badgePositionImage: badgePositionImage.value,
      },
    })
    if (res?.posterId) currentPosterId.value = res.posterId
    // 保存即基线（用户 2026-11-18）：名称/配置与内容基线一并重置，保存后返回列表不再弹 dirty 提示
    snapshotWorkspaceBaseline()
    ElMessage.success('已保存（名称与角标配置），无需重新生成')
    await loadPosters()
  } catch (err) {
    ElMessage.error('保存失败：' + (err as Error).message)
  }
}

/** 行内「更多」命令分发（posters 域动作 + 本域重新打标/删除弹框状态） */
export function onPosterCommand(cmd: string, row: PosterRecord): void {
  if (cmd === 'copy') void copyCode(row)
  else if (cmd === 'download-png') void downloadPosterPng(row)
  else if (cmd === 'share') void openShare(row)
  else if (cmd === 'export') void exportPosterHtml(row)
  else if (cmd === 'regenerate') void regeneratePoster(row)
  else if (cmd === 'delete') { deleteTarget.value = row; deleteOpen.value = true }
}

/** N5 一键重新打标（用新源覆盖重生成；统计与角标配置沿用该海报已存的快照） */
export async function regeneratePoster(row: PosterRecord): Promise<void> {
  const state = sourceStates.value[row._id]
  if (!state?.sourceRel) {
    ElMessage.warning('该海报未关联源邮件，无法自动重新打标（请在生成页重新载入源后生成）')
    return
  }
  try {
    const { html } = await host.badge.readHtml(state.sourceRel)
    const snap = row.configSnapshot
    await host.badge.generate({
      name: row.name,
      sourceHtml: html,
      stats: toStatRows(row.statsSnapshot ?? [], []),
      statsFileRel: row.datasources[0]?.file,
      posterId: row._id,
      mailId: row.source.mailId,
      config: {
        badgeAttr: snap.badgeAttr,
        clicksField: snap.clicksField,
        urlNorm: { ...urlNorm },
        badgeStyle: { ...badgeStyle },
        defaultPositions: { text: snap.badgePositionText as never, image: snap.badgePositionImage as never },
        customCss: { common: badgeStyleCss.common, positions: { ...badgeStyleCss.positions } },
      },
    })
    ElMessage.success(`已用新源重新打标「${row.name}」`)
    await loadPosters()
  } catch (err) {
    ElMessage.error(`重新打标失败：${(err as Error).message}`)
  }
}

/** 预览 iframe：生成页通过同名 ref 绑定写入；截图按钮在壳 actions 槽，故 ref 必须活在单例 */
export const previewFrame = ref<HTMLIFrameElement | null>(null)

/**
 * 截图前等待：iframe 内所有 <img> 完成（load/error 都算就绪）+ 字体就绪 + 一帧渲染。
 * 否则外链图片未加载完就 snapdom，导出 PNG 全是灰占位（2026-11-16 用户实测反馈）。
 * 整体 15s 超时兜底：个别图片挂了不阻断截图（该图位置灰块，用户可感知重试）。
 */
async function waitForAssets(doc: Document, timeoutMs = 15_000): Promise<void> {
  const imgs = Array.from(doc.images ?? [])
  const settle = Promise.all(imgs.map((img) => {
    if (img.complete) return Promise.resolve()
    return new Promise<void>((res) => {
      img.addEventListener('load', () => res(), { once: true })
      img.addEventListener('error', () => res(), { once: true })
    })
  }))
  const fonts: Promise<unknown> = (doc as Document & { fonts?: { ready: Promise<unknown> } }).fonts?.ready ?? Promise.resolve()
  await Promise.race([
    Promise.all([settle, fonts]),
    new Promise<void>((res) => setTimeout(res, timeoutMs)),
  ])
  await new Promise<void>((res) => requestAnimationFrame(() => res()))
}

async function captureDataUrl(): Promise<string> {
  const frame = previewFrame.value
  if (!frame) throw new Error('预览未就绪')
  const doc = frame.contentDocument
  const target = doc?.body
  if (!target || target.children.length === 0) throw new Error('预览内容为空')
  await waitForAssets(doc!)
  // 邮件 HTML 的白底多为浏览器默认而非显式样式；snapdom 克隆渲染无「文档默认背景」，
  // 未显式设背景的区域导出 PNG 变透明 alpha（深色查看器里就是灰底，2026-11-16 用户实测）。
  // 双保险：① computed 背景为透明的文档根/body 兜底铺白（只在真透明时设，避免内联样式覆盖类背景）；
  // ② snapdom backgroundColor 选项显式合成白底。
  const isTransparent = (el: Element): boolean => {
    const bg = getComputedStyle(el).backgroundColor
    return bg === 'transparent' || bg === 'rgba(0, 0, 0, 0)'
  }
  if (isTransparent(doc!.documentElement)) doc!.documentElement.style.backgroundColor = '#ffffff'
  if (isTransparent(target) && isTransparent(doc!.documentElement)) target.style.backgroundColor = '#ffffff'
  const capture = await (snapdom as unknown as (el: Element, opts?: Record<string, unknown>) => Promise<unknown>)(target, { scale: captureScale.value, backgroundColor: '#ffffff' })
  const out = await (capture as { toPng?: () => Promise<unknown> }).toPng?.()
  const dataUrl = typeof out === 'string' ? out : ((out as { src?: string })?.src ?? '')
  if (dataUrl === '') throw new Error('截图失败：未获得图像数据')
  return dataUrl
}

/** 截图并覆盖写 poster.png（产物目录；海报列表「图片」列读取）。
 *  门控（用户 2026-11-19）：生成后才可截图——草稿（只保存过名称）没有 badge 副本不可截。 */
export async function capturePoster(): Promise<void> {
  if (!currentGenerated.value) {
    ElMessage.warning('请先生成海报（有 badge 副本后才能截图）')
    return
  }
  capturing.value = true
  try {
    const base64 = (await captureDataUrl()).split(',')[1] ?? ''
    const rel = await host.badge.savePosterPng({ posterId: currentPosterId.value, base64 })
    ElMessage.success(`海报已保存：${rel}`)
    await loadPosters()
  } catch (err) {
    ElMessage.error(`截图失败：${(err as Error).message}`)
  } finally {
    capturing.value = false
  }
}

/** 项4：数据源模板下载——默认 xlsx，下拉可选 csv/json；表头+示例行+填写说明由主进程生成 */
export async function downloadTemplate(fmt: 'xlsx' | 'csv' | 'json' = 'xlsx'): Promise<void> {
  try {
    const { base64, fileName } = await host.badge.templateDownload(fmt)
    const ext = fmt
    const save = await host.os.pickSave({
      fileName,
      extensions: [ext === 'json' ? 'json' : ext],
    })
    if (!save) return
    await host.os.writeBinary(save, base64)
    ElMessage.success(`模板已下载：${save}`)
  } catch (err) {
    ElMessage.error(`模板下载失败：${(err as Error).message}`)
  }
}

/** 下载 = 截图 + 下载；落盘位置由用户保存对话框决定。
 *  门控（用户 2026-11-19）：生成后才可下载——不再自动触发生成。 */
export const downloading = ref(false)
export async function downloadPoster(): Promise<void> {
  if (!currentGenerated.value) {
    ElMessage.warning('请先生成海报（下载 = 截图 + 下载，需先有 badge 副本）')
    return
  }
  downloading.value = true
  try {
    const base64 = (await captureDataUrl()).split(',')[1] ?? ''
    const poster = posters.value.find((row) => row._id === currentPosterId.value)
    const save = await host.os.pickSave({ fileName: (poster?.name || 'poster') + '.png', extensions: ['png'] })
    if (!save) return
    await host.os.writeBinary(save, base64)
    ElMessage.success('已下载：' + save)
    await loadPosters()
  } catch (err) {
    ElMessage.error(`下载失败：${(err as Error).message}`)
  } finally {
    downloading.value = false
  }
}

/** 预览与编辑共用：完整载入该海报的全部已知信息到工作区（回路完整） */
export async function loadPosterIntoWorkspace(row: PosterRecord): Promise<void> {
  // 草稿海报（保存了名字还没生成）：无源 HTML，只回显名称/配置，其余保持空工作区
  if (row.source.htmlPath) {
    try {
      const { html } = await host.badge.readHtml(row.source.htmlPath)
      pastedHtml.value = html
      statRows.value = toStatRows(row.statsSnapshot ?? [], [])
      // 标记核对数据回显（用户 2026-11-17：标记数据随海报保存）；
      // 2026-11-18 起落库为数组形态（url 含「.」不能作 Mongo 字段键），兼容旧 Record 形态
      const savedMarks = (row as PosterRecord & { markCounts?: Array<{ url: string; count: number }> | Record<string, number> }).markCounts
      if (savedMarks) {
        const marks = Array.isArray(savedMarks)
          ? Object.fromEntries(savedMarks.map((m) => [m.url, m.count]))
          : savedMarks
        for (const r of statRows.value) r.matched = marks[r.url] ?? 0
      }
    } catch (err) {
      ElMessage.error('载入海报失败：' + (err as Error).message)
      return
    }
    syncCsvFromRows()
  }
  // 已知信息全量回显：名称 / 属性 / 数值列 / 海报尺寸 / 截图像素比 / 角标位置
  posterName.value = row.name
  badgeAttr.value = row.configSnapshot.badgeAttr || badgeAttr.value
  clicksField.value = row.configSnapshot.clicksField || clicksField.value
  posterWidth.value = row.configSnapshot.posterWidth || posterWidth.value
  captureScale.value = row.configSnapshot.scale || captureScale.value
  badgePositionText.value = String(row.configSnapshot.badgePositionText ?? '') || badgePositionText.value
  badgePositionImage.value = String(row.configSnapshot.badgePositionImage ?? '') || badgePositionImage.value
  currentPosterId.value = row._id
  htmlPath.value = ''
  // N5：编辑 mail 型海报时保持衍生关系，重生成不丢 mailId
  sourceMailId.value = row.source.type === 'mail' ? (row.source.mailId ?? null) : null
  if (row.outputs.badged) {
    try {
      // 点击编辑即展示该海报的 badge 预览
      const { html: badged } = await host.badge.readHtml(row.outputs.badged)
      previewHtml.value = badged
    } catch { /* 预览读取失败不阻塞编辑 */ }
  }
  snapshotWorkspaceBaseline() // 载入即基线：此后工作区变化才计入 dirty
}

// ── 返回列表的未保存修改检测（用户 2026-11-18：返回时二次确认，保存/丢弃/留页由用户抉择）──
// 基线分两组：meta（保存修改即持久化）与 content（仅生成时持久化到产物/快照）。
interface WorkspaceBaseline {
  name: string; badgeAttr: string; posText: string; posImage: string; clicksField: string
  html: string; stats: string; rows: number
}
let metaBaseline: WorkspaceBaseline | null = null
let contentBaseline: WorkspaceBaseline | null = null

function takeBaseline(): WorkspaceBaseline {
  return {
    name: posterName.value,
    badgeAttr: badgeAttr.value,
    posText: badgePositionText.value,
    posImage: badgePositionImage.value,
    clicksField: clicksField.value,
    html: pastedHtml.value,
    stats: pastedStats.value,
    rows: statRows.value.length,
  }
}
function snapshotAll(): void { metaBaseline = takeBaseline(); contentBaseline = takeBaseline() }

/** 进入生成页（应用启动/新建/载入海报）时记录基线；生成成功也重置（生成即保存了内容与配置） */
export function snapshotWorkspaceBaseline(): void { snapshotAll() }

/** 工作区是否有未保存/未生成的修改 */
export function workspaceDirty(): boolean {
  const cur = takeBaseline()
  const metaDirty = !metaBaseline || cur.name !== metaBaseline.name || cur.badgeAttr !== metaBaseline.badgeAttr
    || cur.posText !== metaBaseline.posText || cur.posImage !== metaBaseline.posImage || cur.clicksField !== metaBaseline.clicksField
  const contentDirty = !contentBaseline || cur.html !== contentBaseline.html || cur.stats !== contentBaseline.stats || cur.rows !== contentBaseline.rows
  return metaDirty || contentDirty
}

/** 返回列表：dirty 时二次确认（保存并返回 / 不保存直接返回 / 留页），路由跳转由调用方（壳组件）执行 */
export async function backToListConfirm(): Promise<boolean> {
  if (!workspaceDirty()) return true
  try {
    await ElMessageBox.confirm(
      '当前工作区有未保存的修改（或已修改但未重新生成）。返回列表前要保存吗？',
      '未保存的修改',
      {
        type: 'warning',
        confirmButtonText: '保存并返回',
        cancelButtonText: '不保存返回',
        // 关闭（X/ESC）= 留在本页继续编辑
        distinguishCancelAndClose: true,
        closeOnClickModal: false, closeOnPressEscape: false,
      },
    )
    await savePosterMeta()
    return true
  } catch (action) {
    if (action === 'cancel') return true // 不保存直接返回
    return false // close = 留在页面
  }
}

// ── 新建海报（用户 2026-11-18 列表页入口）：清空工作区开新海报，路由跳转由调用方（壳组件）执行 ──

/** 清空海报工作区（不触配置/列表），并重置 dirty 基线 */
function clearPosterWorkspace(): void {
  posterName.value = ''
  htmlPath.value = ''
  pastedHtml.value = ''
  sourceMailId.value = null
  statsFile.value = ''
  pastedStats.value = ''
  statRows.value = []
  statsWarnings.value = []
  definedMetrics.value = []
  previewHtml.value = ''
  currentPosterId.value = ''
  imageFiles.value = []
  snapshotWorkspaceBaseline()
}

/** 新建海报：工作区有内容（dirty 或已载入海报）时二次确认丢弃，确认后清空并返回 true */
export async function startNewPosterConfirm(): Promise<boolean> {
  if (workspaceDirty() || currentPosterId.value || hasHtml.value) {
    try {
      await ElMessageBox.confirm(
        '当前工作区有内容，新建海报会清空未保存的修改。确认继续吗？',
        '新建海报',
        {
          confirmButtonText: '确认新建', cancelButtonText: '取消', type: 'warning',
          closeOnClickModal: false, closeOnPressEscape: false,
        },
      )
    } catch { return false }
  }
  clearPosterWorkspace()
  return true
}
