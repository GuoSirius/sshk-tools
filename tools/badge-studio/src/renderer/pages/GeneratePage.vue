<script setup lang="ts">
import { computed, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { EmptyState } from '@sshk/ui-kit'
import { CodeEditor } from '@sshk/code-editor'
import { Document } from '@element-plus/icons-vue'
import {
  recentHtmls, clearRecent, htmlPath, useRecent, removeRecent,
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
} from '../state'

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
        <CodeEditor v-model="pastedStats" language="csv" height="110px" />
        <div class="hint" style="margin-top: 4px">格式：url,clicks,…；粘贴后点「解析文本」进表格。CSV 高亮为共享编辑器 csv 语言。</div>
        <div class="cfg-row" style="margin-top: 8px">
          <el-button size="small" @click="parsePastedStats">解析文本</el-button>
          <el-button size="small" @click="pickImages">选择图片（可多选）</el-button>
          <el-button size="small" @click="addRow">新增一行</el-button>
          <el-button size="small" :icon="Document" :disabled="!hasStats" @click="jsonViewOpen = true">JSON 视图</el-button>
          <el-button size="small" text type="danger" :disabled="!hasStats" @click="clearRows">清空表格</el-button>
          <span class="muted">共 {{ statRows.length }} 行{{ statsFile ? ` · 来自 ${statsFile.split(/[\\/]/).pop()}` : '' }}</span>
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
          <el-table-column label="标记" width="78">
            <template #default="{ row }">
              <template v-if="row.matched === undefined">—</template>
              <el-tag v-else-if="row.matched > 0" size="small" type="success">{{ row.matched }}</el-tag>
              <el-tooltip v-else content="该 URL 未被标记，点定位检查" placement="top">
                <el-tag size="small" type="danger" style="cursor: pointer" @click="locateInHtml(row.url)">0 定位</el-tag>
              </el-tooltip>
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
        <div class="hint">识别结果可能把 5 认成 S、0 认成 O；请在表格里逐格核对后再生成，识别结果不会自动生效。</div>
      </div>

      <div class="panel">
        <div class="panel-title">识别配置（就地修改，保存为默认后重启沿用）</div>
        <div class="cfg-row">
          <span>识别方式</span>
          <el-radio-group v-model="vision.provider" size="small">
            <el-radio-button value="cloud">云端模型</el-radio-button>
            <el-radio-button value="manual">仅人工校对</el-radio-button>
          </el-radio-group>
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

        <div v-else class="hint">
          仅人工校对：直接在上方粘贴 CSV，或点「新增一行 / 新增数值列」在表格里录入。
        </div>

        <div v-if="vision.provider !== 'manual'" class="cfg-row">
          <el-button size="small" @click="saveVisionConfig">保存为默认配置</el-button>
          <span class="muted">不保存则本次会话内有效</span>
        </div>

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
              <el-form-item label="属性名">
                <el-input v-model="badgeAttr" />
              </el-form-item>
              <el-form-item label="海报名">
                <el-input v-model="posterName" placeholder="海报名称（列表与导出文件名）" />
              </el-form-item>
              <el-form-item label="文本位置">
                <el-select v-model="badgePositionText" class="pos-select">
                  <el-option v-for="opt in badgePositionOptions" :key="opt.value" :label="opt.label" :value="opt.value" />
                </el-select>
                <span class="pos-gap">图片位置</span>
                <el-select v-model="badgePositionImage" class="pos-select">
                  <el-option v-for="opt in badgePositionOptions" :key="opt.value" :label="opt.label" :value="opt.value" />
                </el-select>
              </el-form-item>
              <el-form-item label=" ">
                <span class="muted">生成时写入 data-badge-position；&lt;a&gt; 上手写的属性优先</span>
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
        <div class="panel-title">badge 副本预览（{{ posterWidth }}px）</div>
        <iframe
          v-if="previewHtml"
          :ref="(el) => { previewFrame = el as HTMLIFrameElement | null }"
          class="preview-frame"
          :style="{ width: posterWidth + 'px' }"
          :srcdoc="previewHtml"
          sandbox="allow-same-origin allow-scripts"
        />
        <EmptyState v-else description="生成后在此预览 badge 副本" />
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
.cfg-row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 8px;
  font-size: 12px;
  flex-wrap: wrap;
}
/* badge 配置折叠面板：去 el-collapse 默认分隔线，标题行放关键配置摘要，收起时仍可见 */
.badge-cfg { border-top: 0; border-bottom: 0; }
.badge-cfg :deep(.el-collapse-item__header) { height: auto; padding: 2px 0; border-bottom: 0; }
.badge-cfg :deep(.el-collapse-item__wrap) { border-bottom: 0; }
.badge-cfg :deep(.el-collapse-item__content) { padding-bottom: 2px; }
.cfg-title { margin-bottom: 0; }
.cfg-summary { margin-left: 10px; visibility: hidden; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex: 1; }
.cfg-summary.on { visibility: visible; }
.badge-cfg-form { width: 100%; }
.badge-cfg-form :deep(.el-form-item) { margin-bottom: 10px; }
.badge-cfg-form :deep(.el-select) { width: 100%; }
.pos-select { width: calc(50% - 24px) !important; flex: none; }
.pos-gap { flex: none; margin: 0 4px; }
.pos-note { width: 100%; margin-top: 2px; }
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

<style>
/* Monaco 搜索命中装饰：装饰器类挂在 monaco 内部 DOM，必须非 scoped */
.badge-search-hit {
  background: rgba(230, 162, 60, 0.4);
  outline: 1px solid rgba(230, 162, 60, 0.8);
}
</style>
