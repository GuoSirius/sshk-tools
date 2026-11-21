<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { CodeEditor, formatHtml, compactHtml } from '@sshk/code-editor'
import { FormHint } from '@sshk/ui-kit'
import { Document, Delete } from '@element-plus/icons-vue'
import {
  recentHtmls, clearRecent, htmlPath, useRecent, removeRecent, clearHtmlSelection, type RecentHtml,
  edmMails, edmMailsLoading, sourceMailId, loadEdmMails, pickEdmMail, clearSourceMail,
  pastedHtml, pastedStats, parsePastedStats, pickImages,
  addRow, hasStats, clearRows, statRows, statsFile,
  imageFiles, imageThumbs, previewList, loadThumb, recognizing, vision, visionRaw,
  visionProviderId, onProviderChange, providers, activeProvider, recognizeImages,
  visionModel, modelOptions, modelsLoading, fetchProviderModels, saveVisionConfig,
  badgeAttr, posterName, badgePositionText, badgePositionImage, badgePositionOptions,
  clicksField, fieldOptions, posterWidth, previewHtml, previewFrame,
  statsWarnings, customMetricKeys, removeMetric, metricOf, setMetric,
  removeRow, syncCsvFromRows, newMetricKey, addMetric,
  nameAttention,
} from '../state'

/** 海报名聚焦提示（用户 2026-11-18：保存时名字为空 → 自动展开配置并聚焦输入框） */
const nameInputRef = ref<{ focus: () => void } | null>(null)
watch(nameAttention, () => {
  cfgOpen.value = ['cfg']
  void nextTick(() => nameInputRef.value?.focus())
})

/** E-T5：第二个工具零配置复用 @sshk/code-editor —— 统计表 JSON 只读视图 */
const jsonViewOpen = ref(false)
const statsJson = computed(() => JSON.stringify(statRows.value, null, 2))

// ── badge 配置：折叠展开（默认收起给预览腾空间）+ 收起时的关键配置摘要 ──
const cfgOpen = ref<string[]>([])
const cfgCollapsed = computed(() => !cfgOpen.value.includes('cfg'))
const textPositionLabel = computed(() => badgePositionOptions.find((o) => o.value === badgePositionText.value)?.label ?? '—')
const imagePositionLabel = computed(() => badgePositionOptions.find((o) => o.value === badgePositionImage.value)?.label ?? '—')

/**
 * Badge Studio——生成海报页：
 * 模板与布局从单文件原样迁移；状态/业务在 ../state（模块单例），
 * HTML 定位走 Monaco（真高亮 + 居中滚动），previewFrame 由页面绑定、壳的截图按钮消费。
 */

// ── HTML 搜索定位（Monaco 版）：findMatches 全量命中 + 装饰高亮 + 选中居中 ──
interface MonacoEditorLike {
  getModel(): { findMatches: (
    searchString: string, searchOnlyEditableRange: boolean, isRegex: boolean,
    matchCase: boolean, wordSeparators: string | null, captureMatches: boolean,
    limitResultCount: number,
  ) => { range: unknown }[] } | null
  setSelection(range: unknown): void
  revealRangeInCenter(range: unknown): void
  createDecorationsCollection(decorations: { range: unknown; options: Record<string, unknown> }[]): { clear(): void }
  focus(): void
}
const htmlEditorRef = ref<{ getEditor: () => MonacoEditorLike | null } | null>(null)
const htmlSearch = ref('')
const htmlSearchPos = ref<{ index: number; total: number } | null>(null)
const htmlSearchLast = ref('')
const htmlSearchCursor = ref(-1)
let searchDecorations: { clear(): void } | null = null

function locateInHtml(term: string): void {
  const query = term || htmlSearch.value.trim()
  if (!query) { ElMessage.warning('请输入搜索内容（url 片段 / 文字 / 属性名）')
    return }
  // 换了搜索词就从头开始；同一个词内「查找下一个」逐处推进
  if (query !== htmlSearchLast.value) {
    htmlSearchLast.value = query
    htmlSearchCursor.value = -1
  }
  const editor = htmlEditorRef.value?.getEditor()
  const model = editor?.getModel()
  if (!editor || !model) return
  const matches = model.findMatches(query, false, false, true, null, false, 5000)
  if (matches.length === 0) { ElMessage.warning('未在 HTML 中找到：' + query)
    return }
  htmlSearchCursor.value = (htmlSearchCursor.value + 1) % matches.length
  const range = matches[htmlSearchCursor.value]?.range
  searchDecorations?.clear()
  searchDecorations = editor.createDecorationsCollection(
    matches.map((m) => ({ range: m.range, options: { className: 'badge-search-hit', isWholeLine: false } })),
  )
  editor.setSelection(range)
  editor.revealRangeInCenter(range)
  editor.focus()
  htmlSearchPos.value = { index: htmlSearchCursor.value + 1, total: matches.length }
}

/** 项3：格式化 / 压缩编辑器里的 HTML（仅改编辑区内容，不写回源文件） */
async function applyFormat(): Promise<void> {
  const before = pastedHtml.value
  const next = await formatHtml(before)
  if (next === before) { ElMessage.info('HTML 已是格式化状态或内容不完整，未做改动'); return }
  pastedHtml.value = next
  ElMessage.success('已格式化，长行现已换行便于查看与修改')
}
function applyCompact(): void {
  const before = pastedHtml.value
  const next = compactHtml(before)
  if (next === before) { ElMessage.info('HTML 已是压缩状态'); return }
  pastedHtml.value = next
  ElMessage.success('已压缩 HTML（保留 <pre>/<code> 原文）')
}

/** 项5：清空表格二次确认（误点保护；清空只影响工作区 CSV 与表格，不动源文件） */
function askClearRows(): void {
  if (!hasStats.value) return
  ElMessageBox.confirm(
    `确定清空当前 ${statRows.value.length} 行数据？此操作只影响工作区表格与上方 CSV 文本，不会修改源文件；清空后不可撤销。`,
    '清空表格确认',
    { type: 'warning', confirmButtonText: '确认清空', cancelButtonText: '取消', closeOnClickModal: false, closeOnPressEscape: false },
  ).then(() => {
    clearRows()
    ElMessage.success('表格已清空')
  }).catch(() => { /* 用户取消 */ })
}

/** 用户 2026-11-18：最近使用的三种危险操作一律二次确认（清空选择框/清空下拉/单项删除） */
function confirmAction(title: string, message: string, action: () => void | Promise<void>): void {
  ElMessageBox.confirm(message, title, {
    type: 'warning', confirmButtonText: '确认', cancelButtonText: '取消', closeOnClickModal: false, closeOnPressEscape: false,
  }).then(() => void action()).catch(() => { /* 用户取消 */ })
}
/** 清空选择框：清除已选 + HTML 内容（回调 v='' 时触发；二次确认后生效） */
function askClearHtmlSelection(): void {
  confirmAction('清空 HTML 选择', '确定清除当前 HTML 选择吗？已选文件与编辑区中的 HTML 内容都会被清空，且不可撤销（不会删除源文件）。', () => {
    clearHtmlSelection()
    ElMessage.success('已清除 HTML 选择及内容')
  })
}
/** 清空下拉：删除所有最近使用记录（二次确认后生效） */
function askClearRecent(): void {
  if (!recentHtmls.value.length) return
  confirmAction('清空最近使用', `确定删除全部 ${recentHtmls.value.length} 条「最近使用」记录吗？只清历史记录，不影响当前编辑区内容，且不可撤销。`, async () => {
    await clearRecent()
  })
}
/** 单项删除最近使用记录（二次确认后生效） */
function askRemoveRecent(item: RecentHtml): void {
  confirmAction('删除该记录', `确定从「最近使用」中删除「${item.name}」吗？只清历史记录，不影响当前编辑区内容，且不可撤销。`, async () => {
    await removeRecent(item)
  })
}
</script>

<template>
  <div class="badge-grid">
    <div class="col">
      <div class="panel">
        <div class="panel-title">邮件 HTML（只读，不修改原文件）</div>
        <!-- N5 源邮件衍生：从 EDM 选择源 HTML，打标后源邮件重生成会提示「重新打标」 -->
        <div class="cfg-row" style="margin-bottom: 8px">
          <el-select
            size="small"
            clearable
            filterable
            placeholder="从 EDM 邮件选择源（源邮件重新生成后提示重新打标）"
            style="flex: 1"
            :model-value="sourceMailId ?? ''"
            :loading="edmMailsLoading"
            @visible-change="(v: boolean) => { if (v && edmMails.length === 0) void loadEdmMails() }"
            @change="(v: string) => { const m = edmMails.find((x) => x._id === v); if (m) void pickEdmMail(m); else clearSourceMail() }"
          >
            <el-option v-for="m in edmMails" :key="m._id" :label="m.name" :value="m._id" />
          </el-select>
          <el-button size="small" :loading="edmMailsLoading" @click="void loadEdmMails()">刷新邮件</el-button>
        </div>
        <!-- 最近使用：下拉即选择器（项1）——每项尾部删除 icon 单删，下拉右侧清空按钮；底部标签行已去掉 -->
        <div v-if="recentHtmls.length > 0" class="recent-picker">
          <el-select
            size="small"
            clearable
            placeholder="最近使用 · 点选重新载入历史文件"
            class="recent-select"
            :model-value="htmlPath"
            @change="(v: string) => { const item = recentHtmls.find(r => r.path === v); if (item) void useRecent(item); else if (!v) askClearHtmlSelection() }"
          >
            <el-option v-for="r in recentHtmls" :key="r.path" :label="r.name" :value="r.path">
              <span class="recent-opt">
                <span class="recent-opt-name" :title="r.path">{{ r.name }}</span>
                <el-icon class="recent-opt-del" title="删除该记录" @click.stop="askRemoveRecent(r)"><Delete /></el-icon>
              </span>
            </el-option>
          </el-select>
          <el-button size="small" type="danger" plain title="清空全部历史记录" @click="askClearRecent">清空</el-button>
        </div>
        <div class="cfg-row">
          <el-input
            v-model="htmlSearch"
            size="small"
            clearable
            placeholder="在 HTML 中搜索（url 片段 / 文字 / 属性名）"
            style="flex: 1"
            @keydown.enter="locateInHtml('')"
          />
          <el-button size="small" @click="locateInHtml(htmlSearch)">查找下一个</el-button>
          <!-- 常驻占位：宽度预留、不可见，首次命中不挤动布局（2026-11-16 用户反馈） -->
          <span class="muted search-pos" :class="{ on: htmlSearchPos }">
            {{ htmlSearchPos ? `第 ${htmlSearchPos.index} / ${htmlSearchPos.total} 处` : '—' }}
          </span>
        </div>
        <CodeEditor ref="htmlEditorRef" v-model="pastedHtml" language="html" height="300px" />
        <!-- 项3：压缩 HTML 单行无高亮 → 一键格式化 / 压缩，仅改编辑区内容，不落盘原文件 -->
        <!-- 用户约定：工具栏按钮统一居右——说明文字占左侧剩余空间，按钮组贴右 -->
        <div class="cfg-row editor-tool-row" style="margin-top: 6px">
          <span class="muted">压缩 HTML 换行后即可正常高亮编辑；仅影响编辑区，不修改原文件</span>
          <div class="editor-tool-btns">
            <el-button size="small" type="primary" plain :disabled="!pastedHtml" @click="applyFormat">格式化</el-button>
            <el-button size="small" type="warning" plain :disabled="!pastedHtml" @click="applyCompact">压缩</el-button>
          </div>
        </div>
      </div>

      <div class="panel">
        <div class="panel-title">点击统计 · 三种来源统一进可编辑表格</div>
        <CodeEditor v-model="pastedStats" language="csv" height="110px" />
        <FormHint class="csv-hint">格式：url,clicks,…；粘贴后点「解析文本」进表格。CSV 高亮为共享编辑器 csv 语言。</FormHint>
        <!-- 项5：按钮精简文案一行 + 彩色化 + 间距收紧；清空带行数并二次确认 -->
        <div class="stats-toolbar">
          <el-button size="small" type="primary" plain @click="parsePastedStats">解析文本</el-button>
          <el-button size="small" type="success" plain @click="pickImages">选择图片</el-button>
          <el-button size="small" type="primary" plain @click="addRow">新增一行</el-button>
          <el-button size="small" type="info" plain :icon="Document" @click="jsonViewOpen = true">JSON</el-button>
          <el-button size="small" type="danger" plain :disabled="!hasStats" @click="askClearRows">清空（{{ statRows.length }}）</el-button>
          <span class="muted stats-origin">{{ statsFile ? `来自 ${statsFile.split(/[\\/]/).pop()}` : `共 ${statRows.length} 行` }}</span>
        </div>

        <div v-if="imageFiles.length" class="image-list-panel">
          <div class="panel-title">已选图片（{{ imageFiles.length }} 张）· 点图放大核对内容</div>
          <div class="image-strip">
            <div v-for="(file, index) in imageFiles" :key="file" class="image-item">
              <el-image
                :src="imageThumbs[file] ?? ''"
                fit="cover"
                class="image-thumb"
                :preview-src-list="previewList"
                :initial-index="index"
                hide-on-click-modal
                preview-teleported
                @error="() => loadThumb(file)"
              >
                <template #error>
                  <div class="image-thumb-fallback" @click="() => loadThumb(file)">加载</div>
                </template>
              </el-image>
              <el-button class="image-remove" size="small" text type="danger" @click="imageFiles.splice(index, 1)">×</el-button>
              <span class="image-name" :title="file">{{ file.split(/[\\/]/).pop() }}</span>
            </div>
          </div>
          <div class="cfg-row" style="margin-top: 6px">
            <el-button size="small" type="primary" :loading="recognizing" :disabled="vision.provider === 'manual'" @click="recognizeImages">
              识别并追加到表格（{{ imageFiles.length }} 张）
            </el-button>
          </div>
        </div>

        <div v-if="statsWarnings.length" class="warn">{{ statsWarnings.join('；') }}</div>

        <el-table v-if="hasStats" :data="statRows" size="small" max-height="260" class="stat-table">
          <el-table-column type="index" label="序号" width="58" align="center" />
          <el-table-column label="URL" min-width="180">
            <template #default="{ row }">
              <el-input clearable v-model="row.url" size="small" @input="syncCsvFromRows" />
            </template>
          </el-table-column>
          <!-- 项6：标记列移到 URL 后，便于逐行核对 -->
          <el-table-column label="标记" width="78" align="center">
            <template #default="{ row }">
              <template v-if="row.matched === undefined">—</template>
              <el-tag v-else-if="row.matched > 0" size="small" type="success">{{ row.matched }}</el-tag>
              <el-tooltip v-else content="该 URL 未被标记，点定位检查" placement="top">
                <el-tag size="small" type="danger" style="cursor: pointer" @click="locateInHtml(row.url)">0 定位</el-tag>
              </el-tooltip>
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
              <el-input clearable
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
          <el-input clearable v-model="newMetricKey" size="small" placeholder="自定义数值列名，如 uv / 下单数" style="max-width: 200px" />
          <el-button size="small" @click="addMetric">新增数值列</el-button>
          <span class="muted">表格改动会同步回上方 CSV 文本</span>
        </div>
        <FormHint>识别结果可能把 5 认成 S、0 认成 O；请在表格里逐格核对后再生成，识别结果不会自动生效。</FormHint>
      </div>

      <div class="panel">
        <div class="panel-title">识别配置（就地修改，保存为默认后重启沿用）</div>
        <!-- label 等宽对齐 = el-form label-width="auto"（用户 2026-11-19 澄清的规范做法，勿用固定 px） -->
        <el-form label-width="auto" class="vision-cfg">
          <el-form-item label="识别方式">
            <el-radio-group v-model="vision.provider" size="small">
              <el-radio-button value="cloud">云端模型</el-radio-button>
              <el-radio-button value="manual">仅人工校对</el-radio-button>
            </el-radio-group>
          </el-form-item>

          <template v-if="vision.provider === 'cloud'">
            <el-form-item label="Provider">
              <el-select v-model="visionProviderId" size="small" class="vision-cfg-select" @change="onProviderChange">
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
            </el-form-item>
            <el-form-item label="模型">
              <el-select
                v-model="visionModel"
                size="small"
                filterable
                allow-create
                default-first-option
                :loading="modelsLoading"
                placeholder="下拉选择或手动输入"
                class="vision-cfg-select"
              >
                <el-option v-for="m in modelOptions" :key="m" :label="m" :value="m" />
              </el-select>
              <el-button size="small" :loading="modelsLoading" @click="fetchProviderModels">拉取模型列表</el-button>
              <span class="muted">端点与密钥来自「模型控制台」的同一份 Provider</span>
            </el-form-item>
          </template>

          <FormHint v-else>
            仅人工校对：直接在上方粘贴 CSV，或点「新增一行 / 新增数值列」在表格里录入。
          </FormHint>

          <el-form-item v-if="vision.provider !== 'manual'" class="vision-cfg-save">
            <span class="muted">不保存则本次会话内有效</span>
            <el-button size="small" @click="saveVisionConfig">保存为默认配置</el-button>
          </el-form-item>
        </el-form>

        <details v-if="visionRaw" style="margin-top: 6px">
          <summary class="muted" style="cursor: pointer">查看识别原文</summary>
          <pre class="raw">{{ visionRaw }}</pre>
        </details>
      </div>
    </div>

    <div class="col side-preview">
      <div class="panel">
        <!-- 表单布局按项目约定（el-form label-width=auto）统一；折叠给下方预览腾空间（2026-11-17 用户反馈） -->
        <el-collapse v-model="cfgOpen" class="badge-cfg">
          <el-collapse-item name="cfg">
            <template #title>
              <span class="panel-title cfg-title">badge 配置（作用于预览与生成）</span>
              <span class="muted cfg-summary" :class="{ on: cfgCollapsed }">
                {{ badgeAttr }} · {{ textPositionLabel }}/{{ imagePositionLabel }} · 列 {{ clicksField || '—' }}
              </span>
            </template>
            <el-form label-width="auto" size="small" class="badge-cfg-form">
              <div class="form-inline-row">
                <el-form-item label="海报名" required class="grow-item">
                  <el-input ref="nameInputRef" clearable v-model="posterName" placeholder="海报名称（必填；列表与导出文件名）" />
                </el-form-item>
                <el-form-item label="属性名" class="grow-item">
                  <el-input clearable v-model="badgeAttr" />
                </el-form-item>
              </div>
              <div class="form-inline-row">
                <el-form-item label="文本位置" class="grow-item">
                  <el-select v-model="badgePositionText">
                    <el-option v-for="opt in badgePositionOptions" :key="opt.value" :label="opt.label" :value="opt.value" />
                  </el-select>
                </el-form-item>
                <el-form-item label="图片位置" class="grow-item">
                  <el-select v-model="badgePositionImage">
                    <el-option v-for="opt in badgePositionOptions" :key="opt.value" :label="opt.label" :value="opt.value" />
                  </el-select>
                </el-form-item>
              </div>
              <el-form-item label=" " class="pos-hint-item">
                <FormHint>生成时写入 data-badge-position；&lt;a&gt; 上手写的属性优先</FormHint>
              </el-form-item>
              <el-form-item label="数值列">
                <el-select
                  v-model="clicksField"
                  filterable
                  allow-create
                  default-first-option
                  placeholder="选择或输入自定义列名"
                >
                  <el-option v-for="field in fieldOptions" :key="field" :label="field" :value="field" />
                </el-select>
                <div class="muted pos-note">内置两列或左侧表格里的任意自定义数值列</div>
              </el-form-item>
            </el-form>
          </el-collapse-item>
        </el-collapse>
      </div>
      <div class="panel preview-panel">
        <!-- 空状态：标题与提示合并居中展示（用户 2026-11-17 反馈：两处文案分开不够友好）；
             有预览时标题回到顶部，iframe 撑满 -->
        <template v-if="previewHtml">
          <!-- 用户 2026-11-18：生成后不再显示「badge 副本预览」标题行，iframe 直接撑满预览区 -->
          <iframe
            :ref="(el) => { previewFrame = el as HTMLIFrameElement | null }"
            class="preview-frame"
            :style="{ width: posterWidth + 'px' }"
            :srcdoc="previewHtml"
            sandbox="allow-same-origin allow-scripts"
          />
        </template>
        <div v-else class="preview-empty-centered">
          <span class="preview-empty-title">badge 副本预览（{{ posterWidth }}px）</span>
          <span class="preview-empty-hint">生成后在此预览 badge 副本</span>
        </div>
      </div>
    </div>
    <el-dialog v-model="jsonViewOpen" title="点击统计 · JSON（只读）" width="720px" destroy-on-close :close-on-click-modal="false" :close-on-press-escape="false">
      <CodeEditor :model-value="statsJson" language="json" height="420px" readonly />
    </el-dialog>
  </div>
</template>

<style scoped>
.badge-grid {
  display: grid;
  grid-template-columns: minmax(360px, 1fr) minmax(420px, 1.15fr);
  gap: 10px;
  height: 100%;
  min-height: 0;
}
/* 左列（长内容）自身滚动；右列固定撑满 —— 页面整体不滚动 */
.badge-grid > .col {
  overflow-y: auto;
  min-height: 0;
  scrollbar-width: thin;
}
/* 右列（配置+预览）固定撑满，不随左列滚动 */
.side-preview {
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.image-list-panel {
  margin-top: 8px;
  border: 1px dashed rgba(128, 128, 128, 0.35);
  border-radius: 6px;
  padding: 8px;
}
.image-strip {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.image-item {
  position: relative;
  width: 88px;
}
.image-thumb {
  width: 88px;
  height: 64px;
  border-radius: 6px;
  border: 1px solid rgba(128, 128, 128, 0.3);
  cursor: zoom-in;
  background: rgba(128, 128, 128, 0.08);
}
.image-thumb-fallback {
  width: 88px;
  height: 64px;
  display: grid;
  place-items: center;
  font-size: 11px;
  opacity: 0.6;
}
.image-remove {
  position: absolute;
  top: -6px;
  right: -6px;
  padding: 2px 6px;
}
.image-name {
  display: block;
  font-size: 10px;
  opacity: 0.6;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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
  overflow: hidden;
}
.preview-frame {
  max-width: 100%;
  flex: 1;
  min-height: 240px;
  border: 1px dashed rgba(128, 128, 128, 0.35);
  background: #fff;
  border-radius: 4px;
}
/* 预览空状态：标题 + 提示合并居中（两段文案放一起，视觉减负） */
.preview-empty-centered {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 240px;
}
.csv-hint { margin-top: 4px; }
.preview-empty-title { font-size: 14px; font-weight: 600; opacity: 0.85; }
.preview-empty-hint { font-size: 12px; opacity: 0.6; }
.stats-toolbar { display: flex; align-items: center; gap: 6px; flex-wrap: nowrap; margin-top: 8px; }
.stats-toolbar .el-button + .el-button { margin-left: 0; }
.stats-origin { font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

.recent-picker { display: flex; align-items: center; gap: 6px; margin-bottom: 8px; }
.recent-picker .recent-select { flex: 1; min-width: 0; }
.recent-opt { display: flex; align-items: center; justify-content: space-between; gap: 8px; width: 100%; }
.recent-opt-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.recent-opt-del { flex: none; color: var(--el-color-danger); cursor: pointer; }
.recent-opt-del:hover { color: var(--el-color-danger-light-3); }
.cfg-row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 8px;
  font-size: 12px;
  flex-wrap: wrap;
}
/* 识别配置表单：紧凑口径（12px 字号，与原 cfg-row 一致）；行距 12px、行内控件间 8px，
   Provider/模型下拉统一宽度右缘对齐（用户 2026-11-19）。
   __content/__label 是 el-form-item 内部元素，scoped 必须 :deep() 穿透（裸选择器不匹配=间距丢失） */
.vision-cfg .el-form-item { margin-bottom: 12px; }
.vision-cfg :deep(.el-form-item__content) { gap: 8px; font-size: 12px; }
.vision-cfg :deep(.el-form-item__label) { font-size: 12px; }
.vision-cfg-select { width: 240px; }
/* 保存行：描述紧贴按钮左侧、整体居右（用户 2026-11-19） */
.vision-cfg-save :deep(.el-form-item__content) { justify-content: flex-end; }
/* 编辑器工具行：说明文字占左，按钮组统一居右 */
.editor-tool-row .muted { flex: 1; min-width: 0; }
.editor-tool-btns { display: flex; align-items: center; gap: 8px; margin-left: auto; flex: none; }
/* badge 配置折叠面板：去 el-collapse 默认分隔线，标题行放关键配置摘要，收起时仍可见。
   header/wrap 在暗色下自带 #141414 实底，标题与内容统一留 12px 内边距，
   否则标题贴左缘、展开箭头贴右缘、表单内容贴边（2026-11-17 用户反馈） */
.badge-cfg { border-top: 0; border-bottom: 0; }
.badge-cfg :deep(.el-collapse-item__header) { height: auto; padding: 2px 12px; border-bottom: 0; }
.badge-cfg :deep(.el-collapse-item__wrap) { border-bottom: 0; }
.badge-cfg :deep(.el-collapse-item__content) { padding: 2px 12px 2px; }
.cfg-title { margin-bottom: 0; }
.cfg-summary { margin-left: 10px; visibility: hidden; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex: 1; }
.cfg-summary.on { visibility: visible; }
.badge-cfg-form { width: 100%; }
.badge-cfg-form :deep(.el-form-item) { margin-bottom: 10px; }
.badge-cfg-form :deep(.el-select) { width: 100%; }
/* 两个字段并排一行：各占一半，不换行（2026-11-17 用户反馈） */
.form-inline-row { display: flex; gap: 12px; width: 100%; }
.grow-item { flex: 1 1 0; min-width: 0; }
.grow-item :deep(.el-form-item__content) { flex-wrap: nowrap; min-width: 0; }
.pos-note { width: 100%; margin-top: 2px; }
/* 位置行下方的说明：上收紧贴选择行（否则独立 form-item 间距太大，看不出在描述谁） */
.pos-hint-item { margin-top: -8px; }
.pos-hint-item :deep(.el-form-item__content) { line-height: 1.4; }
/* 搜索计数常驻占位：预留固定宽度，未命中时不可见，命中显示——布局零突变 */
.search-pos {
  min-width: 92px;
  text-align: right;
  visibility: hidden;
  white-space: nowrap;
}
.search-pos.on {
  visibility: visible;
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
.muted {
  opacity: 0.6;
  font-size: 12px;
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

<style>
/* Monaco 搜索命中装饰：装饰器类挂在 monaco 内部 DOM，必须非 scoped */
.badge-search-hit {
  background: rgba(230, 162, 60, 0.4);
  outline: 1px solid rgba(230, 162, 60, 0.8);
}
</style>
