<script setup lang="ts">
import { ref } from 'vue'
import { ElMessage } from 'element-plus'
import { EmptyState } from '@sshk/ui-kit'
import {
  recentHtmls, clearRecent, htmlPath, useRecent, removeRecent,
  pastedHtml, pastedStats, parsePastedStats, pickImages,
  addRow, hasStats, clearRows, statRows, statsFile,
  imageFiles, imageThumbs, previewList, loadThumb, recognizing, vision, visionRaw,
  visionProviderId, onProviderChange, providers, activeProvider, recognizeImages,
  visionModel, modelOptions, modelsLoading, fetchProviderModels,
  pickPython, selfCheckCommand, copySelfCheck, saveVisionConfig,
  badgeAttr, posterName, badgePositionText, badgePositionImage, badgePositionOptions,
  clicksField, fieldOptions, posterWidth, previewHtml, previewFrame,
  statsWarnings, customMetricKeys, removeMetric, metricOf, setMetric,
  removeRow, syncCsvFromRows, newMetricKey, addMetric,
} from '../state'

/**
 * Badge Studio——生成海报页：
 * 模板与布局从单文件原样迁移；状态/业务在 ../state（模块单例），
 * 仅 DOM 强相关逻辑留在本页（HTML 定位）；previewFrame 由页面绑定、壳的截图按钮消费。
 */
const htmlInputRef = ref<{ $el: { querySelector: (sel: string) => HTMLTextAreaElement | null } } | null>(null)

// ── HTML 搜索定位：textarea 无法高亮，用 setSelectionRange 选中 + 行号滚动 ──
const htmlSearch = ref('')
const htmlSearchPos = ref<{ index: number; total: number } | null>(null)
const htmlSearchLast = ref('')
const htmlSearchCursor = ref(-1)
function locateInHtml(term: string): void {
  const query = term || htmlSearch.value.trim()
  if (!query) { ElMessage.warning('请输入搜索内容（url 片段 / 文字 / 属性名）')
    return }
  // 换了搜索词就从头开始；同一个词内「查找下一个」逐处推进
  if (query !== htmlSearchLast.value) {
    htmlSearchLast.value = query
    htmlSearchCursor.value = -1
  }
  const text = pastedHtml.value
  const positions: number[] = []
  for (let i = text.indexOf(query); i !== -1; i = text.indexOf(query, i + query.length)) positions.push(i)
  if (positions.length === 0) { ElMessage.warning('未在 HTML 中找到：' + query)
    return }
  htmlSearchCursor.value = (htmlSearchCursor.value + 1) % positions.length
  const idx = positions[htmlSearchCursor.value] ?? 0
  const el = htmlInputRef.value?.$el?.querySelector('textarea') as HTMLTextAreaElement | null
  if (!el) return
  // 关闭软换行：代码查看场景标准形态，逻辑行 = 视觉行，scrollTop 计算才精确
  el.setAttribute('wrap', 'off')
  el.setSelectionRange(idx, idx + query.length)
  el.focus()
  const style = getComputedStyle(el)
  const lineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.5 || 20
  const line = text.slice(0, idx).split('\n').length
  // 目标行置于视口上部（上留 4 行缓冲）
  el.scrollTop = Math.max(0, (line - 4) * lineHeight)
  // 水平跟随：列号 × 等宽字符宽度（scrollWidth / 最长行长），选中内容水平居中可见
  const lineStart = text.lastIndexOf('\n', idx) + 1
  const col = idx - lineStart
  const maxLineLen = Math.max(...text.split('\n').map((l) => l.length), 1)
  const charWidth = el.scrollWidth / maxLineLen
  el.scrollLeft = Math.max(0, col * charWidth - el.clientWidth / 2)
  htmlSearchPos.value = { index: htmlSearchCursor.value + 1, total: positions.length }
}
</script>

<template>
  <div class="badge-grid">
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
          <span v-if="htmlSearchPos" class="muted">第 {{ htmlSearchPos.index }} / {{ htmlSearchPos.total }} 处</span>
        </div>
        <el-input
          ref="htmlInputRef"
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
        <div class="hint">OCR 常把 5 认成 S、0 认成 O；请在表格里逐格核对后再生成，识别结果不会自动生效。</div>
      </div>

      <div class="panel">
        <div class="panel-title">识别配置（就地修改，保存为默认后重启沿用）</div>
        <div class="cfg-row">
          <span>识别方式</span>
          <el-radio-group v-model="vision.provider" size="small">
            <el-radio-button value="cloud">云端模型</el-radio-button>
            <el-radio-button value="paddleocr">本机 PaddleOCR</el-radio-button>
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

        <template v-else-if="vision.provider === 'paddleocr'">
          <div class="cfg-row">
            <span>命令</span>
            <div class="path-row" style="flex: 1">
              <el-input v-model="vision.paddleCommand" size="small" placeholder="Anaconda python.exe 绝对路径（选择或手动填写）" />
              <el-button size="small" @click="pickPython">选择文件</el-button>
            </div>
          </div>
          <div class="cfg-row">
            <span>参数</span>
            <el-input v-model="vision.paddleArgs" size="small" placeholder="{image}（应用自动前置适配器脚本）" style="max-width: 420px" />
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
        <div class="panel-title">badge 配置（作用于预览与生成）</div>
        <div class="cfg-row">
          <span>属性名</span>
          <el-input v-model="badgeAttr" size="small" style="width: 180px" />
        </div>
        <div class="cfg-row">
          <span>海报名</span>
          <el-input v-model="posterName" size="small" placeholder="海报名称（列表与导出文件名）" style="max-width: 320px" />
        </div>
        <div class="cfg-row">
          <span>文本位置</span>
          <el-select v-model="badgePositionText" size="small" style="width: 160px">
            <el-option v-for="opt in badgePositionOptions" :key="opt.value" :label="opt.label" :value="opt.value" />
          </el-select>
          <span>图片位置</span>
          <el-select v-model="badgePositionImage" size="small" style="width: 160px">
            <el-option v-for="opt in badgePositionOptions" :key="opt.value" :label="opt.label" :value="opt.value" />
          </el-select>
          <span class="muted">生成时写入 data-badge-position；&lt;a&gt; 上手写的属性优先</span>
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
          :ref="(el) => { previewFrame = el as HTMLIFrameElement | null }"
          class="preview-frame"
          :style="{ width: posterWidth + 'px' }"
          :srcdoc="previewHtml"
          sandbox="allow-same-origin"
        />
        <EmptyState v-else description="生成后在此预览 badge 副本" />
      </div>
    </div>
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
