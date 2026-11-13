<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { snapdom } from '@zumer/snapdom'
import { EmptyState, ConfirmDialog, TimeText, ToolPageLayout } from '@sshk/ui-kit'
import { parseCsvText } from '@sshk/badge-studio'
import type { StatRow } from '@sshk/badge-studio'

interface RecentHtml {
  path: string
  name: string
  usedAt: string
}

// 左侧菜单：generate=生成视图 / posters=列表视图（需求 8）
const props = defineProps<{ menu?: string }>()
const view = computed(() => props.menu ?? 'generate')
const badgeAttr = ref('data-edm-badge')
const clicksField = ref<'clicks' | 'totalClicks'>('clicks')

// HTML 输入：选择文件 / 粘贴源码（二选一）
const htmlPath = ref('')
const pastedHtml = ref('')
const recentHtmls = ref<RecentHtml[]>([])

// 数据源：文件（xlsx/csv/json）、图片识别（云端视觉 / 本机 PaddleOCR）或粘贴 csv 文本
const statsFile = ref('')
const pastedStats = ref('')
const statRows = ref<StatRow[]>([])
const statsWarnings = ref<string[]>([])

// 图片识别：模型 / OCR 参数由「工具配置 → 图片识别」统一管理，这里只读取
const vision = reactive({
  provider: 'cloud' as 'cloud' | 'paddleocr' | 'manual',
  baseURL: '',
  model: '',
  paddleCommand: '',
  paddleArgs: '{image}',
})
const imageFile = ref('')
const recognizing = ref(false)
const visionRaw = ref('')
const visionKey = ref('')
const hasVisionKey = ref(false)
const providerLabel = computed(() => ({
  cloud: '云端视觉模型',
  paddleocr: '本机 PaddleOCR',
  manual: '仅人工校对',
})[vision.provider])

// 生成结果
const generating = ref(false)
const currentPosterId = ref('')
const previewHtml = ref('')
const capturing = ref(false)

// 海报列表
const posters = ref<PosterRecord[]>([])
const listLoading = ref(false)

const hasHtml = computed(() => htmlPath.value !== '' || pastedHtml.value.trim() !== '')
const hasStats = computed(() => statRows.value.length > 0)

async function textConfig(key: string, fallback: string): Promise<string> {
  const value = await window.api.config.get(`tools.badge-studio.${key}`)
  return typeof value === 'string' && value.trim() ? value : fallback
}

async function loadConfigAndRecent(): Promise<void> {
  badgeAttr.value = await textConfig('badgeAttr', 'data-edm-badge')
  const recent = (await window.api.config.get('tools.badge-studio.recentHtmls')) as RecentHtml[] | null
  recentHtmls.value = Array.isArray(recent) ? recent : []
  const provider = await textConfig('vision.provider', 'cloud')
  vision.provider = provider === 'paddleocr' || provider === 'manual' ? provider : 'cloud'
  vision.baseURL = await textConfig('vision.baseURL', '')
  vision.model = await textConfig('vision.model', '')
  vision.paddleCommand = await textConfig('vision.paddleCommand', 'python')
  vision.paddleArgs = await textConfig('vision.paddleArgs', '{image}')
  hasVisionKey.value = (await window.api.badge.visionState()).hasKey
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

function useRecent(item: RecentHtml): void {
  htmlPath.value = item.path
  void window.api.badge.readHtml(item.path).then(({ html }) => {
    pastedHtml.value = html
  })
}

async function removeRecent(item: RecentHtml): Promise<void> {
  recentHtmls.value = recentHtmls.value.filter((r) => r.path !== item.path)
  await window.api.config.set('tools.badge-studio.recentHtmls', recentHtmls.value)
}

async function pickStats(): Promise<void> {
  const [file] = await window.api.os.pickFile({
    filters: [{ name: '点击统计', extensions: ['xlsx', 'xls', 'csv', 'tsv', 'json'] }],
  })
  if (!file) return
  try {
    const parsed = (await window.api.badge.parseDatasource(file)) as { rows: StatRow[]; warnings: string[] }
    statRows.value = parsed.rows
    statsWarnings.value = parsed.warnings
    statsFile.value = file
    if (parsed.rows.length > 0) ElMessage.success(`解析出 ${parsed.rows.length} 行点击数据`)
  } catch (err) {
    ElMessage.error((err as Error).message)
  }
}

function parsePastedStats(): void {
  try {
    const warnings: string[] = []
    statRows.value = parseCsvText(pastedStats.value, warnings)
    statsWarnings.value = warnings
    statsFile.value = ''
    if (statRows.value.length > 0) ElMessage.success(`解析出 ${statRows.value.length} 行点击数据`)
  } catch (err) {
    ElMessage.error((err as Error).message)
  }
}

async function pickImage(): Promise<void> {
  const [file] = await window.api.os.pickFile({
    filters: [{ name: '点击统计图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'] }],
  })
  if (file) imageFile.value = file
}

/** 图片 → 识别文本 → 标准 StatRow[]；同时回填可人工校对的 CSV */
async function recognizeImage(): Promise<void> {
  if (!imageFile.value) {
    ElMessage.warning('请先选择一张点击统计截图 / 表格图片')
    return
  }
  if (vision.provider === 'manual') {
    ElMessage.info('当前为「仅人工校对」模式，请在上方文本框粘贴 CSV')
    return
  }
  recognizing.value = true
  try {
    const result = await window.api.badge.parseImage({
      file: imageFile.value,
      provider: vision.provider,
      baseURL: vision.baseURL,
      model: vision.model,
      paddleCommand: vision.paddleCommand,
      paddleArgs: vision.paddleArgs,
    })
    statRows.value = result.rows
    statsWarnings.value = result.warnings
    pastedStats.value = result.csv
    statsFile.value = ''
    visionRaw.value = result.raw
    ElMessage.success(`识别并解析出 ${result.rows.length} 行，请先核对上方数值`)
  } catch (err) {
    ElMessage.error((err as Error).message)
  } finally {
    recognizing.value = false
  }
}

async function saveVisionKey(): Promise<void> {
  try {
    await window.api.badge.setVisionKey(visionKey.value.trim())
    visionKey.value = ''
    hasVisionKey.value = (await window.api.badge.visionState()).hasKey
    ElMessage.success('视觉模型密钥已写入本机凭据库')
  } catch (err) {
    ElMessage.error((err as Error).message)
  }
}
async function clearVisionKey(): Promise<void> {
  await window.api.badge.setVisionKey('')
  hasVisionKey.value = false
  ElMessage.success('视觉模型密钥已清除')
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
        urlNorm: { stripUtm: true, stripHash: true, stripTrailingSlash: true, sortQuery: true, lowercaseHost: true },
        badgeStyle: { background: '#e60012', color: '#fff', size: 18, offsetY: -9, offsetX: -11 },
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
    const capture = (await (snapdom as unknown as (el: Element, opts?: Record<string, unknown>) => Promise<unknown>)(target, { scale: 2 }))
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
    description="上传邮件 HTML + 点击统计（表格 / 图片识别 / 粘贴）→ URL 归一匹配 → 注入 badge 副本 → snapdom 海报长图（原文件永不修改）"
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
      <!-- 左：输入区 -->
      <div class="col">
        <div class="panel">
          <div class="panel-title">邮件 HTML（只读，不修改原文件）</div>
          <el-select
            v-if="recentHtmls.length > 0"
            size="small"
            placeholder="最近使用"
            style="width: 100%; margin-bottom: 8px"
            :model-value="htmlPath"
            @change="(v: string) => { const item = recentHtmls.find(r => r.path === v); if (item) useRecent(item) }"
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
              @click="useRecent(r)"
              @close="removeRecent(r)"
            >
              {{ r.name }}
            </el-tag>
          </div>
        </div>

        <div class="panel">
          <div class="panel-title">点击统计（xlsx / csv / json 上传、图片识别，或粘贴 csv 文本人工校对）</div>
          <el-input
            v-model="pastedStats"
            type="textarea"
            :rows="5"
            placeholder="url,clicks&#10;https://example.com/p/1,12"
          />
          <el-button size="small" style="margin-top: 8px" @click="parsePastedStats">解析文本</el-button>
          <div v-if="statsWarnings.length" class="warn">{{ statsWarnings.join('；') }}</div>
          <div v-if="hasStats" class="ok">已解析 {{ statRows.length }} 行{{ statsFile ? `（来自 ${statsFile.split(/[\\/]/).pop()}）` : '' }}</div>
        </div>

        <div class="panel">
          <div class="panel-title">图片识别（{{ providerLabel }}）</div>
          <div class="cfg-row">
            <el-button size="small" @click="pickImage">选择图片</el-button>
            <el-button size="small" type="primary" :loading="recognizing" @click="recognizeImage">识别为点击数据</el-button>
            <span class="muted">{{ imageFile ? imageFile.split(/[\\/]/).pop() : '未选择图片' }}</span>
          </div>
          <div v-if="vision.provider === 'cloud'" class="cfg-row">
            <span>模型</span>
            <span class="muted">{{ vision.model || '未配置' }} · {{ vision.baseURL || '未配置' }}</span>
          </div>
          <div v-if="vision.provider === 'cloud'" class="cfg-row">
            <el-input v-model="visionKey" type="password" show-password size="small" placeholder="视觉模型 API Key" style="max-width: 240px" />
            <el-button size="small" @click="saveVisionKey">保存密钥</el-button>
            <el-button size="small" text @click="clearVisionKey">清除</el-button>
            <el-tag size="small" :type="hasVisionKey ? 'success' : 'info'">{{ hasVisionKey ? '已配置' : '未配置' }}</el-tag>
          </div>
          <div v-if="vision.provider === 'paddleocr'" class="cfg-row">
            <span class="muted">本机命令：{{ vision.paddleCommand }} {{ vision.paddleArgs }}</span>
          </div>
          <div class="hint">识别结果会回填到上方 CSV 文本框，请人工核对后再生成；密钥只存系统凭据库，不写入配置文件。识别方式 / 模型 / OCR 命令在左侧「工具配置 → 图片识别」修改。</div>
          <details v-if="visionRaw" style="margin-top: 6px">
            <summary class="muted" style="cursor: pointer">查看识别原文</summary>
            <pre class="raw">{{ visionRaw }}</pre>
          </details>
        </div>

        <div class="panel">
          <div class="panel-title">badge 配置</div>
          <div class="cfg-row">
            <span>属性名</span>
            <el-input v-model="badgeAttr" size="small" style="width: 180px" />
          </div>
          <div class="cfg-row">
            <span>数值列</span>
            <el-radio-group v-model="clicksField" size="small">
              <el-radio value="clicks">clicks</el-radio>
              <el-radio value="totalClicks">totalClicks</el-radio>
            </el-radio-group>
          </div>
        </div>
      </div>

      <!-- 右：预览 -->
      <div class="col">
        <div class="panel preview-panel">
          <div class="panel-title">badge 副本预览（680px）</div>
          <iframe
            v-if="previewHtml"
            ref="previewFrame"
            class="preview-frame"
            :srcdoc="previewHtml"
            sandbox="allow-same-origin"
          />
          <EmptyState v-else description="生成后在此预览 badge 副本" />
        </div>
      </div>
    </div>

    <!-- 海报列表 -->
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
  grid-template-columns: minmax(320px, 1fr) minmax(360px, 1fr);
  gap: 8px;
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
  min-height: 320px;
}
.preview-frame {
  width: 680px;
  max-width: 100%;
  height: 480px;
  border: 1px dashed rgba(128, 128, 128, 0.35);
  background: #fff;
  border-radius: 4px;
}
.recent-row {
  margin-top: 8px;
}
.cfg-row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 8px;
  font-size: 12px;
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
  max-height: 160px;
  overflow: auto;
  font-size: 11px;
  white-space: pre-wrap;
  word-break: break-all;
  opacity: 0.75;
}
</style>
