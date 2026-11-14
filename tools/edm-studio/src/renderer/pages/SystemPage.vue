<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { EmptyState } from '@sshk/ui-kit'
import MonacoEditor from '../MonacoEditor.vue'
import { api } from '../shared'

/**
 * 系统内容只读浏览（R3 消费端）：文件为源真相，运行时只读。
 * 树：品牌 → 片段/模板族 → 版本；选中后展示 元数据 / 源(njk) / 示例 / 预览（R5 就近 css 渲染）。
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
      <span class="title">系统内容（只读）</span>
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
        />
        <EmptyState v-else description="暂无系统内容" />
      </div>
      <div class="detail-pane">
        <el-empty v-if="!selected" description="选择左侧品牌 / 族 / 版本查看详情" :image-size="80" />
        <el-tabs v-else>
          <el-tab-pane label="元数据 meta.yaml">
            <MonacoEditor :model-value="metaText" language="yaml" read-only height="360px" />
          </el-tab-pane>
          <el-tab-pane v-if="selected.data.type === 'version'" label="源 njk">
            <MonacoEditor :model-value="sourceText" language="njk" read-only height="360px" />
          </el-tab-pane>
          <el-tab-pane v-if="selected.data.type === 'version'" label="示例 sample.yaml">
            <MonacoEditor :model-value="sampleText" language="yaml" read-only height="360px" />
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
.system-page { display: flex; flex-direction: column; height: 100%; }
.head { display: flex; align-items: center; justify-content: space-between; flex: none; padding-bottom: 8px; }
.title { font-weight: 600; }
.body { display: flex; gap: 12px; flex: 1; min-height: 0; }
.tree-pane { width: 280px; flex: none; border: 1px solid rgba(128,128,128,.2); border-radius: 6px; padding: 8px; overflow: auto; }
.detail-pane { flex: 1; min-width: 0; border: 1px solid rgba(128,128,128,.2); border-radius: 6px; padding: 8px; overflow: auto; }
.preview { width: 100%; height: 420px; border: none; background: #fff; border-radius: 4px; }
</style>
