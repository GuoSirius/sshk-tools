<script setup lang="ts">
import { computed, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { CopyDocument, Delete, Plus } from '@element-plus/icons-vue'
import { EmptyState } from '@sshk/ui-kit'
import MonacoEditor from '../MonacoEditor.vue'
import {
  api, confirmRemove, isSystem,
  type Named, type VersionRow,
} from '../shared'
import {
  brands, fragments, templates, tplVersionsAll, frgvVersions,
  loadBrands, loadTemplates, loadFragments, loadTplVersionsAll, loadFrgvVersions,
} from '../state'

/**
 * 自定义内容（R18 落地，v5 约定）：与「系统内容」页同形态——左树实体结构 + 右侧详情。
 * - 数据源 NeDB：品牌 → 片段/模板类目 → 族 → 版本（css inline 在版本 source 内，无文件域）；
 * - origin=custom 全权 CRUD（品牌/族/版本直编，版本保存即原地生效）；origin=system 只读，
 *   供派生源浏览（派生入口在系统内容页「另存为 → 自定义内容」），版本可「复制为新族」；
 * - 旧菜单 id brands/templates/fragments 兼容映射到本页。
 */
type Cat = 'fragment' | 'template'
type NodeKind = 'root' | 'brand' | 'category' | 'family' | 'version'

interface NodeData {
  kind: NodeKind
  brandId?: string
  brandCode?: string
  cat?: Cat
  familyId?: string
  family?: Named
  version?: VersionRow
}
interface TreeNode { id: string; label: string; kind: NodeKind; data: NodeData; children?: TreeNode[] }

/* ── 图标（与系统内容页同一视觉语言） ── */
const NODE_ICON: Record<string, { path: string; color: string }> = {
  root: { path: 'M12 2L2 7v10l10 5 10-5V7z', color: '#909399' },
  brand: { path: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z', color: '#409eff' },
  fragment: { path: 'M4 4h7v7H4zM13 11h7v7h-7zM4 13h7v7H4zM13 4h4v4h4', color: '#67c23a' },
  template: { path: 'M4 5h16v14H4zM4 9h16M9 9v10', color: '#b882e8' },
  family: { path: 'M4 4h16v16H4zM4 9h16M9 9v11', color: '#909399' },
  version: { path: 'M12 3a9 9 0 100 18 9 9 0 000-18zM12 7v5l3 3', color: '#e6a23c' },
}
function nodeIcon(kind: string): { path: string; color: string } {
  return NODE_ICON[kind] ?? NODE_ICON.version!
}

/* ── 左树构造 ── */
const tree = computed<TreeNode[]>(() => {
  const root: TreeNode = { id: 'root', label: '自定义内容', kind: 'root', data: { kind: 'root' }, children: [] }
  for (const b of brands.value) {
    const brandId = b._id
    const catNode = (cat: Cat, label: string, families: Named[], idOf: (f: Named) => string, versionsOf: (f: Named) => VersionRow[]): TreeNode => ({
      id: `cat:${brandId}:${cat}`,
      label,
      kind: 'category',
      data: { kind: 'category', brandId, brandCode: b.code, cat },
      children: families.map((f) => ({
        id: idOf(f),
        label: f.name,
        kind: 'family',
        data: { kind: 'family', brandId, brandCode: b.code, cat, familyId: f._id, family: f },
        children: versionsOf(f).map((v) => ({
          id: v._id,
          label: `${v.label ?? `v${v.version}`}${isSystem(v) ? ' · 系统' : ''}`,
          kind: 'version',
          data: { kind: 'version', brandId, brandCode: b.code, cat, familyId: f._id, family: f, version: v },
        })),
      })),
    })
    const fragFams = fragments.value.filter((f) => f.brandId === brandId)
    const tplFams = templates.value.filter((f) => f.brandId === brandId)
    root.children!.push({
      id: `brand:${brandId}`,
      label: `${b.code}（${b.name}）${isSystem(b) ? ' · 系统' : ''}`,
      kind: 'brand',
      data: { kind: 'brand', brandId, brandCode: b.code },
      children: [
        catNode('fragment', '片段', fragFams, (f) => `fam:${f._id}`, (f) => frgvVersions.value.filter((v) => v.fragmentId === f._id)),
        catNode('template', '模板', tplFams, (f) => `fam:${f._id}`, (f) => tplVersionsAll.value.filter((v) => v.templateId === f._id)),
      ],
    })
  }
  return [root]
})

const selected = ref<TreeNode | null>(null)
function findNode(nodes: TreeNode[], id: string): TreeNode | null {
  for (const n of nodes) {
    if (n.id === id) return n
    const hit = n.children ? findNode(n.children, id) : null
    if (hit) return hit
  }
  return null
}
function onNode(node: TreeNode): void {
  selected.value = node
  if (node.kind === 'brand') fillBrandForm(node)
  if (node.kind === 'family') fillFamilyForm(node)
  if (node.kind === 'version') fillVersionForm(node)
  previewHtml.value = ''
}

async function reload(keepId?: string): Promise<void> {
  await Promise.all([loadBrands(), loadTemplates(), loadFragments(), loadTplVersionsAll(), loadFrgvVersions()])
  if (keepId) {
    const hit = findNode(tree.value, keepId)
    if (hit) {
      selected.value = hit
      if (hit.kind === 'brand') fillBrandForm(hit)
      if (hit.kind === 'family') fillFamilyForm(hit)
      if (hit.kind === 'version') fillVersionForm(hit)
      return
    }
  }
  selected.value = null
}

/** 可编辑 = 非 system（custom 全权；D8 版本不可变仅约束系统内容，自定义副本归用户所有） */
function editable(node: TreeNode | null): boolean {
  if (!node) return false
  if (node.kind === 'brand') {
    const b = brands.value.find((x) => x._id === node.data.brandId)
    return !!b && !isSystem(b)
  }
  if (node.kind === 'family') return !isSystem(node.data.family!)
  if (node.kind === 'version') return !isSystem(node.data.version!)
  return false
}

/* ── 品牌详情 ── */
const brandForm = ref<{ code: string; name: string; logo: string }>({ code: '', name: '', logo: '' })
function fillBrandForm(node: TreeNode): void {
  const b = brands.value.find((x) => x._id === node.data.brandId)
  brandForm.value = { code: String(b?.code ?? ''), name: String(b?.name ?? ''), logo: String(b?.logo ?? '') }
}
async function saveBrand(): Promise<void> {
  const node = selected.value
  if (!node?.data.brandId) return
  try {
    await api('brand:save', { _id: node.data.brandId, ...brandForm.value })
    ElMessage.success('品牌已保存')
    await reload(node.id)
  } catch (err) { ElMessage.error((err as Error).message) }
}
async function removeBrand(): Promise<void> {
  const node = selected.value
  if (!node?.data.brandId) return
  await confirmRemove('删除品牌', brandForm.value.name, async () => {
    await api('brand:remove', { _id: node.data.brandId })
    await reload()
  })
}
const brandOpen = ref(false)
const newBrand = ref<{ code: string; name: string }>({ code: '', name: '' })
async function createBrand(): Promise<void> {
  try {
    await api('brand:save', { _id: '', ...newBrand.value })
    brandOpen.value = false
    newBrand.value = { code: '', name: '' }
    ElMessage.success('品牌已创建')
    await reload()
  } catch (err) { ElMessage.error((err as Error).message) }
}

/* ── 族详情 ── */
const familyForm = ref<{ name: string; type: string; description: string }>({ name: '', type: '', description: '' })
function fillFamilyForm(node: TreeNode): void {
  const f = node.data.family
  familyForm.value = {
    name: String(f?.name ?? ''),
    type: String(f?.type ?? 'product'),
    description: String(f?.description ?? ''),
  }
}
async function saveFamily(): Promise<void> {
  const node = selected.value
  if (!node?.data.familyId || node.data.cat !== 'fragment' && node.data.cat !== 'template') return
  try {
    if (node.data.cat === 'fragment') {
      await api('frg:save', { _id: node.data.familyId, brandId: node.data.brandId, name: familyForm.value.name, type: familyForm.value.type || 'product' })
    } else {
      await api('tpl:save', { _id: node.data.familyId, brandId: node.data.brandId, name: familyForm.value.name, description: familyForm.value.description })
    }
    ElMessage.success('族已保存')
    await reload(node.id)
  } catch (err) { ElMessage.error((err as Error).message) }
}
async function removeFamily(): Promise<void> {
  const node = selected.value
  if (!node?.data.familyId || node.data.cat !== 'fragment' && node.data.cat !== 'template') return
  await confirmRemove('删除族', familyForm.value.name, async () => {
    await api(node.data.cat === 'fragment' ? 'frg:remove' : 'tpl:remove', { _id: node.data.familyId })
    await reload()
  })
}
const familyOpen = ref(false)
const familyDialogCat = ref<Cat>('fragment')
const dialogBrandId = ref('')
const newFamily = ref<{ name: string; type: string }>({ name: '', type: 'product' })
function openFamilyDialog(brandId: string, cat: Cat): void {
  dialogBrandId.value = brandId
  familyDialogCat.value = cat
  newFamily.value = { name: '', type: 'product' }
  familyOpen.value = true
}
async function createFamily(): Promise<void> {
  try {
    if (familyDialogCat.value === 'fragment') {
      await api('frg:save', { _id: '', brandId: dialogBrandId.value, name: newFamily.value.name, type: newFamily.value.type || 'product' })
    } else {
      await api('tpl:save', { _id: '', brandId: dialogBrandId.value, name: newFamily.value.name })
    }
    familyOpen.value = false
    ElMessage.success('族已创建')
    await reload()
  } catch (err) { ElMessage.error((err as Error).message) }
}

/* ── 版本详情：元数据 / 源码 / 示例数据 / 预览 ── */
const versionTab = ref('meta')
const versionForm = ref<{ label: string; policyB: string; policyW: string }>({ label: '', policyB: '', policyW: '' })
const sourceForm = ref<{ html: string; css: string }>({ html: '', css: '' })
const sampleText = ref('')
const previewHtml = ref('')
const rendering = ref(false)

function fillVersionForm(node: TreeNode): void {
  const v = node.data.version
  if (!v) return
  versionForm.value = {
    label: String(v.label ?? `v${v.version}`),
    policyB: (v.policy?.blacklist ?? []).join('、'),
    policyW: (v.policy?.whitelist ?? []).join('、'),
  }
  sourceForm.value = { html: String(v.source?.html ?? ''), css: String(v.source?.css ?? '') }
  sampleText.value = v.sampleData && Object.keys(v.sampleData).length ? JSON.stringify(v.sampleData, null, 2) : '{}'
}
function versionPatch(kind: 'meta' | 'source' | 'sample'): Record<string, unknown> {
  const node = selected.value
  const v = node?.data.version
  if (!v) throw new Error('未选中版本')
  if (kind === 'meta') {
    const p = node!.data.cat === 'fragment'
      ? {
          label: versionForm.value.label,
          policy: {
            blacklist: versionForm.value.policyB.split(/[、,]/).map((s) => s.trim()).filter(Boolean),
            whitelist: versionForm.value.policyW.split(/[、,]/).map((s) => s.trim()).filter(Boolean),
          },
        }
      : { label: versionForm.value.label }
    return { _id: v._id, ...p }
  }
  if (kind === 'source') return { _id: v._id, source: { html: sourceForm.value.html, css: sourceForm.value.css, cssMode: 'inline' } }
  let sample: unknown
  try {
    sample = JSON.parse(sampleText.value || '{}')
  } catch {
    throw new Error('示例数据不是合法 JSON')
  }
  return { _id: v._id, sampleData: sample }
}
async function saveVersion(kind: 'meta' | 'source' | 'sample'): Promise<void> {
  const node = selected.value
  if (!node || node.data.cat !== 'fragment' && node.data.cat !== 'template') return
  try {
    const patch = versionPatch(kind)
    await api(node.data.cat === 'fragment' ? 'frgv:update' : 'tplv:update', patch)
    ElMessage.success('版本已保存')
    await reload(node.id)
  } catch (err) { ElMessage.error((err as Error).message) }
}
async function renderVersionPreview(): Promise<void> {
  const node = selected.value
  if (!node || node.data.cat !== 'fragment' && node.data.cat !== 'template') return
  rendering.value = true
  try {
    const res = (await api('version:render', { cat: node.data.cat, _id: node.id })) as { html: string }
    previewHtml.value = res.html
  } catch (err) { ElMessage.error(`渲染失败：${(err as Error).message}`) } finally {
    rendering.value = false
  }
}
async function createVersion(): Promise<void> {
  const node = selected.value
  if (!node || node.kind !== 'family' || node.data.cat !== 'fragment' && node.data.cat !== 'template') return
  try {
    const empty = { html: '', css: '', cssMode: 'inline' }
    if (node.data.cat === 'fragment') {
      await api('frgv:save', { fragmentId: node.data.familyId, prevVersionId: '', source: empty })
    } else {
      await api('tplv:save', { templateId: node.data.familyId, prevVersionId: '', source: empty, slots: [] })
    }
    ElMessage.success('已创建空版本（源码 tab 填写内容后保存）')
    await reload()
  } catch (err) { ElMessage.error((err as Error).message) }
}
/** 复制为新族（另存）：custom/system 版本均可派生为新自定义族+v1 */
async function copyAsNewFamily(): Promise<void> {
  const node = selected.value
  if (!node || node.kind !== 'version' || node.data.cat !== 'fragment' && node.data.cat !== 'template') return
  try {
    await ElMessage.closeAll()
    const name = `${node.data.family?.name ?? '族'} 副本`
    await api(node.data.cat === 'fragment' ? 'frgv:saveAsNew' : 'tplv:saveAsNew', { _id: node.id, name })
    ElMessage.success(`已派生为新族「${name}」`)
    await reload()
  } catch (err) { ElMessage.error((err as Error).message) }
}
async function removeVersion(): Promise<void> {
  const node = selected.value
  if (!node || node.kind !== 'version' || node.data.cat !== 'fragment' && node.data.cat !== 'template') return
  await confirmRemove('删除版本', node.label, async () => {
    await api(node.data.cat === 'fragment' ? 'frgv:remove' : 'tplv:remove', { _id: node.id })
    await reload()
  })
}
</script>

<template>
  <div class="library-page">
    <div class="head">
      <span class="title">
        <svg class="title-icon" viewBox="0 0 24 24" aria-hidden="true"><path :d="NODE_ICON.root!.path" /></svg>
        自定义内容
      </span>
      <div class="head-actions">
        <el-button size="small" type="primary" plain :icon="Plus" @click="brandOpen = true">新增品牌</el-button>
      </div>
    </div>
    <div class="body">
      <div class="tree-pane">
        <el-tree
          :data="tree"
          node-key="id"
          default-expand-all
          highlight-current
          :expand-on-click-node="false"
          @node-click="(data: TreeNode) => onNode(data)"
        >
          <template #default="{ data }">
            <span class="tree-node" :class="`is-${String(data.kind)}`">
              <svg class="node-icon" viewBox="0 0 24 24" aria-hidden="true" :style="{ color: nodeIcon(String(data.kind)).color }"><path :d="nodeIcon(String(data.kind)).path" /></svg>
              <span class="node-label">{{ data.label }}</span>
            </span>
          </template>
        </el-tree>
        <EmptyState v-if="brands.length === 0" description="还没有品牌；可新增，或在系统内容页「另存为 → 自定义内容」派生" />
      </div>

      <div class="detail-pane">
        <!-- 品牌 -->
        <template v-if="selected?.kind === 'brand'">
          <div class="detail-head">
            <span class="detail-title">品牌元数据</span>
            <el-tag size="small" :type="editable(selected) ? 'success' : 'info'">{{ editable(selected) ? '自定义' : '系统只读' }}</el-tag>
          </div>
          <el-form label-width="90px" size="small" class="meta-form">
            <el-form-item label="code"><el-input v-model="brandForm.code" :disabled="!editable(selected)" /></el-form-item>
            <el-form-item label="名称"><el-input v-model="brandForm.name" :disabled="!editable(selected)" /></el-form-item>
            <el-form-item label="logo"><el-input v-model="brandForm.logo" :disabled="!editable(selected)" placeholder="图片地址" /></el-form-item>
          </el-form>
          <div v-if="editable(selected)" class="detail-ops">
            <el-button size="small" type="primary" :icon="Plus" @click="openFamilyDialog(selected.data.brandId!, 'fragment')">新增片段族</el-button>
            <el-button size="small" type="primary" plain :icon="Plus" @click="openFamilyDialog(selected.data.brandId!, 'template')">新增模板族</el-button>
            <el-button size="small" type="primary" @click="saveBrand">保存</el-button>
            <el-button size="small" type="danger" plain :icon="Delete" @click="removeBrand">删除品牌</el-button>
          </div>
        </template>

        <!-- 族 -->
        <template v-else-if="selected?.kind === 'family'">
          <div class="detail-head">
            <span class="detail-title">{{ selected.data.cat === 'fragment' ? '片段族' : '模板族' }}元数据</span>
            <el-tag size="small" :type="editable(selected) ? 'success' : 'info'">{{ editable(selected) ? '自定义' : '系统只读' }}</el-tag>
          </div>
          <el-form label-width="90px" size="small" class="meta-form">
            <el-form-item label="名称"><el-input v-model="familyForm.name" :disabled="!editable(selected)" /></el-form-item>
            <el-form-item v-if="selected.data.cat === 'fragment'" label="类型"><el-input v-model="familyForm.type" :disabled="!editable(selected)" placeholder="product / banner…" /></el-form-item>
            <el-form-item v-if="selected.data.cat === 'template'" label="描述"><el-input v-model="familyForm.description" type="textarea" :rows="2" :disabled="!editable(selected)" /></el-form-item>
          </el-form>
          <div class="detail-ops">
            <el-button v-if="editable(selected)" size="small" type="primary" :icon="Plus" @click="createVersion">新增版本</el-button>
            <el-button v-if="editable(selected)" size="small" type="primary" @click="saveFamily">保存</el-button>
            <el-button v-if="editable(selected)" size="small" type="danger" plain :icon="Delete" @click="removeFamily">删除族</el-button>
            <span v-else class="hint">系统族只读：可在其版本上「复制为新族」派生自定义副本</span>
          </div>
        </template>

        <!-- 版本：元数据 / 源码 / 示例数据 / 预览 -->
        <template v-else-if="selected?.kind === 'version'">
          <div class="detail-head">
            <span class="detail-title">版本 {{ selected.data.version?.version }}</span>
            <el-tag size="small" :type="editable(selected) ? 'success' : 'info'">{{ editable(selected) ? '自定义可编辑' : '系统只读' }}</el-tag>
          </div>
          <el-tabs v-model="versionTab" class="detail-tabs">
            <el-tab-pane label="元数据" name="meta">
              <div class="editor-toolbar">
                <el-button v-if="editable(selected)" size="small" type="primary" @click="saveVersion('meta')">保存</el-button>
                <el-button size="small" type="primary" plain :icon="CopyDocument" @click="copyAsNewFamily">复制为新族</el-button>
                <el-button v-if="editable(selected)" size="small" type="danger" plain :icon="Delete" @click="removeVersion">删除版本</el-button>
              </div>
              <el-form label-width="90px" size="small" class="meta-form">
                <el-form-item label="标签"><el-input v-model="versionForm.label" :disabled="!editable(selected)" /></el-form-item>
                <template v-if="selected.data.cat === 'fragment'">
                  <el-form-item label="黑名单"><el-input v-model="versionForm.policyB" :disabled="!editable(selected)" placeholder="逗号分隔，匹配模板族/版本播种 ID" /></el-form-item>
                  <el-form-item label="白名单"><el-input v-model="versionForm.policyW" :disabled="!editable(selected)" placeholder="为空 = 本品牌内全部模板可用" /></el-form-item>
                </template>
              </el-form>
            </el-tab-pane>
            <el-tab-pane label="源码" name="source">
              <div class="editor-toolbar">
                <el-button v-if="editable(selected)" size="small" type="primary" @click="saveVersion('source')">保存</el-button>
                <span class="hint">html（njk）与 css（就近 inline，随版本存储）</span>
              </div>
              <div class="src-stack">
                <div class="src-label">html（njk）</div>
                <MonacoEditor :model-value="sourceForm.html" :path="`${selected.id}:html`" language="njk" :read-only="!editable(selected)" height="38%" @update:model-value="(v: string) => (sourceForm.html = v)" />
                <div class="src-label">css</div>
                <MonacoEditor :model-value="sourceForm.css" :path="`${selected.id}:css`" language="css" :read-only="!editable(selected)" height="30%" @update:model-value="(v: string) => (sourceForm.css = v)" />
              </div>
            </el-tab-pane>
            <el-tab-pane label="示例数据" name="sample">
              <div class="editor-toolbar">
                <el-button v-if="editable(selected)" size="small" type="primary" @click="saveVersion('sample')">保存</el-button>
                <span class="hint">JSON；预览渲染时作为数据填充</span>
              </div>
              <MonacoEditor :model-value="sampleText" :path="`${selected.id}:sample`" language="json" :read-only="!editable(selected)" height="calc(100% - 40px)" @update:model-value="(v: string) => (sampleText = v)" />
            </el-tab-pane>
            <el-tab-pane label="预览" name="preview">
              <div class="editor-toolbar">
                <el-button size="small" type="success" plain :loading="rendering" @click="renderVersionPreview">渲染预览</el-button>
                <span class="hint">html + css + 示例数据 → njk → juice → minify 单渲</span>
              </div>
              <iframe v-if="previewHtml" class="preview" :srcdoc="previewHtml" />
              <el-empty v-else description="点「渲染预览」查看单版本效果" :image-size="60" />
            </el-tab-pane>
          </el-tabs>
        </template>

        <el-empty v-else class="detail-empty" description="从左侧选择品牌 / 族 / 版本；新增请先选品牌节点" :image-size="80" />
      </div>
    </div>

    <el-dialog v-model="brandOpen" title="新增品牌" width="400px" :close-on-click-modal="false">
      <el-form label-width="70px" size="small">
        <el-form-item label="code"><el-input v-model="newBrand.code" placeholder="procell" /></el-form-item>
        <el-form-item label="名称"><el-input v-model="newBrand.name" placeholder="ProCell" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button size="small" @click="brandOpen = false">取消</el-button>
        <el-button size="small" type="primary" @click="createBrand">创建</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="familyOpen" :title="familyDialogCat === 'fragment' ? '新增片段族' : '新增模板族'" width="400px" :close-on-click-modal="false">
      <el-form label-width="70px" size="small">
        <el-form-item label="名称"><el-input v-model="newFamily.name" /></el-form-item>
        <el-form-item v-if="familyDialogCat === 'fragment'" label="类型"><el-input v-model="newFamily.type" placeholder="product" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button size="small" @click="familyOpen = false">取消</el-button>
        <el-button size="small" type="primary" @click="createFamily">创建</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.library-page { display: flex; flex-direction: column; height: 100%; min-height: 0; }
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
.tree-node.is-version .node-label { opacity: .75; }

.detail-pane { flex: 1; min-width: 0; min-height: 0; border: 1px solid rgba(128,128,128,.2); border-radius: 6px; padding: 8px; display: flex; flex-direction: column; }
.detail-head { display: flex; align-items: center; gap: 8px; flex: none; padding-bottom: 6px; }
.detail-title { font-weight: 600; font-size: 13px; }
.detail-ops { display: flex; align-items: center; gap: 8px; flex: none; padding-top: 8px; }
.detail-empty { margin: auto; }
.detail-tabs { flex: 1; min-height: 0; display: flex; flex-direction: column; }
.detail-tabs :deep(.el-tabs__content) { flex: 1; min-height: 0; }
.detail-tabs :deep(.el-tab-pane) { height: 100%; display: flex; flex-direction: column; }
.editor-toolbar { display: flex; align-items: center; gap: 10px; flex: none; padding-bottom: 6px; }
.hint { font-size: 12px; opacity: .6; }
.meta-form { overflow: auto; flex: none; max-height: 40%; }
.meta-form :deep(.el-form-item__label) { white-space: nowrap; }
.src-stack { flex: 1; min-height: 0; display: flex; flex-direction: column; gap: 4px; }
.src-label { flex: none; font-size: 12px; opacity: .6; }
.preview { flex: 1; min-height: 0; width: 100%; border: 1px solid rgba(128,128,128,.2); border-radius: 6px; background: #fff; }
</style>
