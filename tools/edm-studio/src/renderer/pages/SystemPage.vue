<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { EmptyState } from '@sshk/ui-kit'
import MonacoEditor from '../MonacoEditor.vue'
import { api } from '../shared'

/**
 * 系统内容只读浏览（R3 消费端）：文件为源真相，运行时只读。
 * 树：品牌 → 片段/模板族 → 版本；选中后展示 元数据 / 源(njk) / 示例 / 预览（R5 就近 css 渲染）。
 * 树节点按类型配图标与色彩（与宿主 SidebarMenu 同一套内联 SVG 视觉语言，铁律 #19）；右侧编辑/预览撑满剩余高度。
 */
interface NodeData {
  type: 'brand' | 'family' | 'version'
  brandCode: string
  kind?: 'fragment' | 'template'
  familyCode?: string
  versionDir?: string
  metaPath?: string
  sourcePath?: string
  samplePath?: string
}
interface TreeNode {
  id: string
  label: string
  type: NodeData['type']
  data: NodeData
  children?: TreeNode[]
}

const model = ref<{ root: string; topCss: string[]; brands: any[] }>({ root: '', topCss: [], brands: [] })
const selected = ref<TreeNode | null>(null)
const metaText = ref('')
const sourceText = ref('')
const sampleText = ref('')
const previewHtml = ref('')
const loading = ref(false)

/** 节点类型 → 图标路径/色彩（路径与宿主 SidebarMenu 同源：品牌/片段/模板/版本） */
type NodeKind = 'brand' | 'family' | 'version' | 'fragment' | 'template'
const NODE_ICON: Record<NodeKind, { path: string; color: string }> = {
  brand: { path: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z', color: '#409eff' },
  fragment: { path: 'M4 4h7v7H4zM13 11h7v7h-7zM4 13h7v7H4zM13 4h4v4h4', color: '#67c23a' },
  template: { path: 'M4 5h16v14H4zM4 9h16M9 9v10', color: '#b882e8' },
  family: { path: 'M4 4h7v7H4zM13 11h7v7h-7zM4 13h7v7H4zM13 4h4v4h4', color: '#67c23a' },
  version: { path: 'M12 3a9 9 0 100 18 9 9 0 000-18zM12 7v5l3 3', color: '#e6a23c' },
}

/** 模板槽类型安全取值（避免 any 索引报错） */
function nodeIcon(kind: NodeKind | unknown): { path: string; color: string } {
  return NODE_ICON[(kind as NodeKind) in NODE_ICON ? (kind as NodeKind) : 'version']
}

async function load(): Promise<void> {
  loading.value = true
  try {
    model.value = (await api('system:load')) as typeof model.value
  } catch (err) {
    ElMessage.error((err as Error).message)
  } finally {
    loading.value = false
  }
}

function versionNode(brandCode: string, kind: 'fragment' | 'template', familyCode: string, v: any): TreeNode {
  return {
    id: `ver:${brandCode}:${kind}:${familyCode}:${v.dir || 'default'}`,
    label: v.dir === '' ? '（单版本折叠）' : v.dir,
    type: 'version',
    data: {
      type: 'version',
      brandCode,
      kind,
      familyCode,
      versionDir: v.dir,
      metaPath: `${v.path}/meta.yaml`,
      sourcePath: v.sourcePath,
      samplePath: `${v.path}/sample.yaml`,
    },
  }
}

const tree = computed<TreeNode[]>(() =>
  model.value.brands.map((b) => ({
    id: `brand:${b.code}`,
    label: `${b.meta.name}（${b.code}）`,
    type: 'brand',
    data: { type: 'brand', brandCode: b.code, metaPath: `${b.path}/meta.yaml` },
    children: [
      ...b.fragments.map((f: any) => ({
        id: `frag:${b.code}:${f.code}`,
        label: `片段 · ${f.meta.name}`,
        type: 'family' as const,
        data: { type: 'family', brandCode: b.code, kind: 'fragment', familyCode: f.code, metaPath: `${f.path}/meta.yaml` },
        children: f.versions.map((v: any) => versionNode(b.code, 'fragment', f.code, v)),
      })),
      ...b.templates.map((t: any) => ({
        id: `tpl:${b.code}:${t.code}`,
        label: `模板 · ${t.meta.name}`,
        type: 'family' as const,
        data: { type: 'family', brandCode: b.code, kind: 'template', familyCode: t.code, metaPath: `${t.path}/meta.yaml` },
        children: t.versions.map((v: any) => versionNode(b.code, 'template', t.code, v)),
      })),
    ],
  })),
)

async function read(file: string): Promise<string> {
  const r = await api('system:readFile', { file })
  return (r as string) ?? ''
}

async function onNode(node: TreeNode): Promise<void> {
  selected.value = node
  metaText.value = await read(node.data.metaPath ?? '')
  sourceText.value = ''
  sampleText.value = ''
  previewHtml.value = ''
  if (node.data.type === 'version') {
    sourceText.value = await read(node.data.sourcePath ?? '')
    sampleText.value = await read(node.data.samplePath ?? '')
    try {
      const res = (await api('system:render', {
        selector: { brandCode: node.data.brandCode, kind: node.data.kind, familyCode: node.data.familyCode, versionDir: node.data.versionDir },
      })) as { html: string }
      previewHtml.value = res.html
    } catch (err) {
      ElMessage.warning(`预览渲染失败：${(err as Error).message}`)
    }
  }
}

onMounted(load)
</script>

<template>
  <div class="system-page">
    <div class="head">
      <span class="title">
        <svg class="title-icon" viewBox="0 0 24 24" aria-hidden="true"><path :d="NODE_ICON.version.path" /></svg>
        系统内容（只读）
      </span>
      <el-button size="small" :loading="loading" @click="load">刷新</el-button>
    </div>
    <div class="body">
      <div class="tree-pane">
        <el-tree
          v-if="tree.length"
          :data="tree"
          node-key="id"
          default-expand-all
          highlight-current
          :expand-on-click-node="false"
          @node-click="(data: TreeNode) => onNode(data)"
        >
          <template #default="{ data }">
            <span class="tree-node" :class="`is-${String(data.type)}`">
              <svg class="node-icon" viewBox="0 0 24 24" aria-hidden="true" :style="{ color: nodeIcon(data.type).color }"><path :d="nodeIcon(data.type).path" /></svg>
              <span class="node-label">{{ data.label }}</span>
            </span>
          </template>
        </el-tree>
        <EmptyState v-else description="暂无系统内容" />
      </div>
      <div class="detail-pane">
        <el-empty v-if="!selected" description="选择左侧品牌 / 族 / 版本查看详情" :image-size="80" class="detail-empty" />
        <el-tabs v-else class="detail-tabs">
          <el-tab-pane label="元数据 meta.yaml">
            <MonacoEditor :model-value="metaText" language="yaml" read-only height="100%" />
          </el-tab-pane>
          <el-tab-pane v-if="selected.data.type === 'version'" label="源 njk">
            <MonacoEditor :model-value="sourceText" language="njk" read-only height="100%" />
          </el-tab-pane>
          <el-tab-pane v-if="selected.data.type === 'version'" label="示例 sample.yaml">
            <MonacoEditor :model-value="sampleText" language="yaml" read-only height="100%" />
          </el-tab-pane>
          <el-tab-pane v-if="selected.data.type === 'version'" label="预览">
            <iframe v-if="previewHtml" class="preview" :srcdoc="previewHtml" />
            <el-empty v-else description="无预览" :image-size="60" />
          </el-tab-pane>
        </el-tabs>
      </div>
    </div>
  </div>
</template>

<style scoped>
.system-page { display: flex; flex-direction: column; height: 100%; min-height: 0; }
.head { display: flex; align-items: center; justify-content: space-between; flex: none; padding-bottom: 8px; }
.title { font-weight: 600; display: inline-flex; align-items: center; gap: 6px; }
.title-icon { width: 16px; height: 16px; fill: none; stroke: var(--el-color-primary); stroke-width: 1.8; }
.body { display: flex; gap: 12px; flex: 1; min-height: 0; }

/* 左树：类型图标 + 色彩 */
.tree-pane { width: 300px; flex: none; border: 1px solid rgba(128,128,128,.2); border-radius: 6px; padding: 8px; overflow: auto; }
.tree-node { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; min-width: 0; }
.node-icon { flex: none; width: 14px; height: 14px; fill: none; stroke: currentcolor; stroke-width: 1.8; stroke-linejoin: round; }
.node-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tree-node.is-brand .node-label { font-weight: 600; }
.tree-node.is-version .node-label { opacity: .75; }

/* 右侧：tabs + 编辑/预览撑满剩余高度 */
.detail-pane { flex: 1; min-width: 0; min-height: 0; border: 1px solid rgba(128,128,128,.2); border-radius: 6px; padding: 8px; display: flex; flex-direction: column; }
.detail-empty { margin: auto; }
.detail-tabs { flex: 1; min-height: 0; display: flex; flex-direction: column; }
.detail-tabs :deep(.el-tabs__content) { flex: 1; min-height: 0; }
.detail-tabs :deep(.el-tab-pane) { height: 100%; }
.preview { width: 100%; height: 100%; border: none; background: #fff; border-radius: 4px; }
</style>
