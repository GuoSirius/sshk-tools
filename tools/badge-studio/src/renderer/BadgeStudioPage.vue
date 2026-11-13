<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { snapdom } from '@zumer/snapdom'
import { EmptyState, ConfirmDialog, TimeText, ToolPageLayout } from '@sshk/ui-kit'
import { DEFAULT_OCR_LAYOUT, parseCsvText, rowsToCsv } from '@sshk/badge-studio'
import type { OcrLayoutConfig, StatRow } from '@sshk/badge-studio'
import type { LlmProviderInfo } from '@sshk/shared'

interface RecentHtml {
  path: string
  name: string
  usedAt: string
}

const props = defineProps<{ menu?: string }>()
const view = computed(() => props.menu ?? 'generate')
const badgeAttr = ref('data-edm-badge')
// 角标样式 / URL 归一 / 海报尺寸全部来自工具配置，生成页不再写死
const badgeStyle = reactive({ background: '#e60012', color: '#fff', size: 18, offsetY: -9, offsetX: -11 })
const urlNorm = reactive({ stripUtm: true, stripHash: true, stripTrailingSlash: true, sortQuery: true, lowercaseHost: true })
const posterWidth = ref(680)
const captureScale = ref(2)
/** 角标取值列：可填 clicks / totalClicks / 任意自定义数值列名 */
const clicksField = ref('clicks')

// HTML 输入：选择文件 / 粘贴源码（二选一）；最近使用是持久化在本机配置里的历史记录
const htmlPath = ref('')
const pastedHtml = ref('')
const recentHtmls = ref<RecentHtml[]>([])

// 数据源：文件 / 粘贴文本 / 图片识别，最终统一进同一张可编辑表格
const statsFile = ref('')
const pastedStats = ref('')
const statRows = ref<StatRow[]>([])
const statsWarnings = ref<string[]>([])
const definedMetrics = ref<string[]>([])
const newMetricKey = ref('')

// 图片识别：模型复用应用级 Provider，工具不再配置 baseURL / apiKey
const vision = reactive({
  provider: 'cloud' as 'cloud' | 'paddleocr' | 'manual',
  paddleCommand: '',
  paddleArgs: '{image}',
})
const providers = ref<LlmProviderInfo[]>([])
const visionProviderId = ref('')
const visionModel = ref('')
const modelOptions = ref<string[]>([])
const modelsLoading = ref(false)
const imageFiles = ref<string[]>([])
const recognizing = ref(false)
const visionRaw = ref('')
const ocrLayout = reactive<OcrLayoutConfig>({ ...DEFAULT_OCR_LAYOUT })
const activeProvider = computed(() => providers.value.find((p) => p._id === visionProviderId.value) ?? null)

// 生成结果 / 海报列表
const generating = ref(false)
const currentPosterId = ref('')
const previewHtml = ref('')
const capturing = ref(false)
const posters = ref<PosterRecord[]>([])
const listLoading = ref(false)

const hasHtml = computed(() => htmlPath.value !== '' || pastedHtml.value.trim() !== '')
const hasStats = computed(() => statRows.value.length > 0)
/** 列定义 + 实际数据里的自定义列并集，保证空表格也能先建列 */
const customMetricKeys = computed(() => Array.from(new Set([
  ...definedMetrics.value,
  ...statRows.value.flatMap((row) => Object.keys(row.metrics ?? {})),
])))
const fieldOptions = computed(() => Array.from(new Set(['clicks', 'totalClicks', ...customMetricKeys.value])))

/** 本机自查命令：三项信息都由用户自己跑出来，宿主不猜 */
const selfCheckCommand = computed(() => {
  const py = `"${vision.paddleCommand || '<python.exe 绝对路径>'}"`
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
  const value = await window.api.config.get(`tools.badge-studio.${key}`)
  return typeof value === 'string' && value.trim() ? value : fallback
}

async function loadConfigAndRecent(): Promise<void> {
  badgeAttr.value = await textConfig('badgeAttr', 'data-edm-badge')
  clicksField.value = await textConfig('clicksField', 'clicks')
  const savedStyle = (await window.api.config.get('tools.badge-studio.badgeStyle')) as Partial<typeof badgeStyle> | null
  if (savedStyle && typeof savedStyle === 'object') Object.assign(badgeStyle, savedStyle)
  const savedNorm = (await window.api.config.get('tools.badge-studio.urlNorm')) as Partial<typeof urlNorm> | null
  if (savedNorm && typeof savedNorm === 'object') Object.assign(urlNorm, savedNorm)
  posterWidth.value = Number(await window.api.config.get('tools.badge-studio.posterWidth')) || 680
  captureScale.value = Number(await window.api.config.get('tools.badge-studio.scale')) || 2
  const recent = (await window.api.config.get('tools.badge-studio.recentHtmls')) as RecentHtml[] | null
  recentHtmls.value = Array.isArray(recent) ? recent : []
  const provider = await textConfig('vision.provider', 'cloud')
  vision.provider = provider === 'paddleocr' || provider === 'manual' ? provider : 'cloud'
  vision.paddleCommand = await textConfig('vision.paddleCommand', 'python')
  vision.paddleArgs = await textConfig('vision.paddleArgs', '{image}')
  const savedLayout = (await window.api.config.get('tools.badge-studio.ocrLayout')) as Partial<OcrLayoutConfig> | null
  if (savedLayout && typeof savedLayout === 'object') Object.assign(ocrLayout, savedLayout)
  await loadProviders()
}

async function loadProviders(): Promise<void> {
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

function onProviderChange(): void {
  visionModel.value = activeProvider.value?.model ?? ''
  modelOptions.value = activeProvider.value?.model ? [activeProvider.value.model] : []
}

async function fetchProviderModels(): Promise<void> {
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

async function rememberRecent(path: string): Promise<void> {
  const name = path.split(/[\\/]/).pop() ?? path
  const next = [{ path, name, usedAt: new Date().toLocaleString('sv-SE') }, ...recentHtmls.value.filter((r) => r.path !== path)].slice(0, 10)
  recentHtmls.value = next
  await window.api.config.set('tools.badge-studio.recentHtmls', next)
}

async function pickHtml(): Promise<void> {
  const [file] = await window.api.os.pickFile({
    filters: [{ name: '邮件 HTML', extensions: ['html', 'htm'] }],
  })
  if (!file) return
  const { html } = await window.api.badge.readHtml(file)
  pastedHtml.value = html
  htmlPath.value = file
  await rememberRecent(file)
}

async function useRecent(item: RecentHtml): Promise<void> {
  try {
    const { html } = await window.api.badge.readHtml(item.path)
    htmlPath.value = item.path
    pastedHtml.value = html
  } catch {
    ElMessage.warning('该文件已不存在或被移动，已从最近使用中移除')
    await removeRecent(item)
  }
}

async function removeRecent(item: RecentHtml): Promise<void> {
  recentHtmls.value = recentHtmls.value.filter((r) => r.path !== item.path)
  await window.api.config.set('tools.badge-studio.recentHtmls', recentHtmls.value)
}

async function clearRecent(): Promise<void> {
  recentHtmls.value = []
  await window.api.config.set('tools.badge-studio.recentHtmls', [])
  ElMessage.success('最近使用已清空（只清历史记录，不影响已粘贴的内容）')
}

function syncCsvFromRows(): void {
  pastedStats.value = rowsToCsv(statRows.value)
}

function applyRows(rows: StatRow[], warnings: string[], source = ''): void {
  statRows.value = rows
  statsWarnings.value = warnings
  statsFile.value = source
  definedMetrics.value = Array.from(new Set(rows.flatMap((row) => Object.keys(row.metrics ?? {}))))
  syncCsvFromRows()
}

async function pickStats(): Promise<void> {
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

function parsePastedStats(): void {
  try {
    const warnings: string[] = []
    const rows = parseCsvText(pastedStats.value, warnings)
    applyRows(rows, warnings)
    if (rows.length > 0) ElMessage.success(`解析出 ${rows.length} 行，请在表格中核对`)
  } catch (err) {
    ElMessage.error((err as Error).message)
  }
}

function addRow(): void {
  const metrics: Record<string, number> = {}
  for (const key of customMetricKeys.value) metrics[key] = 0
  statRows.value.push({ url: '', clicks: 0, totalClicks: 0, ...(customMetricKeys.value.length ? { metrics } : {}) })
  syncCsvFromRows()
}
function removeRow(index: number): void {
  statRows.value.splice(index, 1)
  syncCsvFromRows()
}
function clearRows(): void {
  statRows.value = []
  statsWarnings.value = []
  statsFile.value = ''
  pastedStats.value = ''
}
function addMetric(): void {
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
function removeMetric(key: string): void {
  definedMetrics.value = definedMetrics.value.filter((k) => k !== key)
  for (const row of statRows.value) {
    if (!row.metrics) continue
    const { [key]: _, ...rest } = row.metrics
    row.metrics = Object.keys(rest).length ? rest : undefined
  }
  if (clicksField.value === key) clicksField.value = 'clicks'
  syncCsvFromRows()
}
function metricOf(row: StatRow, key: string): number {
  return row.metrics?.[key] ?? 0
}
function setMetric(row: StatRow, key: string, raw: unknown): void {
  const num = Number(raw)
  row.metrics = { ...(row.metrics ?? {}), [key]: Number.isFinite(num) ? Math.round(num) : 0 }
  syncCsvFromRows()
}

async function pickImages(): Promise<void> {
  const files = await window.api.os.pickFile({
    filters: [{ name: '点击统计图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'] }],
    multi: true,
  })
  if (files.length) imageFiles.value = files
}

/** 多张图片逐张识别，结果合并进同一张可编辑表格，人工核对后才可生成 */
async function recognizeImages(): Promise<void> {
  if (imageFiles.value.length === 0) {
    ElMessage.warning('请先选择至少一张点击统计截图 / 表格图片')
    return
  }
  if (vision.provider === 'manual') {
    ElMessage.info('当前为「仅人工校对」模式，请在上方文本框粘贴 CSV')
    return
  }
  if (vision.provider === 'cloud' && !visionProviderId.value) {
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
        provider: vision.provider,
        providerId: vision.provider === 'cloud' ? visionProviderId.value : undefined,
        model: vision.provider === 'cloud' ? visionModel.value : undefined,
        paddleCommand: vision.paddleCommand,
        paddleArgs: vision.paddleArgs,
        ocrLayout: vision.provider === 'paddleocr' ? { ...ocrLayout } : undefined,
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
async function saveVisionConfig(): Promise<void> {
  try {
    await window.api.config.set('tools.badge-studio.vision', {
      provider: vision.provider,
      providerId: visionProviderId.value,
      modelOverride: visionModel.value,
      paddleCommand: vision.paddleCommand,
      paddleArgs: vision.paddleArgs,
    })
    ElMessage.success('图片识别配置已保存为默认（OCR 版式仍在「工具配置 → OCR 截图版式」）')
  } catch (err) {
    ElMessage.error(`保存失败：${(err as Error).message}`)
  }
}

async function copySelfCheck(): Promise<void> {
  await window.api.os.clipboardWrite(selfCheckCommand.value)
  ElMessage.success('自查命令已复制，请在 Anaconda 环境执行并把结果填入工具配置')
}

/** 批量补属性：给命中但未带 badgeAttr 的链接补上（只在生成的副本里生效，原文件不动） */
async function markBeforeGenerate(): Promise<void> {
  if (!hasHtml.value || !hasStats.value) return
  pastedHtml.value = await window.api.badge.markBadges({ html: pastedHtml.value, stats: statRows.value, badgeAttr: badgeAttr.value })
  ElMessage.success('已在工作区副本中补齐 badge 属性，可直接生成')
}

async function generate(): Promise<void> {
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
    const name = htmlPath.value.split(/[\\/]/).pop() ?? `海报 ${new Date().toLocaleString('sv-SE')}`
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
      },
    })
    currentPosterId.value = res.posterId
    previewHtml.value = res.html
    ElMessage.success(`已生成 badge 副本（${res.badgedRel}）`)
    await loadPosters()
  } catch (err) {
    ElMessage.error((err as Error).message)
  } finally {
    generating.value = false
  }
}

/** snapdom 截长图 → base64 → 覆盖写 poster.png */
async function capturePoster(): Promise<void> {
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

async function loadPosters(): Promise<void> {
  listLoading.value = true
  try {
    posters.value = (await window.api.badge.listPosters()).filter((p) => !p.archived)
  } finally {
    listLoading.value = false
  }
}

async function openPoster(row: PosterRecord): Promise<void> {
  if (!row.outputs.badged) return
  const { html } = await window.api.badge.readHtml(row.outputs.badged)
  previewHtml.value = html
  currentPosterId.value = row._id
}

async function copyCode(row: PosterRecord): Promise<void> {
  if (!row.outputs.badged) return
  const { html } = await window.api.badge.readHtml(row.outputs.badged)
  await window.api.os.clipboardWrite(html)
  ElMessage.success('badged.html 代码已复制')
}

const deleteOpen = ref(false)
const deleteTarget = ref<PosterRecord | null>(null)

async function confirmDelete(): Promise<void> {
  if (deleteTarget.value) {
    await window.api.badge.deletePoster(deleteTarget.value._id)
    await loadPosters()
    ElMessage.success('已删除（产物文件保留）')
  }
  deleteOpen.value = false
}

const previewFrame = ref<HTMLIFrameElement | null>(null)

onMounted(() => {
  void loadConfigAndRecent()
  void loadPosters()
})
</script>

<template>
  <ToolPageLayout
    title="Badge Studio"
    description="邮件 HTML + 点击统计（文件 / 粘贴 / 多图识别）→ 可编辑表格人工校对 → 注入 badge 副本 → 海报长图（原文件永不修改）"
  >
    <template #actions>
      <el-button size="small" @click="pickHtml">选择 HTML</el-button>
      <el-button size="small" @click="pickStats">选择数据源</el-button>
      <el-button size="small" :disabled="!hasHtml || !hasStats" @click="markBeforeGenerate">批量补属性</el-button>
      <el-button type="primary" size="small" :loading="generating" :disabled="!hasHtml || !hasStats" @click="generate">
        生成海报
      </el-button>
      <el-button size="small" :loading="capturing" :disabled="!currentPosterId" @click="capturePoster">截图保存 PNG</el-button>
    </template>

    <div v-if="view !== 'posters'" class="badge-grid">
      <div class="col">
        <div class="panel">
          <div class="panel-title">邮件 HTML（只读，不修改原文件）</div>
          <div v-if="recentHtmls.length > 0" class="recent-head">
            <span>最近使用 · 记录在本机配置，刷新后保留</span>
            <el-button size="small" text @click="clearRecent">清空全部</el-button>
          </div>
          <el-select
            v-if="recentHtmls.length > 0"
            size="small"
            placeholder="点选历史记录重新载入文件"
            style="width: 100%; margin-bottom: 8px"
            :model-value="htmlPath"
            @change="(v: string) => { const item = recentHtmls.find(r => r.path === v); if (item) void useRecent(item) }"
          >
            <el-option v-for="r in recentHtmls" :key="r.path" :label="r.name" :value="r.path" />
          </el-select>
          <el-input
            v-model="pastedHtml"
            type="textarea"
            :rows="8"
            placeholder="粘贴邮件 HTML 源码，或点击右上角「选择 HTML」"
          />
          <div v-if="recentHtmls.length > 0" class="recent-row">
            <el-tag
              v-for="r in recentHtmls.slice(0, 4)"
              :key="r.path"
              size="small"
              closable
              style="margin-right: 6px"
              @click="void useRecent(r)"
              @close="void removeRecent(r)"
            >
              {{ r.name }}
            </el-tag>
          </div>
          <div class="hint">标签只是历史路径，不会自动把文件内容恢复到编辑区；点标签才重新读取。文件被移动/删除时会自动移除该记录。</div>
        </div>

        <div class="panel">
          <div class="panel-title">点击统计 · 三种来源统一进可编辑表格</div>
          <el-input
            v-model="pastedStats"
            type="textarea"
            :rows="4"
            placeholder="url,clicks&#10;https://example.com/p/1,12"
          />
          <div class="cfg-row" style="margin-top: 8px">
            <el-button size="small" @click="parsePastedStats">解析文本</el-button>
            <el-button size="small" @click="pickImages">选择图片（可多选）</el-button>
            <el-button size="small" @click="addRow">新增一行</el-button>
            <el-button size="small" text type="danger" :disabled="!hasStats" @click="clearRows">清空表格</el-button>
            <span class="muted">共 {{ statRows.length }} 行{{ statsFile ? ` · 来自 ${statsFile.split(/[\\/]/).pop()}` : '' }}</span>
          </div>
          <div v-if="statsWarnings.length" class="warn">{{ statsWarnings.join('；') }}</div>

          <el-table v-if="hasStats" :data="statRows" size="small" max-height="260" class="stat-table">
            <el-table-column label="URL" min-width="180">
              <template #default="{ row }">
                <el-input v-model="row.url" size="small" @input="syncCsvFromRows" />
              </template>
            </el-table-column>
            <el-table-column label="clicks" width="112">
              <template #default="{ row }">
                <el-input-number v-model="row.clicks" size="small" :min="0" :controls="false" class="num-cell" @change="syncCsvFromRows" />
              </template>
            </el-table-column>
            <el-table-column label="totalClicks" width="120">
              <template #default="{ row }">
                <el-input-number v-model="row.totalClicks" size="small" :min="0" :controls="false" class="num-cell" @change="syncCsvFromRows" />
              </template>
            </el-table-column>
            <el-table-column v-for="key in customMetricKeys" :key="key" min-width="100">
              <template #header>
                <span>{{ key }}</span>
                <el-button size="small" text type="danger" title="移除该列" @click="removeMetric(key)">×</el-button>
              </template>
              <template #default="{ row }">
                <el-input
                  :model-value="metricOf(row, key)"
                  size="small"
                  @input="(v: string) => setMetric(row, key, v)"
                />
              </template>
            </el-table-column>
            <el-table-column label="操作" width="70" fixed="right">
              <template #default="{ $index }">
                <el-button size="small" text type="danger" @click="removeRow($index)">删除</el-button>
              </template>
            </el-table-column>
          </el-table>
          <div class="cfg-row" style="margin-top: 8px">
            <el-input v-model="newMetricKey" size="small" placeholder="自定义数值列名，如 uv / 下单数" style="max-width: 200px" />
            <el-button size="small" @click="addMetric">新增数值列</el-button>
            <span class="muted">表格改动会同步回上方 CSV 文本</span>
          </div>
          <div class="hint">OCR 常把 5 认成 S、0 认成 O；请在表格里逐格核对后再生成，识别结果不会自动生效。</div>
        </div>

        <div class="panel">
          <div class="panel-title">图片识别 · 支持多选（配置就地修改，保存为默认后重启沿用）</div>
          <div class="cfg-row">
            <span>识别方式</span>
            <el-radio-group v-model="vision.provider" size="small">
              <el-radio-button value="cloud">云端模型</el-radio-button>
              <el-radio-button value="paddleocr">本机 PaddleOCR</el-radio-button>
              <el-radio-button value="manual">仅人工校对</el-radio-button>
            </el-radio-group>
          </div>
          <div v-if="imageFiles.length" class="image-list">
            <el-tag
              v-for="(file, index) in imageFiles"
              :key="file"
              size="small"
              closable
              @close="imageFiles.splice(index, 1)"
            >
              {{ file.split(/[\\/]/).pop() }}
            </el-tag>
          </div>

          <template v-if="vision.provider === 'cloud'">
            <div class="cfg-row">
              <span>Provider</span>
              <el-select v-model="visionProviderId" size="small" style="width: 220px" @change="onProviderChange">
                <el-option
                  v-for="p in providers"
                  :key="p._id"
                  :label="`${p.name} · ${p.hasApiKey ? '已配置密钥' : '未配置密钥'}`"
                  :value="p._id"
                />
              </el-select>
              <el-tag size="small" :type="activeProvider?.hasApiKey ? 'success' : 'info'">
                {{ activeProvider?.hasApiKey ? '密钥已从模型控制台复用' : '请先到模型控制台填 API Key' }}
              </el-tag>
            </div>
            <div class="cfg-row">
              <span>模型</span>
              <el-select
                v-model="visionModel"
                size="small"
                filterable
                allow-create
                default-first-option
                :loading="modelsLoading"
                placeholder="下拉选择或手动输入"
                style="width: 240px"
              >
                <el-option v-for="m in modelOptions" :key="m" :label="m" :value="m" />
              </el-select>
              <el-button size="small" :loading="modelsLoading" @click="fetchProviderModels">拉取模型列表</el-button>
              <span class="muted">端点与密钥来自「模型控制台」的同一份 Provider</span>
            </div>
          </template>

          <template v-else-if="vision.provider === 'paddleocr'">
            <div class="cfg-row">
              <span>命令</span>
              <el-input v-model="vision.paddleCommand" size="small" placeholder="Anaconda python.exe 绝对路径" style="width: 250px" />
              <el-input v-model="vision.paddleArgs" size="small" placeholder="{image}（应用自动前置适配器脚本）" style="width: 250px" />
            </div>
            <div class="cfg-row">
              <el-button size="small" @click="copySelfCheck">复制自查命令</el-button>
              <span class="muted">适配器脚本由应用自动托管，参数保持 {image} 即可；Python 路径自查后填入</span>
            </div>
            <details>
              <summary class="muted" style="cursor: pointer">查看自查命令与当前版式</summary>
              <pre class="raw">{{ selfCheckCommand }}</pre>
            </details>
            <div class="hint">版式配置（同行/千分位/合计行/列顺序）会由宿主自动以 --layout 注入适配器；精细版式在「工具配置 → OCR 截图版式」。</div>
          </template>

          <div v-else class="hint">
            仅人工校对：直接在上方粘贴 CSV，或点「新增一行 / 新增数值列」在表格里录入。
          </div>

          <div class="cfg-row">
            <el-button size="small" type="primary" :loading="recognizing" :disabled="imageFiles.length === 0 || vision.provider === 'manual'" @click="recognizeImages">
              识别并追加到表格（{{ imageFiles.length || 0 }} 张）
            </el-button>
            <el-button v-if="vision.provider !== 'manual'" size="small" @click="saveVisionConfig">保存为默认配置</el-button>
            <span class="muted" v-if="vision.provider !== 'manual'">不保存则本次会话内有效</span>
          </div>

          <details v-if="visionRaw" style="margin-top: 6px">
            <summary class="muted" style="cursor: pointer">查看识别原文</summary>
            <pre class="raw">{{ visionRaw }}</pre>
          </details>
        </div>
      </div>

      <div class="col side-preview">
        <div class="panel">
          <div class="panel-title">badge 配置（作用于预览与生成）</div>
          <div class="cfg-row">
            <span>属性名</span>
            <el-input v-model="badgeAttr" size="small" style="width: 180px" />
          </div>
          <div class="cfg-row">
            <span>数值列</span>
            <el-select
              v-model="clicksField"
              size="small"
              filterable
              allow-create
              default-first-option
              placeholder="选择或输入自定义列名"
              style="width: 200px"
            >
              <el-option v-for="field in fieldOptions" :key="field" :label="field" :value="field" />
            </el-select>
            <span class="muted">内置两列或左侧表格里的任意自定义数值列</span>
          </div>
        </div>
        <div class="panel preview-panel">
          <div class="panel-title">badge 副本预览（{{ posterWidth }}px）</div>
          <iframe
            v-if="previewHtml"
            ref="previewFrame"
            class="preview-frame"
            :style="{ width: posterWidth + 'px' }"
            :srcdoc="previewHtml"
            sandbox="allow-same-origin"
          />
          <EmptyState v-else description="生成后在此预览 badge 副本" />
        </div>
      </div>
    </div>

    <div v-if="view !== 'generate'" class="panel" style="margin-top: 8px">
      <div class="panel-title">海报列表（覆盖式产物；删除仅归档记录）</div>
      <el-table v-if="posters.length > 0" v-loading="listLoading" :data="posters" size="small">
        <el-table-column prop="name" label="名称" min-width="160" show-overflow-tooltip />
        <el-table-column label="生成时间" width="160">
          <template #default="{ row }">
            <TimeText :value="row.lastGeneratedAt ?? row.updatedAt" />
          </template>
        </el-table-column>
        <el-table-column label="产物" min-width="220">
          <template #default="{ row }">
            <span class="muted">{{ row.outputs.badged ?? '—' }}</span>
            <span v-if="row.outputs.poster" class="ok"> / {{ row.outputs.poster }}</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="220" fixed="right">
          <template #default="{ row }">
            <el-button size="small" text @click="openPoster(row)">预览</el-button>
            <el-button size="small" text @click="copyCode(row)">复制代码</el-button>
            <el-button size="small" text type="danger" @click="deleteTarget = row; deleteOpen = true">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
      <EmptyState v-else description="还没有海报记录" />
    </div>

    <template #footer>
      <span class="muted">共 {{ posters.length }} 个海报 · 原 HTML 全程只读 · 产物覆盖式生成</span>
    </template>

    <ConfirmDialog
      v-model:open="deleteOpen"
      title="删除海报"
      :targets="deleteTarget ? [deleteTarget.name] : []"
      confirm-text="删除"
      @confirm="confirmDelete"
    />
  </ToolPageLayout>
</template>

<style scoped>
.badge-grid {
  display: grid;
  grid-template-columns: minmax(360px, 1fr) minmax(420px, 1.15fr);
  gap: 10px;
  align-items: start;
}
/* 右列（配置+预览）sticky：吃掉剩余视口高度，预览铺满剩余空间 */
.side-preview {
  position: sticky;
  top: 0;
  max-height: calc(100vh - 150px);
  display: flex;
  flex-direction: column;
}
.col {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}
.panel {
  border: 1px solid rgba(128, 128, 128, 0.25);
  border-radius: 6px;
  padding: 10px;
}
.panel-title {
  font-size: 12px;
  opacity: 0.7;
  margin-bottom: 8px;
}
.preview-panel {
  min-height: 240px;
  flex: 1;
  display: flex;
  flex-direction: column;
}
.preview-frame {
  max-width: 100%;
  flex: 1;
  min-height: 240px;
  border: 1px dashed rgba(128, 128, 128, 0.35);
  background: #fff;
  border-radius: 4px;
}
.recent-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 11px;
  opacity: .7;
  margin-bottom: 6px;
}
.recent-row {
  margin-top: 8px;
}
.image-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 8px;
}
.cfg-row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 8px;
  font-size: 12px;
  flex-wrap: wrap;
}
.stat-table {
  margin-top: 8px;
}
.stat-table :deep(.el-input-number) {
  width: 100%;
}
.stat-table :deep(.el-input__inner) {
  text-align: left;
}
.warn {
  color: var(--el-color-warning);
  font-size: 12px;
  margin-top: 6px;
}
.ok {
  color: var(--el-color-success);
  font-size: 12px;
  margin-top: 6px;
}
.muted {
  opacity: 0.6;
  font-size: 12px;
}
.hint {
  font-size: 12px;
  opacity: 0.6;
  line-height: 1.5;
  margin-top: 6px;
}
.raw {
  max-height: 180px;
  overflow: auto;
  font-size: 11px;
  white-space: pre-wrap;
  word-break: break-all;
  opacity: 0.75;
}
</style>
