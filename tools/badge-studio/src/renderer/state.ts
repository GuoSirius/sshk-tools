import { computed, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { snapdom } from '@zumer/snapdom'
import { DEFAULT_OCR_LAYOUT, parseCsvText, rowsToCsv, sanitizeMetricKey, toStatRows } from '@sshk/badge-studio'
import type { OcrLayoutConfig, StatRow } from '@sshk/badge-studio'
import type { LlmProviderInfo, ShareRouteInfo } from '@sshk/shared'
import { IPC_CHANNELS, SHARE_PERMANENT_EXPIRES_AT } from '@sshk/shared'
import { callHostApi, readShareTicket, type HostApiSpec } from '@sshk/ui-kit'
import { host } from './host'

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
// C-Q1（2026-11-16 拍板）：PaddleOCR 搁置 + 界面抹除——provider 只剩 cloud/manual；
// 已存的 paddleocr 配置回落 cloud（数据不清，将来恢复零成本，见 plans/06 §五）。
export const vision = ref({
  provider: 'cloud' as 'cloud' | 'manual',
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
    imageThumbs.value[file] = await host.os.readDataUri(file)
  } catch (err) {
    ElMessage.warning('图片预览加载失败：' + (err as Error).message)
  }
}
export const recognizing = ref(false)
export const visionRaw = ref('')
export const ocrLayout = reactive<OcrLayoutConfig>({ ...DEFAULT_OCR_LAYOUT }) // 配置兼容保留（UI 已抹除，恢复零成本）
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
/** 用户 2026-11-19 流程门控：当前工作区海报是否「已生成」（存在 badge 副本产物）。
 *  只填海报名点保存创建的草稿记录没有 outputs.badged → 截图/下载/分享保持禁用；
 *  生成成功（或编辑已生成海报回显）后置真。 */
export const currentGenerated = computed(() => {
  const row = posters.value.find((p) => p._id === currentPosterId.value)
  return Boolean(row?.outputs?.badged)
})
/** 列定义 + 实际数据里的自定义列并集，保证空表格也能先建列 */
export const customMetricKeys = computed(() => Array.from(new Set([
  ...definedMetrics.value,
  ...statRows.value.flatMap((row) => Object.keys(row.metrics ?? {})),
])))
export const fieldOptions = computed(() => Array.from(new Set(['clicks', 'totalClicks', ...customMetricKeys.value])))

/** 本机自查命令已随 C-Q1 UI 抹除下线（保留 ocrLayout 配置兼容，见 plans/06 §五） */

async function textConfig(key: string, fallback: string): Promise<string> {
  const value = await host.config.get(configKey(key))
  return typeof value === 'string' && value.trim() ? value : fallback
}

export async function loadConfigAndRecent(): Promise<void> {
  badgeAttr.value = await textConfig('badgeAttr', 'data-edm-badge')
  clicksField.value = await textConfig('clicksField', 'clicks')
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
  posterWidth.value = Number(await host.config.get(configKey('posterWidth'))) || 680
  captureScale.value = Number(await host.config.get(configKey('scale'))) || 2
  const recent = (await host.config.get(configKey('recentHtmls'))) as RecentHtml[] | null
  recentHtmls.value = Array.isArray(recent) ? recent : []
  // C-Q1：已存的 paddleocr 配置回落 cloud（数据保留，UI 不露出）
  const provider = await textConfig('vision.provider', 'cloud')
  vision.value.provider = provider === 'manual' ? 'manual' : 'cloud'
  vision.value.paddleCommand = await textConfig('vision.paddleCommand', 'python')
  vision.value.paddleArgs = await textConfig('vision.paddleArgs', '{image}')
  const savedLayout = (await host.config.get(configKey('ocrLayout'))) as Partial<OcrLayoutConfig> | null
  if (savedLayout && typeof savedLayout === 'object') Object.assign(ocrLayout, savedLayout)
  await loadProviders()
  snapshotWorkspaceBaseline() // 初始基线：新建海报空工作区，此后变化计入返回列表 dirty
}

export async function loadProviders(): Promise<void> {
  providers.value = await host.llm.providers().catch(() => [])
  if (!visionProviderId.value) {
    const active = await host.config.get('app.llm.activeProviderId')
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
    const list = await host.llm.providerModels(visionProviderId.value)
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
  const files = await host.os.pickFile({
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

/** 图片识别配置就地保存：不再跳工具配置页，识别方式 / Provider / 模型一处改完 */
export async function saveVisionConfig(): Promise<void> {
  try {
    await host.config.set(configKey('vision'), {
      provider: vision.value.provider,
      providerId: visionProviderId.value,
      modelOverride: visionModel.value,
    })
    ElMessage.success('图片识别配置已保存为默认')
  } catch (err) {
    ElMessage.error(`保存失败：${(err as Error).message}`)
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
    const name = posterName.value.trim() || htmlPath.value.split(/[\\/]/).pop()?.replace(/\.html?$/i, '') || `海报 ${new Date().toLocaleString('sv-SE')}`
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

export async function loadPosters(): Promise<void> {
  listLoading.value = true
  try {
    posters.value = ((await host.badge.listPosters()) as PosterRecord[]).filter((p) => !p.archived)
    // N5 源更新检测：mail 型海报对比源邮件当前 sourceHash
    try {
      const res = (await host.badge.sourceState({})) as { rows: { posterId: string; stale: boolean; sourceRel: string | null }[] }
      const map: Record<string, { stale: boolean; sourceRel: string | null }> = {}
      for (const row of res.rows) map[row.posterId] = { stale: row.stale, sourceRel: row.sourceRel }
      sourceStates.value = map
    } catch {
      sourceStates.value = {}
    }
  } finally {
    listLoading.value = false
  }
}

/** N5 行级源状态（stale=源邮件已重新生成）与一键重新打标 */
export const sourceStates = ref<Record<string, { stale: boolean; sourceRel: string | null }>>({})
export const staleCount = computed(() => Object.values(sourceStates.value).filter((s) => s.stale).length)

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

// ── 海报列表管理：多选 / 编辑载入 / 导出 / 批量删除导出（交互范本，EDM 复用） ──
export const selectedPosters = ref<PosterRecord[]>([])
export function onSelectionChange(rows: PosterRecord[]): void { selectedPosters.value = rows }

export async function exportPosterHtml(row: PosterRecord): Promise<void> {
  if (!row.outputs.badged) return
  const posterDir = (await host.config.get(configKey('posterDir'))) as string | null
  const save = await host.os.pickSave({
    fileName: (row.name || 'poster') + '.zip',
    extensions: ['zip'],
    defaultPath: posterDir || undefined,
  })
  if (!save) return
  const { outPath, posters: count } = (await host.badge.exportFiles({ posterIds: [row._id], outPath: save })) as { outPath: string; posters: number }
  ElMessage.success('已导出 ' + count + ' 个海报（HTML + 长图）：' + outPath)
}

export async function batchExportHtml(): Promise<void> {
  const rows = selectedPosters.value.filter((row) => row.outputs.badged)
  if (rows.length === 0) { ElMessage.warning('请先勾选要导出的海报')
    return }
  const date = new Date().toLocaleDateString('sv-SE')
  const posterDir = (await host.config.get(configKey('posterDir'))) as string | null
  const save = await host.os.pickSave({
    fileName: 'sshk-posters-' + date + '.zip',
    extensions: ['zip'],
    defaultPath: posterDir || undefined,
  })
  if (!save) return
  const { outPath, posters: count } = (await host.badge.exportFiles({ posterIds: rows.map((row) => row._id), outPath: save })) as { outPath: string; posters: number }
  ElMessage.success('已批量导出 ' + count + ' 个海报（HTML + 长图，按名称分目录）：' + outPath)
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

export function onPosterCommand(cmd: string, row: PosterRecord): void {
  if (cmd === 'copy') void copyCode(row)
  else if (cmd === 'download-png') void downloadPosterPng(row)
  else if (cmd === 'share') void openShare(row)
  else if (cmd === 'export') void exportPosterHtml(row)
  else if (cmd === 'regenerate') void regeneratePoster(row)
  else if (cmd === 'delete') { deleteTarget.value = row; deleteOpen.value = true }
}

export async function batchDeletePosters(): Promise<void> {
  const rows = selectedPosters.value
  if (rows.length === 0) { ElMessage.warning('请先勾选要删除的海报')
    return }
  for (const row of rows) await host.badge.deletePoster(row._id)
  ElMessage.success('已删除 ' + rows.length + ' 个')
  selectedPosters.value = []
  await loadPosters()
}

export async function copyCode(row: PosterRecord): Promise<void> {
  if (!row.outputs.badged) return
  const { html } = await host.badge.readHtml(row.outputs.badged)
  await host.os.clipboardWrite(html)
  ElMessage.success('badged.html 代码已复制')
}

export const deleteOpen = ref(false)
export const deleteTarget = ref<PosterRecord | null>(null)

export async function confirmDelete(): Promise<void> {
  if (deleteTarget.value) {
    await host.badge.deletePoster(deleteTarget.value._id)
    await loadPosters()
    ElMessage.success('已删除（产物文件保留）')
  }
  deleteOpen.value = false
}

/** 预览 iframe：生成页通过同名 ref 绑定写入；截图按钮在壳 actions 槽，故 ref 必须活在单例 */
export const previewFrame = ref<HTMLIFrameElement | null>(null)

/** snapdom 截长图 → dataUrl（保存 / 下载共用） */
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

/** 表格行下载：导出已截图的 poster.png（条件显示 = outputs.poster 存在） */
export async function downloadPosterPng(row: PosterRecord): Promise<void> {
  if (!row.outputs.poster) { ElMessage.warning('该海报尚未截图保存 PNG'); return }
  const save = await host.os.pickSave({ fileName: (row.name || 'poster') + '.png', extensions: ['png'] })
  if (!save) return
  const { outPath } = await host.badge.downloadPng({ posterId: row._id, outPath: save })
  ElMessage.success('已下载：' + outPath)
}

// ── 海报分享（plans/09 ShareHub）：工具只解析产物绝对路径，分享本体交给宿主 ShareHub + ui-kit ShareDialog ──
/** ShareDialog 参数状态：open 控制显隐，其余为当前海报解析出的绝对路径/标签。 */
export const shareDialog = reactive({
  open: false,
  root: '',
  entry: '',
  label: '',
  loading: false,
})

/** 打开分享对话框：先经 badge main 把 posterId 解析为产物绝对路径（工具最清楚 outputRoot 布局）。
 *  门控（用户 2026-11-19）：生成后才可分享。 */
export async function openShare(poster: Pick<PosterRecord, '_id' | 'name'>): Promise<void> {
  if (!currentGenerated.value) {
    ElMessage.warning('请先生成海报（分享的是 badge 副本产物）')
    return
  }
  shareDialog.loading = true
  try {
    const resolved = await host.badge.shareResolve({ posterId: poster._id }) as { root: string; entry: string; label: string }
    Object.assign(shareDialog, {
      open: true,
      root: resolved.root,
      entry: resolved.entry,
      label: resolved.label || `海报：${poster.name}`,
    })
  } catch (err) {
    ElMessage.error((err as Error).message)
  } finally {
    shareDialog.loading = false
  }
}

// ── 列表级分享 + 行级复制链接（用户 2026-11-18）──────────────────────────
// 顶部「分享列表」= root 为产物根、entry 为空的目录分享（顶部长时效/永久为主）；
// 行「复制链接」优先取该行自己的分享（更多 → 分享页面创建），否则用列表前缀 + 行产物相对路径。

/** shareHub.list 通道 spec：复制前校验路由仍在（撤销/过期不复制死链） */
const SHARE_LIST_SPEC: HostApiSpec = { group: 'shareHub', method: 'list', channel: IPC_CHANNELS.shareHubList, label: '分享路由列表' }
const LIST_SHARE_LABEL = '海报列表'

/** 打开列表分享对话框（右上角「分享列表」）：root=产物根（一份公用票），其 URL 即「短链前缀」；
 *  前缀本身单独打开是目录列表页，但行级「复制链接」永远复制 前缀+本行路径 的直达链接，不是目录。TTL 弹框内自调（0=永久） */
export async function openListShare(): Promise<void> {
  shareDialog.loading = true
  try {
    const resolved = await host.badge.shareResolve({ posterId: '' }) as { root: string; entry: string; label: string }
    Object.assign(shareDialog, { open: true, root: resolved.root, entry: resolved.entry, label: resolved.label })
  } catch (err) {
    ElMessage.error((err as Error).message)
  } finally {
    shareDialog.loading = false
  }
}

/** 校验路由存活并返回路由信息（撤销/过期判死；list 失败时信任本地未过期记录，password 未知按无口令拼） */
async function findAliveRoute(toolId: string, ticket: { id: string; token: string; expiresAt: number }): Promise<ShareRouteInfo | null> {
  if (ticket.expiresAt !== SHARE_PERMANENT_EXPIRES_AT && ticket.expiresAt <= Date.now()) return null
  try {
    const routes = await callHostApi<ShareRouteInfo[]>(SHARE_LIST_SPEC, toolId)
    const hit = routes.find((r) => r.id === ticket.id)
    if (!hit) return null
    if (hit.expiresAt !== SHARE_PERMANENT_EXPIRES_AT && hit.expiresAt <= Date.now()) return null
    return hit
  } catch {
    // list 不可用（如宿主桥接旧）时退化为信任本地票：只保「能复制」，不保口令拼接
    return { id: ticket.id, token: ticket.token, urls: [], expiresAt: ticket.expiresAt, password: '' } as unknown as ShareRouteInfo
  }
}

/** 拼「前缀+相对路径」直达链接：路径逐段编码（中文/空格），带口令的路由补 ?key=（否则 403） */
function buildShareUrl(prefix: string, relPath: string, route: ShareRouteInfo | null): string {
  const base = prefix.replace(/\/+$/, '') + '/' + relPath.split('/').map(encodeURIComponent).join('/')
  const key = route && typeof route.password === 'string' && route.password ? `?key=${encodeURIComponent(route.password)}` : ''
  return base + key
}

/** 行级「复制链接」（用户 2026-11-18 定版）：
 *  ① 本行自己的分享页面（更多→分享页面创建，TTL 自定）存活 → 复制它；
 *  ② 否则用顶部「分享列表」生成的公用前缀 + 本行产物相对路径 → 直达本行的短链；
 *  ③ 都没有 → 引导去生成。绝不复制裸前缀（目录页）链接。 */
export async function copyPosterLink(row: PosterRecord): Promise<void> {
  const resolved = await host.badge.shareResolve({ posterId: row._id }) as { root: string; entry: string; label: string }
  // ① 本行自己的分享
  const own = readShareTicket(toolId.value, resolved.label, resolved.root, resolved.entry)
  const ownRoute = own && await findAliveRoute(toolId.value, own)
  if (own && ownRoute && own.urls[0]) {
    await host.os.clipboardWrite(buildShareUrl(own.urls[0], '', ownRoute))
    ElMessage.success('已复制本海报的专属分享链接')
    return
  }
  // ② 列表分享前缀 + 本行产物相对路径
  const list = readShareTicket(toolId.value, LIST_SHARE_LABEL, resolved.root, '')
  const listRoute = list && await findAliveRoute(toolId.value, list)
  if (list && listRoute && list.urls[0] && resolved.entry) {
    await host.os.clipboardWrite(buildShareUrl(list.urls[0], resolved.entry, listRoute))
    ElMessage.success('已复制分享链接（列表前缀 + 本海报）')
    return
  }
  ElMessage.warning('还没有可用分享：点右上角「分享列表」生成链接前缀，或在「更多 → 分享页面」为本海报单独分享')
}

// ── 列表「链接」列（用户 2026-11-18：产物列取消，改为 可访问性 tag + 链接类型 tag）──
// 链接类型 = 复制链接将使用的来源（自身票优先 → 顶部列表前缀）；可访问性 = 该票是否存活。

const shareRoot = ref('')
const shareRouteRows = ref<ShareRouteInfo[]>([])

/** 刷新分享路由快照（进页面 / 分享弹框关闭后调用） */
export async function refreshShareLinks(): Promise<void> {
  try {
    const resolved = await host.badge.shareResolve({ posterId: '' }) as { root: string }
    shareRoot.value = resolved.root
    shareRouteRows.value = await callHostApi<ShareRouteInfo[]>(SHARE_LIST_SPEC, toolId.value)
  } catch {
    shareRoot.value = ''
    shareRouteRows.value = []
  }
}

function routeAlive(id: string): boolean {
  return shareRouteRows.value.some((r) => r.id === id && (r.expiresAt === SHARE_PERMANENT_EXPIRES_AT || r.expiresAt > Date.now()))
}

/** 行链接状态：类型（自身/顶部/未分享）+ 可访问性（可访问/已失效）。语义与 copyPosterLink 的取链优先级一致 */
export function posterLinkState(row: PosterRecord): { type: '自身' | '顶部' | null; alive: boolean } {
  // 显式建立对路由快照的响应式依赖：refreshShareLinks 每次替换新数组必须触发行内重算——
  // 否则 localStorage 票（非响应式）+ shareRoot 值不变时，新建分享后表格不重渲染、复制链接不出现（2026-11-18 实测根因）
  void shareRouteRows.value
  if (!shareRoot.value) return { type: null, alive: false }
  const entry = (row.outputs.badged ?? '').replaceAll('\\', '/').replace(/^\/+/, '')
  if (!entry) return { type: null, alive: false }
  const own = readShareTicket(toolId.value, `海报：${row.name}`, shareRoot.value, entry)
  const list = readShareTicket(toolId.value, LIST_SHARE_LABEL, shareRoot.value, '')
  const ownAlive = Boolean(own && routeAlive(own.id))
  const listAlive = Boolean(list && routeAlive(list.id))
  if (ownAlive) return { type: '自身', alive: true }
  if (listAlive) return { type: '顶部', alive: true }
  if (own) return { type: '自身', alive: false }
  if (list) return { type: '顶部', alive: false }
  return { type: null, alive: false }
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
