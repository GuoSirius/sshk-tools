import { computed, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { snapdom } from '@zumer/snapdom'
import { DEFAULT_OCR_LAYOUT, parseCsvText, rowsToCsv, toStatRows } from '@sshk/badge-studio'
import type { OcrLayoutConfig, StatRow } from '@sshk/badge-studio'
import type { LlmProviderInfo } from '@sshk/shared'

/**
 * Badge Studio 共享状态（模块级单例）：
 * - toolId 由壳注入（单一来源 = manifest.id → 宿主 :tool-id prop），config key 动态拼装，源码零硬编码；
 * - 工作区（HTML / 统计表 / 识别配置）与海报列表跨页共享：
 *   「编辑」从海报列表跳回生成页并回填工作区，状态必须活在单例里而非页面组件内。
 */
export const toolId = ref('')

export function configKey(key: string): string {
  return `tools.${toolId.value}.${key}`
}

export interface RecentHtml {
  path: string
  name: string
  usedAt: string
}

// ── 角标 / URL 归一 / 海报尺寸：全部来自工具配置，生成页不写死 ──
export const badgeAttr = ref('data-edm-badge')
export const badgeStyle = reactive({ background: '#e60012', color: '#fff', size: 18, offsetY: -9, offsetX: -11 })
export const posterName = ref('')
export const badgePositionText = ref('top-right')
export const badgePositionImage = ref('center')
export const badgePositionOptions = [
  { label: '左上', value: 'top-left' }, { label: '上中', value: 'top-center' }, { label: '右上', value: 'top-right' },
  { label: '左中', value: 'left-center' }, { label: '居中', value: 'center' }, { label: '右中', value: 'right-center' },
  { label: '左下', value: 'bottom-left' }, { label: '下中', value: 'bottom-center' }, { label: '右下', value: 'bottom-right' },
]
export const urlNorm = reactive({ stripUtm: true, stripHash: true, stripTrailingSlash: true, sortQuery: true, lowercaseHost: true })
export const posterWidth = ref(680)
export const captureScale = ref(2)
/** 角标取值列：可填 clicks / totalClicks / 任意自定义数值列名 */
export const clicksField = ref('clicks')

// ── HTML 输入：选择文件 / 粘贴源码（二选一）；最近使用是持久化在本机配置里的历史记录 ──
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

// ── 图片识别：模型复用应用级 Provider，工具不再配置 baseURL / apiKey ──
// 注意：vision / imageThumbs 用 ref 而非 reactive——volar 对「导入的 reactive 对象」
// 在模板里会错误地做 ref 解包（成员访问被改写成 .value），ref 则一切正常。
export const vision = ref({
  provider: 'cloud' as 'cloud' | 'paddleocr' | 'manual',
  paddleCommand: '',
  paddleArgs: '{image}',
})
export const providers = ref<LlmProviderInfo[]>([])
export const visionProviderId = ref('')
export const visionModel = ref('')
export const modelOptions = ref<string[]>([])
export const modelsLoading = ref(false)
export const imageFiles = ref<string[]>([])
export const imageThumbs = ref<Record<string, string>>({})
export const previewList = computed(() => imageFiles.value.map((file) => imageThumbs.value[file] ?? ''))
export async function loadThumb(file: string): Promise<void> {
  if (imageThumbs.value[file]) return
  try {
    imageThumbs.value[file] = await window.api.os.readDataUri(file)
  } catch (err) {
    ElMessage.warning('图片预览加载失败：' + (err as Error).message)
  }
}
export const recognizing = ref(false)
export const visionRaw = ref('')
export const ocrLayout = reactive<OcrLayoutConfig>({ ...DEFAULT_OCR_LAYOUT })
export const activeProvider = computed(() => providers.value.find((p) => p._id === visionProviderId.value) ?? null)

// ── 生成结果 / 海报列表 ──
export const generating = ref(false)
export const currentPosterId = ref('')
export const previewHtml = ref('')
export const capturing = ref(false)
export const posters = ref<PosterRecord[]>([])
export const listLoading = ref(false)
// 表格布局三段式：顶部操作 / 中间表格撑满滚动 / 底部分页；跨页勾选由 reserve-selection 保留
export const currentPage = ref(1)
export const pageSize = ref(10)
export const pagedPosters = computed(() => posters.value.slice((currentPage.value - 1) * pageSize.value, currentPage.value * pageSize.value))
export function onPageChange(): void { selectedPosters.value = selectedPosters.value.filter((s) => posters.value.some((p) => p._id === s._id)) }

export const hasHtml = computed(() => htmlPath.value !== '' || pastedHtml.value.trim() !== '')
export const hasStats = computed(() => statRows.value.length > 0)
/** 列定义 + 实际数据里的自定义列并集，保证空表格也能先建列 */
export const customMetricKeys = computed(() => Array.from(new Set([
  ...definedMetrics.value,
  ...statRows.value.flatMap((row) => Object.keys(row.metrics ?? {})),
])))
export const fieldOptions = computed(() => Array.from(new Set(['clicks', 'totalClicks', ...customMetricKeys.value])))

/** 本机自查命令：三项信息都由用户自己跑出来，宿主不猜 */
export const selfCheckCommand = computed(() => {
  const py = `"${vision.value.paddleCommand || '<python.exe 绝对路径>'}"`
  const adapter = '<paddleocr_adapter.py 绝对路径>'
  return [
    '# 1. 确认 Anaconda 环境的 python.exe 绝对路径',
    'where python',
    'python -c "import sys; print(sys.executable)"',
    '',
    '# 2. 用同一个解释器确认 Paddle / PaddleOCR 版本与实际调用方式',
    `${py} ${adapter} --self-check`,
    '',
    '# 3. 用一张真实截图试跑，把 stdout 原文贴回来校准版式',
    `${py} ${adapter} "C:\\path\\to\\screenshot.png" --layout '${JSON.stringify(ocrLayout)}'`,
  ].join('\n')
})

async function textConfig(key: string, fallback: string): Promise<string> {
  const value = await window.api.config.get(configKey(key))
  return typeof value === 'string' && value.trim() ? value : fallback
}

export async function loadConfigAndRecent(): Promise<void> {
  badgeAttr.value = await textConfig('badgeAttr', 'data-edm-badge')
  clicksField.value = await textConfig('clicksField', 'clicks')
  const savedStyle = (await window.api.config.get(configKey('badgeStyle'))) as Partial<typeof badgeStyle> | null
  if (savedStyle && typeof savedStyle === 'object') Object.assign(badgeStyle, savedStyle)
  badgePositionText.value = await textConfig('badgePositionText', 'top-right')
  badgePositionImage.value = await textConfig('badgePositionImage', 'center')
  const savedNorm = (await window.api.config.get(configKey('urlNorm'))) as Partial<typeof urlNorm> | null
  if (savedNorm && typeof savedNorm === 'object') Object.assign(urlNorm, savedNorm)
  posterWidth.value = Number(await window.api.config.get(configKey('posterWidth'))) || 680
  captureScale.value = Number(await window.api.config.get(configKey('scale'))) || 2
  const recent = (await window.api.config.get(configKey('recentHtmls'))) as RecentHtml[] | null
  recentHtmls.value = Array.isArray(recent) ? recent : []
  const provider = await textConfig('vision.provider', 'cloud')
  vision.value.provider = provider === 'paddleocr' || provider === 'manual' ? provider : 'cloud'
  vision.value.paddleCommand = await textConfig('vision.paddleCommand', 'python')
  vision.value.paddleArgs = await textConfig('vision.paddleArgs', '{image}')
  const savedLayout = (await window.api.config.get(configKey('ocrLayout'))) as Partial<OcrLayoutConfig> | null
  if (savedLayout && typeof savedLayout === 'object') Object.assign(ocrLayout, savedLayout)
  await loadProviders()
}

export async function loadProviders(): Promise<void> {
  providers.value = await window.api.llm.providers().catch(() => [])
  if (!visionProviderId.value) {
    const active = await window.api.config.get('app.llm.activeProviderId')
    visionProviderId.value = (typeof active === 'string' && active)
      || (await textConfig('vision.providerId', ''))
      || providers.value.find((p) => p.enabled)?._id
      || ''
  }
  visionModel.value = (await textConfig('vision.modelOverride', '')) || activeProvider.value?.model || ''
  modelOptions.value = activeProvider.value?.model ? [activeProvider.value.model] : []
}

export function onProviderChange(): void {
  visionModel.value = activeProvider.value?.model ?? ''
  modelOptions.value = activeProvider.value?.model ? [activeProvider.value.model] : []
}

export async function fetchProviderModels(): Promise<void> {
  if (!visionProviderId.value) {
    ElMessage.warning('请先在「模型控制台」新增 Provider')
    return
  }
  modelsLoading.value = true
  try {
    const list = await window.api.llm.providerModels(visionProviderId.value)
    modelOptions.value = Array.from(new Set([...modelOptions.value, ...list.filter(Boolean)]))
    if (!visionModel.value && modelOptions.value[0]) visionModel.value = modelOptions.value[0]
    ElMessage.success(`拉取到 ${list.length} 个模型`)
  } catch (err) {
    ElMessage.warning(`模型列表拉取失败：${(err as Error).message}；可手动输入模型名`)
  } finally {
    modelsLoading.value = false
  }
}

export async function rememberRecent(path: string): Promise<void> {
  const name = path.split(/[\\/]/).pop() ?? path
  const next = [{ path, name, usedAt: new Date().toLocaleString('sv-SE') }, ...recentHtmls.value.filter((r) => r.path !== path)].slice(0, 10)
  recentHtmls.value = next
  await window.api.config.set(configKey('recentHtmls'), next)
}

export async function pickHtml(): Promise<void> {
  const [file] = await window.api.os.pickFile({
    filters: [{ name: '邮件 HTML', extensions: ['html', 'htm'] }],
  })
  if (!file) return
  const { html } = await window.api.badge.readHtml(file)
  pastedHtml.value = html
  htmlPath.value = file
  await rememberRecent(file)
}

export async function useRecent(item: RecentHtml): Promise<void> {
  try {
    const { html } = await window.api.badge.readHtml(item.path)
    htmlPath.value = item.path
    pastedHtml.value = html
  } catch {
    ElMessage.warning('该文件已不存在或被移动，已从最近使用中移除')
    await removeRecent(item)
  }
}

export async function removeRecent(item: RecentHtml): Promise<void> {
  recentHtmls.value = recentHtmls.value.filter((r) => r.path !== item.path)
  await window.api.config.set(configKey('recentHtmls'), recentHtmls.value)
}

export async function clearRecent(): Promise<void> {
  recentHtmls.value = []
  await window.api.config.set(configKey('recentHtmls'), [])
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
  const [file] = await window.api.os.pickFile({
    filters: [{ name: '点击统计', extensions: ['xlsx', 'xls', 'csv', 'tsv', 'json'] }],
  })
  if (!file) return
  try {
    const parsed = (await window.api.badge.parseDatasource(file)) as { rows: StatRow[]; warnings: string[] }
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
  const key = newMetricKey.value.trim()
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
  if (clicksField.value === key) clicksField.value = 'clicks'
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

export async function pickImages(): Promise<void> {
  const files = await window.api.os.pickFile({
    filters: [{ name: '点击统计图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'] }],
    multi: true,
  })
  if (files.length) {
    imageFiles.value = files
    for (const file of files) void loadThumb(file)
  }
}

/** 多张图片逐张识别，结果合并进同一张可编辑表格，人工核对后才可生成 */
export async function recognizeImages(): Promise<void> {
  if (imageFiles.value.length === 0) {
    ElMessage.warning('请先选择至少一张点击统计截图 / 表格图片')
    return
  }
  if (vision.value.provider === 'manual') {
    ElMessage.info('当前为「仅人工校对」模式，请在上方文本框粘贴 CSV')
    return
  }
  if (vision.value.provider === 'cloud' && !visionProviderId.value) {
    ElMessage.warning('请先在「模型控制台」配置 Provider，再在这里选择')
    return
  }
  recognizing.value = true
  const collected: StatRow[] = []
  const warnings: string[] = []
  const raws: string[] = []
  try {
    for (const file of imageFiles.value) {
      const result = await window.api.badge.parseImage({
        file,
        provider: vision.value.provider,
        providerId: vision.value.provider === 'cloud' ? visionProviderId.value : undefined,
        model: vision.value.provider === 'cloud' ? visionModel.value : undefined,
        paddleCommand: vision.value.paddleCommand,
        paddleArgs: vision.value.paddleArgs,
        ocrLayout: vision.value.provider === 'paddleocr' ? { ...ocrLayout } : undefined,
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

/** 图片识别配置就地保存：不再跳工具配置页，识别方式 / Provider / 模型 / OCR 命令一处改完 */
/** 路径类配置统一交互：选择 + 可手动修改 */
export async function pickPython(): Promise<void> {
  const [file] = await window.api.os.pickFile({
    filters: [{ name: 'Python 解释器', extensions: ['exe'] }],
  })
  if (file) vision.value.paddleCommand = file
}

export async function saveVisionConfig(): Promise<void> {
  try {
    await window.api.config.set(configKey('vision'), {
      provider: vision.value.provider,
      providerId: visionProviderId.value,
      modelOverride: visionModel.value,
      paddleCommand: vision.value.paddleCommand,
      paddleArgs: vision.value.paddleArgs,
    })
    ElMessage.success('图片识别配置已保存为默认（OCR 版式仍在「工具配置 → OCR 截图版式」）')
  } catch (err) {
    ElMessage.error(`保存失败：${(err as Error).message}`)
  }
}

export async function copySelfCheck(): Promise<void> {
  await window.api.os.clipboardWrite(selfCheckCommand.value)
  ElMessage.success('自查命令已复制，请在 Anaconda 环境执行并把结果填入工具配置')
}

/** 批量补属性：给命中但未带 badgeAttr 的链接补上（只在生成的副本里生效，原文件不动） */
export async function markBeforeGenerate(): Promise<void> {
  if (!hasHtml.value || !hasStats.value) return
  pastedHtml.value = await window.api.badge.markBadges({ html: pastedHtml.value, stats: statRows.value, badgeAttr: badgeAttr.value })
  ElMessage.success('已在工作区副本中补齐 badge 属性，可直接生成')
}

export async function generate(): Promise<void> {
  if (!hasHtml.value) {
    ElMessage.warning('请先选择或粘贴邮件 HTML')
    return
  }
  if (!hasStats.value) {
    ElMessage.warning('请先解析点击统计数据')
    return
  }
  generating.value = true
  try {
    const name = posterName.value.trim() || htmlPath.value.split(/[\\/]/).pop()?.replace(/\.html?$/i, '') || `海报 ${new Date().toLocaleString('sv-SE')}`
    const res = await window.api.badge.generate({
      name,
      sourceHtml: pastedHtml.value,
      stats: statRows.value,
      statsFileRel: statsFile.value,
      posterId: currentPosterId.value || undefined,
      config: {
        badgeAttr: badgeAttr.value,
        clicksField: clicksField.value,
        urlNorm: { ...urlNorm },
        badgeStyle: { ...badgeStyle },
        defaultPositions: { text: badgePositionText.value as never, image: badgePositionImage.value as never },
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
    await loadPosters()
  } catch (err) {
    ElMessage.error((err as Error).message)
  } finally {
    generating.value = false
  }
}

export async function loadPosters(): Promise<void> {
  listLoading.value = true
  try {
    posters.value = (await window.api.badge.listPosters()).filter((p) => !p.archived)
  } finally {
    listLoading.value = false
  }
}

// ── 海报列表管理：多选 / 编辑载入 / 导出 / 批量删除导出（交互范本，EDM 复用） ──
export const selectedPosters = ref<PosterRecord[]>([])
export function onSelectionChange(rows: PosterRecord[]): void { selectedPosters.value = rows }

export async function exportPosterHtml(row: PosterRecord): Promise<void> {
  if (!row.outputs.badged) return
  const posterDir = (await window.api.config.get(configKey('posterDir'))) as string | null
  const save = await window.api.os.pickSave({
    fileName: (row.name || 'poster') + '.zip',
    extensions: ['zip'],
    defaultPath: posterDir || undefined,
  })
  if (!save) return
  const { outPath, posters: count } = (await window.api.badge.exportFiles({ posterIds: [row._id], outPath: save })) as { outPath: string; posters: number }
  ElMessage.success('已导出 ' + count + ' 个海报（HTML + 长图）：' + outPath)
}

export async function batchExportHtml(): Promise<void> {
  const rows = selectedPosters.value.filter((row) => row.outputs.badged)
  if (rows.length === 0) { ElMessage.warning('请先勾选要导出的海报')
    return }
  const date = new Date().toLocaleDateString('sv-SE')
  const posterDir = (await window.api.config.get(configKey('posterDir'))) as string | null
  const save = await window.api.os.pickSave({
    fileName: 'sshk-posters-' + date + '.zip',
    extensions: ['zip'],
    defaultPath: posterDir || undefined,
  })
  if (!save) return
  const { outPath, posters: count } = (await window.api.badge.exportFiles({ posterIds: rows.map((row) => row._id), outPath: save })) as { outPath: string; posters: number }
  ElMessage.success('已批量导出 ' + count + ' 个海报（HTML + 长图，按名称分目录）：' + outPath)
}

/** 只保存名称与角标配置（含位置），不触发重新生成 */
export async function savePosterMeta(): Promise<void> {
  if (!currentPosterId.value) { ElMessage.warning('新海报请先生成一次，再使用保存修改'); return }
  try {
    await window.api.badge.savePosterMeta({
      posterId: currentPosterId.value,
      name: posterName.value.trim() || undefined,
      configSnapshot: {
        badgeAttr: badgeAttr.value,
        clicksField: clicksField.value,
        badgePositionText: badgePositionText.value,
        badgePositionImage: badgePositionImage.value,
      },
    })
    ElMessage.success('已保存修改（名称与角标配置），无需重新生成')
    await loadPosters()
  } catch (err) {
    ElMessage.error('保存失败：' + (err as Error).message)
  }
}

export function onPosterCommand(cmd: string, row: PosterRecord): void {
  if (cmd === 'copy') void copyCode(row)
  else if (cmd === 'delete') { deleteTarget.value = row; deleteOpen.value = true }
}

export async function batchDeletePosters(): Promise<void> {
  const rows = selectedPosters.value
  if (rows.length === 0) { ElMessage.warning('请先勾选要删除的海报')
    return }
  for (const row of rows) await window.api.badge.deletePoster(row._id)
  ElMessage.success('已删除 ' + rows.length + ' 个')
  selectedPosters.value = []
  await loadPosters()
}

export async function copyCode(row: PosterRecord): Promise<void> {
  if (!row.outputs.badged) return
  const { html } = await window.api.badge.readHtml(row.outputs.badged)
  await window.api.os.clipboardWrite(html)
  ElMessage.success('badged.html 代码已复制')
}

export const deleteOpen = ref(false)
export const deleteTarget = ref<PosterRecord | null>(null)

export async function confirmDelete(): Promise<void> {
  if (deleteTarget.value) {
    await window.api.badge.deletePoster(deleteTarget.value._id)
    await loadPosters()
    ElMessage.success('已删除（产物文件保留）')
  }
  deleteOpen.value = false
}

/** 预览 iframe：生成页通过同名 ref 绑定写入；截图按钮在壳 actions 槽，故 ref 必须活在单例 */
export const previewFrame = ref<HTMLIFrameElement | null>(null)

/** snapdom 截长图 → base64 → 覆盖写 poster.png */
export async function capturePoster(): Promise<void> {
  const frame = previewFrame.value
  if (!frame || !currentPosterId.value) {
    ElMessage.warning('请先生成海报')
    return
  }
  capturing.value = true
  try {
    const doc = frame.contentDocument
    const target = doc?.body
    if (!target || target.children.length === 0) throw new Error('预览内容为空')
    const capture = (await (snapdom as unknown as (el: Element, opts?: Record<string, unknown>) => Promise<unknown>)(target, { scale: captureScale.value }))
    const out = await (capture as { toPng?: () => Promise<unknown> }).toPng?.()
    const dataUrl = typeof out === 'string' ? out : ((out as { src?: string })?.src ?? '')
    if (dataUrl === '') throw new Error('截图失败：未获得图像数据')
    const base64 = dataUrl.split(',')[1] ?? ''
    const rel = await window.api.badge.savePosterPng({ posterId: currentPosterId.value, base64 })
    ElMessage.success(`海报已保存：${rel}`)
    await loadPosters()
  } catch (err) {
    ElMessage.error(`截图失败：${(err as Error).message}`)
  } finally {
    capturing.value = false
  }
}

/** 预览与编辑共用：完整载入该海报的全部已知信息到工作区（回路完整） */
export async function loadPosterIntoWorkspace(row: PosterRecord): Promise<void> {
  if (!row.source.htmlPath) return
  try {
    const { html } = await window.api.badge.readHtml(row.source.htmlPath)
    pastedHtml.value = html
    statRows.value = toStatRows(row.statsSnapshot ?? [], [])
  } catch (err) {
    ElMessage.error('载入海报失败：' + (err as Error).message)
    return
  }
  syncCsvFromRows()
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
  if (row.outputs.badged) {
    try {
      // 点击编辑即展示该海报的 badge 预览
      const { html: badged } = await window.api.badge.readHtml(row.outputs.badged)
      previewHtml.value = badged
    } catch { /* 预览读取失败不阻塞编辑 */ }
  }
}
