<script setup lang="ts">
import { computed, onMounted, onUnmounted } from 'vue'
import { api } from '../tool-api'
import { EmptyState, FormHint, useToolId } from '@sshk/ui-kit'
import { CodeEditor } from '@sshk/code-editor'
import SampleForm from '../components/SampleForm.vue'
import FieldSchemaDesigner from '../components/FieldSchemaDesigner.vue'
import ComposeEditor from '../components/ComposeEditor.vue'
import CssTabsEditor from '../components/CssTabsEditor.vue'
import SaveAsDialog from '../components/SaveAsDialog.vue'
import FaviconField from '../components/FaviconField.vue'
import CodeNameDialog from '../components/CodeNameDialog.vue'
import { NODE_ICON, nodeIcon, useContentTree, type TreeNode } from '../composables/useContentTree'
import { useNodeDetail } from '../composables/useNodeDetail'
import { useComposePreview, type ComposePreview } from '../composables/useComposePreview'
import { useCssTabs } from '../composables/useCssTabs'
import { useContextMenu } from '../composables/useContextMenu'
import { useSaveAs } from '../composables/useSaveAs'
import { inheritedFavicon } from '../composables/node-favicon'

/**
 * 系统内容页（R12–R14 效果版）：
 * - 树：EDM → 品牌 → 片段/模板（类目）→ 族 → 版本，各级可挂 css 目录（v5 六处）
 * - 右键（v5 分层）：EDM 仅粘贴；品牌/族/版本=另存为+重命名+删除+粘贴；类目=重命名+删除+粘贴；
 *   css 目录=另存为+复制+粘贴+新建文件+重命名+删除；css 文件=另存为+复制+重命名+删除
 * - 编辑门控（R12）：main 裁决 canEdit（dev 全权 / 打包版需 developerMode），只读时隐藏一切编辑 UI
 * - 右侧：品牌/族=元数据（表单↔数据切换 R17）；版本=元数据/示例/njk/预览；css 文件=多 tab（外置 css）
 *
 * P6-4 拆分（B37-F4）：本文件收缩为「树+详情」布局编排壳，按真实职责抽 composables——
 * useContentTree（双顶层树构造+IO+冲突抉择）/ useNodeDetail（元数据/示例/源码/样式编辑+单渲预览）/
 * useComposePreview（R19 组合预览+R22 布局弹框+Q12 placement 数据）/ useCssTabs（外置 css 多 tab）/
 * useContextMenu（v5 分层右键菜单）/ useSaveAs（另存为）；组件 CssTabsEditor / SaveAsDialog。
 * 行为零变化（edm 系统内容播种/编辑流为回归锚，edm-seed.test.ts）。
 */
const toolId = useToolId()

/* ── 组合预览域先声明占位：树 load 完成后的族 meta 预读回调经它转发（构造顺序：树 → 详情 → 组合） ── */
let compose: ComposePreview | null = null

/* ── 树域：双顶层树 + 基础 IO + 冲突抉择 ── */
const treeDomain = useContentTree({ onLoaded: () => { void compose?.prefetchFamilyMetas() } })
/* ── 详情编辑域：元数据/示例/源码/样式 + 单渲预览 ── */
const detail = useNodeDetail({
  selected: treeDomain.selected,
  read: treeDomain.read,
  write: treeDomain.write,
  load: treeDomain.load,
  toolId,
})
/* ── css 多 tab 域 ── */
const cssTabsDomain = useCssTabs({
  read: treeDomain.read,
  write: treeDomain.write,
  selected: treeDomain.selected,
  renderPreview: detail.renderPreview,
})
/* ── 组合预览域（R19/R22/Q12） ── */
compose = useComposePreview({
  selected: treeDomain.selected,
  tree: treeDomain.tree,
  metaRaw: detail.metaRaw,
  read: treeDomain.read,
  previewHtml: detail.previewHtml,
  previewing: detail.previewing,
})
/* ── 另存为域（R24） ── */
const saveAsDomain = useSaveAs({
  canEditSystem: treeDomain.canEditSystem,
  load: treeDomain.load,
  read: treeDomain.read,
  write: treeDomain.write,
  existsIn: treeDomain.existsIn,
  basename: treeDomain.basename,
  splitPath: treeDomain.splitPath,
  allCssDirs: treeDomain.allCssDirs,
  tree: treeDomain.tree,
  pasteFileInto: treeDomain.pasteFileInto,
})
/* ── 右键菜单域（v5 分层） ── */
const ctxDomain = useContextMenu({
  selected: treeDomain.selected,
  canEditSystem: treeDomain.canEditSystem,
  load: treeDomain.load,
  existsIn: treeDomain.existsIn,
  read: treeDomain.read,
  write: treeDomain.write,
  basename: treeDomain.basename,
  validCode: treeDomain.validCode,
  promptCodeAndName: treeDomain.promptCodeAndName,
  nextVersionOf: treeDomain.nextVersionOf,
  parseVersion: treeDomain.parseVersion,
  resolveConflict: treeDomain.resolveConflict,
  pasteFileInto: treeDomain.pasteFileInto,
  dropTabsUnder: cssTabsDomain.dropTabsUnder,
  renameTabsUnder: cssTabsDomain.renameTabsUnder,
  openSaveAs: saveAsDomain.openSaveAs,
})

/* ── 模板绑定解构 ── */
const { canEditSystem, canEdit, loading, selected, defaultExpandedKeys, treeReady, stats, allCssDirs, setTreeRef, load, codeNameState, confirmCodeName, cancelCodeName } = treeDomain
const treeData = treeDomain.tree
const { metaMode, metaText, sourceText, sampleText, styleText, previewHtml, previewing, sampleMode, sampleSchema, sampleObj, form, showForm, faviconHint, switchSampleMode, switchMetaMode, saveMeta, saveSource, saveStyle, saveSample, saveFields } = detail
const { composeTemplate, composePlacements, composeOpen, composeHostLabel, hostTemplateOptions, composeFragmentOptions, composeSlotDefs, onHostTemplateChange, renderComposePreview, closeComposeDialog, placementData, openPlacementData, savePlacementData } = compose
const { cssTabs, activeCss, openCssTab, onCssEdit, saveCss, saveAllCss, closeCssTab } = cssTabsDomain
const { menu, menuItems, onContextMenu, onDocMouseDown, onMenu } = ctxDomain
const { saveAsState, saveAsTargetOptions, confirmSaveAs } = saveAsDomain

/** 片段类型候选：双根模板族 meta.slots 的 type 聚合，供片段族 type 下拉；仍允许自定义输入 */
const typeOptions = computed<string[]>(() => {
  const out = new Set<string>()
  for (const model of [treeDomain.sysModel.value, treeDomain.cusModel.value]) {
    for (const brand of (model?.brands ?? []) as any[]) {
      for (const fam of (brand.templates ?? []) as any[]) {
        for (const slot of (fam.meta?.slots ?? []) as any[]) {
          const t = String(slot?.type ?? '').trim()
          if (t) out.add(t)
        }
      }
      // 自定义输入的片段类型也在选项里：保存后 load 刷新模型，切到其他片段即可复用该选项（#2）
      for (const fam of (brand.fragments ?? []) as any[]) {
        const t = String(fam.meta?.type ?? '').trim()
        if (t) out.add(t)
      }
    }
  }
  return [...out].sort()
})

/** 版本字段直接回显真实目录名：default / standard / v1 各自独立，避免都显示 v1 的歧义（#1） */
const versionDirLabel = computed(() => {
  const n = selected.value
  return n?.kind === 'version' ? (n.data.versionDir || 'default') : ''
})

/** favicon 继承预览：版本 → 族 → 类型 → 品牌；自身空时显示上级实际图标 */
const faviconInherited = computed(() => {
  const n = selected.value
  if (!n) return ''
  const model = n.data.source === 'custom' ? treeDomain.cusModel.value : treeDomain.sysModel.value
  const brand = (model.brands as any[]).find((b) => b.code === n.data.brandCode)
  const catMeta = n.data.cat === 'fragment' ? brand?.fragmentMeta : brand?.templateMeta
  const famList = n.data.cat === 'fragment' ? brand?.fragments : brand?.templates
  const fam = (famList ?? []).find((f: any) => f.code === n.data.familyCode)
  return inheritedFavicon(n.kind, {
    brand: String(brand?.meta?.favicon ?? ''),
    category: String((catMeta as any)?.favicon ?? ''),
    family: String((fam?.meta as any)?.favicon ?? ''),
  })
})

async function onNode(node: TreeNode): Promise<void> {
  selected.value = node
  if (node.kind === 'cssFile') {
    await openCssTab(node.data.path, node.data.source)
    return
  }
  await detail.loadNode(node)
  compose!.resetForNode(node)
  await detail.renderPreview(node)
}

onMounted(async () => {
  document.addEventListener('mousedown', onDocMouseDown)
  try {
    canEditSystem.value = ((await api('system:canEdit')) as { canEdit: boolean }).canEdit
  } catch {
    canEditSystem.value = false
  }
  await load()
})
onUnmounted(() => {
  document.removeEventListener('mousedown', onDocMouseDown)
})
</script>

<template>
  <div class="system-page">
    <div class="head">
      <span class="title">
        <svg class="title-icon" viewBox="0 0 24 24" aria-hidden="true"><path :d="NODE_ICON.root.path" /></svg>
        内容管理
      </span>
      <div class="head-actions">
        <el-tag :type="canEdit ? 'success' : 'info'" size="small">{{ canEdit ? '可编辑' : '只读' }}</el-tag>
        <el-button size="small" :loading="loading" @click="load()">刷新</el-button>
      </div>
    </div>
    <div class="body">
      <div class="tree-pane">
        <el-tree
          v-if="treeReady && treeData.length"
          :ref="setTreeRef"
          :data="treeData"
          node-key="id"
          :default-expanded-keys="defaultExpandedKeys"
          highlight-current
          :expand-on-click-node="false"
          @node-click="(data: TreeNode) => onNode(data)"
          @node-contextmenu="(e: MouseEvent, data: TreeNode) => onContextMenu(e, data)"
        >
          <template #default="{ data }">
            <span class="tree-node" :class="`is-${String(data.kind)}`">
              <svg class="node-icon" viewBox="0 0 24 24" aria-hidden="true" :style="{ color: nodeIcon(data.kind, data.data.cat).color }"><path :d="nodeIcon(data.kind, data.data.cat).path" /></svg>
              <span class="node-label">{{ data.label }}</span>
            </span>
          </template>
        </el-tree>
        <EmptyState v-else :description="loading ? '正在加载内容…' : '暂无系统内容'" />
      </div>
      <div class="detail-pane">
        <!-- css 文件多 tab 编辑（选中 css 文件时） -->
        <template v-if="selected?.kind === 'cssFile' && cssTabs.length">
          <CssTabsEditor v-model:active="activeCss" :tabs="cssTabs" :can-edit="canEdit" @edit="onCssEdit" @save="saveCss" @save-all="saveAllCss" @close="closeCssTab" />
        </template>
        <el-empty v-else-if="!selected" description="选择左侧节点查看 / 编辑" :image-size="80" class="detail-empty" />
        <!-- EDM 根概览 -->
        <div v-else-if="selected.kind === 'root'" class="overview">
          <el-descriptions :title="`${selected.data.label} 概览`" :column="3" border>
            <el-descriptions-item label="品牌">{{ stats.brands }}</el-descriptions-item>
            <el-descriptions-item label="片段族">{{ stats.fragments }}</el-descriptions-item>
            <el-descriptions-item label="模板族">{{ stats.templates }}</el-descriptions-item>
          </el-descriptions>
          <EmptyState :description="canEdit ? '根节点右键可新建品牌 / 编辑内容' : '只读模式：浏览与预览'" />
        </div>
        <!-- css 目录：仅展开折叠入口 -->
        <el-empty v-else-if="selected.kind === 'cssDir'" description="点具体 css 文件进行编辑（多 tab 互相参照）；右键可复制 / 粘贴 / 新建文件 / 另存为" :image-size="80" />
        <!-- 品牌 / 类目 / 族 / 版本 -->
        <el-tabs v-else class="detail-tabs">
          <el-tab-pane label="元数据">
            <div class="editor-toolbar">
              <el-radio-group :model-value="metaMode" size="small" @change="(m: unknown) => switchMetaMode(m as 'form' | 'data')">
                <el-radio-button value="form">表单</el-radio-button>
                <el-radio-button value="data">数据</el-radio-button>
              </el-radio-group>
              <el-button size="small" type="primary" :disabled="!canEdit" class="push-right" @click="saveMeta">保存</el-button>
            </div>
            <el-form v-if="metaMode === 'form' && showForm.base" label-width="auto" class="meta-form">
              <el-form-item label="code" required>
                <el-input v-model="form.code" :disabled="!canEdit || showForm.codeReadonly" />
                <div v-if="!form.code.trim()" class="meta-field-tip">code 必填</div>
                <FormHint>目录名的只读镜像；重命名自动同步，后续可切换为独立业务编码</FormHint>
              </el-form-item>
              <el-form-item label="名称" required>
                <el-input clearable v-model="form.name" :disabled="!canEdit" />
                <div v-if="!form.name.trim()" class="meta-field-tip">名称必填</div>
              </el-form-item>
              <el-form-item v-if="showForm.favicon" label="图标">
                <FaviconField v-model="form.favicon" :readonly="!canEdit" :inherit-hint="faviconHint" :inherited-value="faviconInherited" />
              </el-form-item>
              <el-form-item label="描述"><el-input v-model="form.description" type="textarea" :rows="2" :disabled="!canEdit" /></el-form-item>
              <template v-if="showForm.policy">
                <el-form-item label="类型" required>
                  <el-select v-model="form.type" filterable allow-create default-first-option clearable :disabled="!canEdit" placeholder="选择或输入，如 header / product">
                    <el-option v-for="t in typeOptions" :key="t" :value="t" :label="t" />
                  </el-select>
                  <div v-if="!form.type.trim()" class="meta-field-tip">类型必填（需与模板 slot 的 type 一致）</div>
                  <FormHint>片段按此类型匹配模板插槽；一个片段族单值，多选请建多个族</FormHint>
                </el-form-item>
                <el-form-item label="黑名单"><el-input clearable v-model="form.policyB" :disabled="!canEdit" placeholder="逗号分隔，标签内可含空格" /></el-form-item>
                <el-form-item label="白名单"><el-input clearable v-model="form.policyW" :disabled="!canEdit" placeholder="为空 = 本品牌内全部模板可用" /></el-form-item>
              </template>
              <el-form-item v-if="showForm.version" label="版本目录名">
                <el-input :model-value="versionDirLabel" disabled />
                <FormHint>直接回显真实目录名，default / v1 各自独立</FormHint>
              </el-form-item>
              <el-form-item v-if="showForm.version" label="变更说明"><el-input v-model="form.changelog" type="textarea" :rows="2" :disabled="!canEdit" /></el-form-item>
            </el-form>
            <CodeEditor v-else :model-value="metaText" :path="`meta:${selected.data.path}`" language="yaml" :readonly="!canEdit" height="calc(100% - 40px)" @update:model-value="(v: string) => (metaText = v)" @save="saveMeta" />
          </el-tab-pane>
          <el-tab-pane v-if="selected.kind === 'version'" label="示例数据">
            <div class="editor-toolbar">
              <el-radio-group :model-value="sampleMode" size="small" @change="(m: unknown) => switchSampleMode(m as 'form' | 'data' | 'design')">
                <el-radio-button value="design">设计</el-radio-button>
                <el-radio-button value="form" :disabled="!sampleSchema.length">表单</el-radio-button>
                <el-radio-button value="data">数据</el-radio-button>
              </el-radio-group>
              <el-tag v-if="sampleMode !== 'design' && !sampleSchema.length" size="small" type="info">未声明 fields schema（meta.yaml fields:），仅数据模式</el-tag>
              <el-tag v-else-if="sampleMode === 'design' && !sampleSchema.length" size="small" type="warning">尚无字段，点「新增字段」开始设计</el-tag>
              <FormHint v-if="sampleMode === 'design'" inline>拖拽 ≡ 调整顺序；保存写入 meta.yaml 的 fields:</FormHint>
              <el-button v-if="sampleMode === 'design'" size="small" type="primary" :disabled="!canEdit" class="push-right" @click="saveFields">保存字段定义</el-button>
              <el-button v-else size="small" type="primary" :disabled="!canEdit" class="push-right" @click="saveSample">保存</el-button>
            </div>
            <FieldSchemaDesigner v-if="sampleMode === 'design'" v-model="sampleSchema" :readonly="!canEdit" />
            <div v-else-if="sampleMode === 'form' && sampleSchema.length" class="sample-wrap">
              <SampleForm v-model="sampleObj" :fields="sampleSchema" :readonly="!canEdit" />
            </div>
            <CodeEditor v-else :model-value="sampleText" :path="`sample:${selected.data.path}`" language="yaml" :readonly="!canEdit" height="calc(100% - 40px)" @update:model-value="(v: string) => (sampleText = v)" @save="saveSample" />
          </el-tab-pane>
          <el-tab-pane v-if="selected.kind === 'version'" label="预览">
            <div class="editor-toolbar">
              <el-button size="small" type="primary" plain :disabled="!canEdit" @click="composeOpen = true">片段布局配置</el-button>
              <FormHint inline>布局 {{ composePlacements.length }} 项 · 宿主模板：{{ composeHostLabel }}</FormHint>
              <el-button size="small" type="success" plain :loading="previewing" class="push-right" @click="renderComposePreview">刷新预览</el-button>
            </div>
            <iframe v-if="previewHtml" class="preview" :srcdoc="previewHtml" />
            <el-empty
              v-else
              description="点「片段布局配置」选宿主模板与片段摆放；「刷新预览」为本版本单渲效果"
              :image-size="60"
            />
          </el-tab-pane>
          <el-tab-pane v-if="selected.kind === 'version'" label="源码">
            <div class="editor-toolbar">
              <FormHint inline>内联 css 也可直接写在 njk 的 &lt;style&gt; 内</FormHint>
              <el-button size="small" type="primary" :disabled="!canEdit" class="push-right" @click="saveSource">保存</el-button>
            </div>
            <CodeEditor :model-value="sourceText" :path="`source:${selected.data.path}`" language="njk" :readonly="!canEdit" height="calc(100% - 40px)" @update:model-value="(v: string) => (sourceText = v)" @save="saveSource" />
          </el-tab-pane>
          <el-tab-pane v-if="selected.kind === 'version'" label="样式">
            <div class="editor-toolbar">
              <FormHint inline>内联样式：保存至版本目录 style.css，渲染时最后注入（优先级最高）；外置 css 走左树 css 目录</FormHint>
              <el-button size="small" type="primary" :disabled="!canEdit" class="push-right" @click="saveStyle">保存</el-button>
            </div>
            <CodeEditor :model-value="styleText" :path="`style:${selected.data.path}`" language="css" :readonly="!canEdit" height="calc(100% - 40px)" @update:model-value="(v: string) => (styleText = v)" @save="saveStyle" />
          </el-tab-pane>
        </el-tabs>
      </div>
    </div>

    <!-- 右键菜单 -->
    <teleport to="body">
      <div v-if="menu" class="ctx-menu" :style="{ left: `${menu.x}px`, top: `${menu.y}px` }">
        <div v-for="item in menuItems" :key="item.key" class="ctx-item" :class="{ danger: item.danger }" @click.stop="onMenu(item.key)">{{ item.label }}</div>
      </div>
    </teleport>

    <!-- 另存为弹框（R24；状态与确认逻辑在 useSaveAs 域） -->
    <SaveAsDialog :state="saveAsState" :target-options="saveAsTargetOptions" :css-dirs="allCssDirs" @confirm="confirmSaveAs" />
    <CodeNameDialog :state="codeNameState" @confirm="confirmCodeName" @cancel="cancelCodeName" />

    <!-- placement 独立数据编辑（Q12：有 fields schema 用表单，否则 YAML） -->
    <el-dialog v-model="placementData.open" title="片段数据" width="560px" :close-on-click-modal="false" :close-on-press-escape="false">
      <SampleForm v-if="placementData.fields.length" v-model="placementData.obj" :fields="placementData.fields" />
      <CodeEditor v-else :model-value="placementData.yamlText" language="yaml" height="320px" @update:model-value="(v: string) => (placementData.yamlText = v)" @save="savePlacementData" />
      <template #footer>
        <el-button @click="placementData.open = false">取消</el-button>
        <el-button type="primary" @click="savePlacementData">保存并刷新预览</el-button>
      </template>
    </el-dialog>

    <!-- 片段布局配置弹框（R22：宿主模板选择 + 组合编辑器收进弹框，预览页只留预览） -->
    <el-dialog v-model="composeOpen" title="片段布局配置" width="720px" :close-on-click-modal="false" :close-on-press-escape="false">
      <div v-if="selected?.data.cat === 'fragment'" class="editor-toolbar" style="padding-bottom: 10px">
        <FormHint inline>宿主模板</FormHint>
        <el-select
          size="small"
          filterable
          style="width: 300px"
          :model-value="composeTemplate"
          placeholder="选择宿主模板（组合预览）"
          @update:model-value="(v: string) => { composeTemplate = v; onHostTemplateChange(v) }"
        >
          <el-option v-for="t in hostTemplateOptions" :key="t.id" :value="t.id" :label="t.label" />
        </el-select>
        <FormHint inline>拖拽 = 区块内排序；次数 = 重复渲染</FormHint>
      </div>
      <div v-else class="editor-toolbar" style="padding-bottom: 10px">
        <FormHint inline>拖入片段布局，模板 css + 片段 css 就近合并看真实效果</FormHint>
      </div>
      <ComposeEditor
        v-if="composeSlotDefs.length"
        v-model="composePlacements"
        :slots="composeSlotDefs"
        :fragment-options="composeFragmentOptions"
        :readonly="!canEdit"
        class="compose-editor-dialog"
        @edit-data="openPlacementData"
      />
      <el-empty v-else description="先选择宿主模板" :image-size="60" />
      <template #footer>
        <el-button @click="composeOpen = false">取消</el-button>
        <el-button type="primary" @click="closeComposeDialog">完成并刷新预览</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.system-page { display: flex; flex-direction: column; height: 100%; min-height: 0; }
.head { display: flex; align-items: center; justify-content: space-between; flex: none; padding-bottom: 8px; }
.title { font-weight: 600; display: inline-flex; align-items: center; gap: 6px; }
.title-icon { width: 16px; height: 16px; fill: none; stroke: var(--el-color-primary); stroke-width: 1.8; }
.head-actions { display: inline-flex; align-items: center; gap: 8px; }
.body { display: flex; gap: 12px; flex: 1; min-height: 0; }

.tree-pane { width: 300px; flex: none; border: 1px solid rgba(128,128,128,.2); border-radius: 6px; padding: 8px; overflow: auto; }
.tree-node { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; min-width: 0; }
.node-icon { flex: none; width: 14px; height: 14px; fill: none; stroke: currentcolor; stroke-width: 1.8; stroke-linejoin: round; }
.node-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tree-node.is-brand .node-label, .tree-node.is-root .node-label { font-weight: 600; }
.tree-node.is-version .node-label, .tree-node.is-cssFile .node-label { opacity: .75; }

.detail-pane { flex: 1; min-width: 0; min-height: 0; border: 1px solid rgba(128,128,128,.2); border-radius: 6px; padding: 8px; display: flex; flex-direction: column; }
.detail-empty { margin: auto; }
.detail-tabs { flex: 1; min-height: 0; display: flex; flex-direction: column; }
.detail-tabs :deep(.el-tabs__content) { flex: 1; min-height: 0; }
.detail-tabs :deep(.el-tab-pane) { height: 100%; display: flex; flex-direction: column; }
.editor-toolbar { display: flex; align-items: center; gap: 10px; flex: none; padding-bottom: 6px; }
/* 保存/刷新预览类主按钮居右，描述与其他操作居左 */
.editor-toolbar .push-right { margin-left: auto; }
/* EP radio-button 以 outline 画边框（不占布局，深色工具栏上被相邻元素覆盖出现左侧缺边）：
   改为真实 border + 独立圆角 chip，边框完整 */
.editor-toolbar :deep(.el-radio-group) { gap: 6px; }
.editor-toolbar :deep(.el-radio-button .el-radio-button__inner) {
  outline: none;
  border: 1px solid var(--el-border-color);
  border-radius: 4px;
  box-shadow: none;
}
.editor-toolbar :deep(.el-radio-button.is-active .el-radio-button__inner),
.editor-toolbar :deep(.el-radio-button__original-radio:checked + .el-radio-button__inner) {
  border-color: var(--el-color-primary) !important;
}
.meta-form { overflow: auto; }
/* 必填校验提示：与控件同列、红色，校验失败不发 IPC */
.meta-field-tip { color: var(--el-color-danger); font-size: 12px; line-height: 1.3; }
/* #2 表单 label 防换行：长 label（如「code（目录名）」）不再折行破坏行对齐 */
.meta-form :deep(.el-form-item__label) { white-space: nowrap; }
.sample-wrap { flex: 1; min-height: 0; overflow: auto; padding: 4px 2px; }
.overview { display: flex; flex-direction: column; gap: 16px; overflow: auto; }
.preview { flex: 1; width: 100%; border: none; background: #fff; border-radius: 4px; }
.compose-editor-dialog { height: 46vh; overflow: auto; padding-bottom: 6px; }

.ctx-menu { position: fixed; z-index: 3000; min-width: 130px; background: var(--el-bg-color-overlay, #fff); border: 1px solid rgba(128,128,128,.25); border-radius: 6px; box-shadow: 0 4px 16px rgba(0,0,0,.18); padding: 4px; }
.ctx-item { padding: 6px 12px; font-size: 13px; border-radius: 4px; cursor: pointer; color: var(--el-text-color-primary); }
.ctx-item:hover { background: var(--el-fill-color-light, rgba(128,128,128,.12)); }
.ctx-item.danger { color: var(--el-color-danger); }
</style>
