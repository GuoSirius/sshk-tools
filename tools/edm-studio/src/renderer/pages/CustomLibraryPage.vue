<script setup lang="ts">
import { computed, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import * as yaml from 'js-yaml'
import { CopyDocument, Delete, Plus } from '@element-plus/icons-vue'
import { EmptyState } from '@sshk/ui-kit'
import MonacoEditor from '../MonacoEditor.vue'
import SampleForm from '../SampleForm.vue'
import FieldSchemaDesigner from '../FieldSchemaDesigner.vue'
import { normalizeFields, applyDefaults, validateModel, type FieldDef } from '../sample-schema'
import { api, confirmRemove, isSystem, type Named, type VersionRow } from '../shared'
import {
  brands, fragments, templates, tplVersionsAll, frgvVersions,
  loadBrands, loadTemplates, loadFragments, loadTplVersionsAll, loadFrgvVersions,
} from '../state'

/**
 * 自定义内容（R18/R23）：与「系统内容」页同构——左树实体结构 + 右侧
 * 元数据（表单↔数据双向）/示例数据（设计↔表单↔数据）/预览/源码/样式。
 * - 只列 origin=custom 实体（系统内容仅作派生源，在本页不展示）；
 * - custom 全权 CRUD：品牌/族/版本原地编辑保存即生效（D8 版本不可变仅约束系统内容）；
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
function splitList(s: string): string[] {
  return s.split(/[、,]/).map((x) => x.trim()).filter(Boolean)
}

/* ── 左树构造（仅自定义实体） ── */
const tree = computed<TreeNode[]>(() => {
  const root: TreeNode = { id: 'root', label: '自定义内容', kind: 'root', data: { kind: 'root' }, children: [] }
  for (const b of brands.value) {
    if (isSystem(b)) continue
    const brandId = b._id
    const catNode = (cat: Cat, label: string, families: Named[], versionsOf: (f: Named) => VersionRow[]): TreeNode => ({
      id: `cat:${brandId}:${cat}`,
      label,
      kind: 'category',
      data: { kind: 'category', brandId, brandCode: b.code, cat },
      children: families.map((f) => ({
        id: `fam:${f._id}`,
        label: f.name,
        kind: 'family',
        data: { kind: 'family', brandId, brandCode: b.code, cat, familyId: f._id, family: f },
        children: versionsOf(f).map((v) => ({
          id: v._id,
          label: `${v.label ?? `v${v.version}`}`,
          kind: 'version',
          data: { kind: 'version', brandId, brandCode: b.code, cat, familyId: f._id, family: f, version: v },
        })),
      })),
    })
    const fragFams = fragments.value.filter((f) => f.brandId === brandId && !isSystem(f))
    const tplFams = templates.value.filter((f) => f.brandId === brandId && !isSystem(f))
    root.children!.push({
      id: `brand:${brandId}`,
      label: `${b.code}（${b.name}）`,
      kind: 'brand',
      data: { kind: 'brand', brandId, brandCode: b.code },
      children: [
        catNode('fragment', '片段', fragFams, (f) => frgvVersions.value.filter((v) => v.fragmentId === f._id && !isSystem(v))),
        catNode('template', '模板', tplFams, (f) => tplVersionsAll.value.filter((v) => v.templateId === f._id && !isSystem(v))),
      ],
    })
  }
  return [root]
})

const selected = ref<TreeNode | null>(null)
const detailTab = ref('meta')
function findNode(nodes: TreeNode[], id: string): TreeNode | null {
  for (const n of nodes) {
    if (n.id === id) return n
    const hit = n.children ? findNode(n.children, id) : null
    if (hit) return hit
  }
  return null
}

/* ── 元数据（brand/family/version 共用一套 表单↔数据 双向同步，对齐系统内容页） ── */
const metaMode = ref<'form' | 'data'>('form')
const metaText = ref('')
const metaRaw = ref<Record<string, unknown> | null>(null)
const form = ref<{ name: string; code: string; logo: string; type: string; description: string; label: string; policyB: string; policyW: string }>({
  name: '', code: '', logo: '', type: '', description: '', label: '', policyB: '', policyW: '',
})

function fillForm(raw: Record<string, unknown>): void {
  const policy = (raw.policy ?? {}) as { blacklist?: string[]; whitelist?: string[] }
  form.value = {
    name: String(raw.name ?? ''),
    code: String(raw.code ?? ''),
    logo: String(raw.logo ?? ''),
    type: String(raw.type ?? ''),
    description: String(raw.description ?? ''),
    label: String(raw.label ?? ''),
    policyB: (policy.blacklist ?? []).join('、'),
    policyW: (policy.whitelist ?? []).join('、'),
  }
}

/** 当前节点元数据的可编辑子集（表单字段；数据模式展示/编辑同一子集） */
function nodeMetaRaw(): Record<string, unknown> {
  const node = selected.value
  if (!node) return {}
  if (node.kind === 'brand') {
    const b = brands.value.find((x) => x._id === node.data.brandId)
    return { code: b?.code ?? '', name: b?.name ?? '', logo: b?.logo ?? undefined }
  }
  if (node.kind === 'family') {
    const f = node.data.family
    return node.data.cat === 'fragment'
      ? { name: f?.name ?? '', type: f?.type ?? 'product', description: f?.description ?? undefined }
      : { name: f?.name ?? '', description: f?.description ?? undefined }
  }
  const v = node.data.version
  const base: Record<string, unknown> = { label: v?.label ?? `v${v?.version ?? 1}`, description: v?.description ?? undefined }
  if (node.data.cat === 'fragment') {
    base['type'] = v?.type ?? undefined
    base['policy'] = v?.policy ?? { blacklist: [], whitelist: [] }
  }
  return base
}

function syncFormToRaw(): Record<string, unknown> {
  const node = selected.value
  if (!node) return {}
  if (node.kind === 'brand') {
    return { code: form.value.code.trim(), name: form.value.name.trim(), logo: form.value.logo.trim() || undefined }
  }
  if (node.kind === 'family') {
    return node.data.cat === 'fragment'
      ? { name: form.value.name.trim(), type: form.value.type.trim() || 'product', description: form.value.description.trim() || undefined }
      : { name: form.value.name.trim(), description: form.value.description.trim() || undefined }
  }
  const base: Record<string, unknown> = {
    label: form.value.label.trim() || undefined,
    description: form.value.description.trim() || undefined,
  }
  if (node.data.cat === 'fragment') {
    base['type'] = form.value.type.trim() || undefined
    base['policy'] = { blacklist: splitList(form.value.policyB), whitelist: splitList(form.value.policyW) }
  }
  return base
}

function switchMetaMode(mode: 'form' | 'data'): void {
  if (mode === metaMode.value) return
  if (mode === 'data') metaText.value = yaml.dump(syncFormToRaw(), { lineWidth: -1 })
  else {
    try {
      metaRaw.value = (yaml.load(metaText.value) as Record<string, unknown>) ?? {}
      fillForm(metaRaw.value)
    } catch {
      ElMessage.error('YAML 解析失败，请先修正语法')
      metaMode.value = 'data'
      return
    }
  }
  metaMode.value = mode
}

async function saveMeta(): Promise<void> {
  const node = selected.value
  if (!node) return
  try {
    let raw: Record<string, unknown>
    if (metaMode.value === 'form') {
      raw = syncFormToRaw()
    } else {
      yaml.load(metaText.value) // 语法校验，非法即抛
      raw = (yaml.load(metaText.value) as Record<string, unknown>) ?? {}
    }
    if (node.kind === 'brand') {
      await api('brand:save', { _id: node.data.brandId, code: String(raw.code ?? ''), name: String(raw.name ?? ''), logo: String(raw.logo ?? '') || undefined })
    } else if (node.kind === 'family') {
      if (node.data.cat === 'fragment') {
        await api('frg:save', { _id: node.data.familyId, brandId: node.data.brandId, name: String(raw.name ?? ''), type: String(raw.type ?? 'product'), description: String(raw.description ?? '') })
      } else {
        await api('tpl:save', { _id: node.data.familyId, brandId: node.data.brandId, name: String(raw.name ?? ''), description: String(raw.description ?? '') })
      }
    } else if (node.data.cat === 'fragment' || node.data.cat === 'template') {
      const patch: Record<string, unknown> = { _id: node.id, label: String(raw.label ?? '') }
      if (raw.description !== undefined) patch['description'] = String(raw.description ?? '')
      if (node.data.cat === 'fragment') {
        if (raw.type !== undefined) patch['type'] = String(raw.type ?? 'product')
        const policy = (raw.policy ?? {}) as { blacklist?: unknown; whitelist?: unknown }
        patch['policy'] = {
          blacklist: Array.isArray(policy.blacklist) ? policy.blacklist.map(String) : [],
          whitelist: Array.isArray(policy.whitelist) ? policy.whitelist.map(String) : [],
        }
      }
      await api(node.data.cat === 'fragment' ? 'frgv:update' : 'tplv:update', patch)
    }
    ElMessage.success('元数据已保存')
    await reload(node.id)
  } catch (err) {
    ElMessage.error(`保存失败：${(err as Error).message}`)
  }
}

/* ── 示例数据（设计↔表单↔数据，fields schema 存版本 fields，对齐系统内容页 R15） ── */
const sampleMode = ref<'form' | 'data' | 'design'>('data')
const sampleSchema = ref<FieldDef[]>([])
const sampleObj = ref<Record<string, unknown>>({})
const sampleText = ref('')

function switchSampleMode(mode: 'form' | 'data' | 'design'): void {
  if (mode === sampleMode.value) return
  if (mode === 'design') { sampleMode.value = 'design'; return }
  if (mode === 'data') sampleText.value = yaml.dump(sampleObj.value, { lineWidth: -1 })
  else {
    try {
      const parsed = (yaml.load(sampleText.value) as Record<string, unknown>) ?? {}
      sampleObj.value = applyDefaults(sampleSchema.value, parsed)
    } catch (err) {
      ElMessage.error(`YAML 解析失败，请先修正语法：${(err as Error).message}`)
      sampleMode.value = 'data'
      return
    }
  }
  sampleMode.value = mode
}
async function saveSample(): Promise<void> {
  const node = selected.value
  if (!node || node.kind !== 'version' || node.data.cat !== 'fragment' && node.data.cat !== 'template') return
  try {
    if (sampleMode.value === 'form') {
      const errors = validateModel(sampleSchema.value, sampleObj.value)
      const msgs = Object.entries(errors)
      if (msgs.length) {
        ElMessage.error(`校验未通过：${msgs.map(([k, v]) => `${k}：${v}`).join('；')}`)
        return
      }
    } else {
      yaml.load(sampleText.value) // 语法校验
    }
    const data = sampleMode.value === 'form' ? { ...sampleObj.value } : ((yaml.load(sampleText.value) as Record<string, unknown>) ?? {})
    await api(node.data.cat === 'fragment' ? 'frgv:update' : 'tplv:update', { _id: node.id, sampleData: data })
    ElMessage.success('示例数据已保存')
    await reload(node.id)
  } catch (err) {
    ElMessage.error(`保存失败：${(err as Error).message}`)
  }
}
async function saveFields(): Promise<void> {
  const node = selected.value
  if (!node || node.kind !== 'version' || node.data.cat !== 'fragment' && node.data.cat !== 'template') return
  try {
    const fields = normalizeFields(sampleSchema.value)
    if (fields.length !== sampleSchema.value.length) {
      ElMessage.warning(`已忽略 ${sampleSchema.value.length - fields.length} 个非法字段（缺 key 或未知类型）`)
    }
    await api(node.data.cat === 'fragment' ? 'frgv:update' : 'tplv:update', { _id: node.id, fields })
    ElMessage.success('字段定义已保存')
    await reload(node.id)
  } catch (err) {
    ElMessage.error(`保存失败：${(err as Error).message}`)
  }
}

/* ── 源码（njk）/ 样式（css）与预览 ── */
const sourceText = ref('')
const styleText = ref('')
const previewHtml = ref('')
const previewing = ref(false)

function currentSource(): Record<string, unknown> {
  return { html: sourceText.value, css: styleText.value, cssMode: 'inline' }
}
async function saveSource(): Promise<void> {
  const node = selected.value
  if (!node || node.kind !== 'version' || node.data.cat !== 'fragment' && node.data.cat !== 'template') return
  try {
    await api(node.data.cat === 'fragment' ? 'frgv:update' : 'tplv:update', { _id: node.id, source: currentSource() })
    ElMessage.success('源码已保存')
    await reload(node.id)
  } catch (err) { ElMessage.error(`保存失败：${(err as Error).message}`) }
}
async function saveStyle(): Promise<void> {
  const node = selected.value
  if (!node || node.kind !== 'version' || node.data.cat !== 'fragment' && node.data.cat !== 'template') return
  try {
    await api(node.data.cat === 'fragment' ? 'frgv:update' : 'tplv:update', { _id: node.id, source: currentSource() })
    ElMessage.success('样式已保存')
    await reload(node.id)
  } catch (err) { ElMessage.error(`保存失败：${(err as Error).message}`) }
}
async function renderPreview(): Promise<void> {
  const node = selected.value
  if (!node || node.kind !== 'version' || node.data.cat !== 'fragment' && node.data.cat !== 'template') return
  previewing.value = true
  try {
    const res = (await api('version:render', { cat: node.data.cat, _id: node.id })) as { html: string }
    previewHtml.value = res.html
  } catch (err) { ElMessage.error(`渲染失败：${(err as Error).message}`) } finally {
    previewing.value = false
  }
}

/* ── 节点选择 → 状态初始化（对齐系统内容页 onNode） ── */
async function onNode(node: TreeNode): Promise<void> {
  selected.value = node
  detailTab.value = 'meta'
  metaMode.value = 'form'
  previewHtml.value = ''
  sampleMode.value = 'data'
  sampleSchema.value = []
  sampleObj.value = {}
  sampleText.value = ''
  sourceText.value = ''
  styleText.value = ''
  metaRaw.value = node.kind === 'category' || node.kind === 'root' ? null : nodeMetaRaw()
  metaText.value = metaRaw.value ? yaml.dump(metaRaw.value, { lineWidth: -1 }) : ''
  if (metaRaw.value) fillForm(metaRaw.value)
  const v = node.data.version
  if (node.kind === 'version' && v) {
    sourceText.value = String(v.source?.html ?? '')
    styleText.value = String(v.source?.css ?? '')
    const fields = normalizeFields(v.fields ?? [])
    sampleSchema.value = fields
    sampleObj.value = applyDefaults(fields, v.sampleData ?? {})
    sampleText.value = yaml.dump(v.sampleData ?? {}, { lineWidth: -1 })
    sampleMode.value = fields.length ? 'form' : 'data'
    void renderPreview()
  }
}

async function reload(keepId?: string): Promise<void> {
  await Promise.all([loadBrands(), loadTemplates(), loadFragments(), loadTplVersionsAll(), loadFrgvVersions()])
  if (keepId) {
    const hit = findNode(tree.value, keepId)
    if (hit) {
      await onNode(hit)
      return
    }
  }
  selected.value = null
}

/* ── CRUD：品牌 / 族 / 版本 ── */
async function removeBrand(): Promise<void> {
  const node = selected.value
  if (!node?.data.brandId) return
  await confirmRemove('删除品牌', node.label, async () => {
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
async function removeFamily(): Promise<void> {
  const node = selected.value
  if (!node?.data.familyId || node.data.cat !== 'fragment' && node.data.cat !== 'template') return
  await confirmRemove('删除族', node.label, async () => {
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
/** 复制为新族（另存）：以此版本为基础派生新自定义族 + v1 */
async function copyAsNewFamily(): Promise<void> {
  const node = selected.value
  if (!node || node.kind !== 'version' || node.data.cat !== 'fragment' && node.data.cat !== 'template') return
  try {
    const name = `${node.data.family?.name ?? '族'} 副本`
    await ElMessageBox.confirm(`以此版本为基础派生新族「${name}」？`, '复制为新族', { type: 'info', confirmButtonText: '派生', cancelButtonText: '取消' })
    await api(node.data.cat === 'fragment' ? 'frgv:saveAsNew' : 'tplv:saveAsNew', { _id: node.id, name })
    ElMessage.success(`已派生为新族「${name}」`)
    await reload()
  } catch { /* 取消不视为错误 */ }
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
        <EmptyState v-if="brands.filter((b) => !isSystem(b)).length === 0" description="还没有自定义品牌；可新增，或在系统内容页「另存为 → 自定义内容」派生" />
      </div>

      <div class="detail-pane">
        <!-- 品牌 / 族 / 版本：元数据（表单↔数据） -->
        <el-tabs v-if="selected && selected.kind !== 'root' && selected.kind !== 'category'" class="detail-tabs">
          <el-tab-pane label="元数据">
            <div class="editor-toolbar">
              <el-radio-group :model-value="metaMode" size="small" @change="(m: unknown) => switchMetaMode(m as 'form' | 'data')">
                <el-radio-button value="form">表单</el-radio-button>
                <el-radio-button value="data">数据</el-radio-button>
              </el-radio-group>
              <el-button v-if="selected.kind === 'family'" size="small" type="primary" plain :icon="Plus" @click="createVersion">新增版本</el-button>
              <el-button v-if="selected.kind === 'brand'" size="small" type="primary" plain :icon="Plus" @click="openFamilyDialog(selected.data.brandId!, 'fragment')">新增片段族</el-button>
              <el-button v-if="selected.kind === 'brand'" size="small" type="primary" plain :icon="Plus" @click="openFamilyDialog(selected.data.brandId!, 'template')">新增模板族</el-button>
              <el-button v-if="selected.kind === 'version'" size="small" type="primary" plain :icon="CopyDocument" @click="copyAsNewFamily">复制为新族</el-button>
              <el-button
                v-if="selected.kind === 'brand' || selected.kind === 'family' || selected.kind === 'version'"
                size="small" type="danger" plain :icon="Delete"
                @click="selected.kind === 'brand' ? removeBrand() : selected.kind === 'family' ? removeFamily() : removeVersion()"
              >删除</el-button>
              <el-button size="small" type="primary" class="push-right" @click="saveMeta">保存</el-button>
            </div>
            <el-form v-if="metaMode === 'form'" label-width="90px" class="meta-form">
              <el-form-item v-if="selected.kind === 'brand' || selected.kind === 'family'" label="名称"><el-input v-model="form.name" /></el-form-item>
              <el-form-item v-if="selected.kind === 'brand'" label="code"><el-input v-model="form.code" /></el-form-item>
              <el-form-item v-if="selected.kind === 'brand'" label="logo"><el-input v-model="form.logo" placeholder="图片地址" /></el-form-item>
              <el-form-item v-if="selected.kind === 'version'" label="标签"><el-input v-model="form.label" /></el-form-item>
              <el-form-item v-if="selected.data.cat === 'fragment'" label="类型"><el-input v-model="form.type" placeholder="product / banner" /></el-form-item>
              <el-form-item label="描述"><el-input v-model="form.description" type="textarea" :rows="2" /></el-form-item>
              <template v-if="selected.kind === 'version' && selected.data.cat === 'fragment'">
                <el-form-item label="黑名单"><el-input v-model="form.policyB" placeholder="逗号分隔，匹配模板族/版本播种 ID" /></el-form-item>
                <el-form-item label="白名单"><el-input v-model="form.policyW" placeholder="为空 = 本品牌内全部模板可用" /></el-form-item>
              </template>
            </el-form>
            <MonacoEditor v-else :model-value="metaText" :path="`meta:${selected.id}`" language="yaml" height="calc(100% - 40px)" @update:model-value="(v: string) => (metaText = v)" />
          </el-tab-pane>

          <!-- 版本：示例数据（设计↔表单↔数据） -->
          <el-tab-pane v-if="selected.kind === 'version'" label="示例数据">
            <div class="editor-toolbar">
              <el-radio-group :model-value="sampleMode" size="small" @change="(m: unknown) => switchSampleMode(m as 'form' | 'data' | 'design')">
                <el-radio-button value="design">设计</el-radio-button>
                <el-radio-button value="form" :disabled="!sampleSchema.length">表单</el-radio-button>
                <el-radio-button value="data">数据</el-radio-button>
              </el-radio-group>
              <el-tag v-if="sampleMode !== 'design' && !sampleSchema.length" size="small" type="info">未声明 fields（示例数据-设计 定义），仅数据模式</el-tag>
              <span v-if="sampleMode === 'design'" class="hint">拖拽 ≡ 调整顺序</span>
              <el-button v-if="sampleMode === 'design'" size="small" type="primary" class="push-right" @click="saveFields">保存字段定义</el-button>
              <el-button v-else size="small" type="primary" class="push-right" @click="saveSample">保存</el-button>
            </div>
            <FieldSchemaDesigner v-if="sampleMode === 'design'" v-model="sampleSchema" />
            <div v-else-if="sampleMode === 'form' && sampleSchema.length" class="sample-wrap">
              <SampleForm v-model="sampleObj" :fields="sampleSchema" />
            </div>
            <MonacoEditor v-else :model-value="sampleText" :path="`sample:${selected.id}`" language="yaml" height="calc(100% - 40px)" @update:model-value="(v: string) => (sampleText = v)" />
          </el-tab-pane>

          <!-- 版本：预览 -->
          <el-tab-pane v-if="selected.kind === 'version'" label="预览">
            <div class="editor-toolbar">
              <span class="hint">html + css + 示例数据 → njk → juice → minify 单渲；跨片段组合在「邮件管理」编辑器内完成</span>
              <el-button size="small" type="success" plain :loading="previewing" class="push-right" @click="renderPreview">渲染预览</el-button>
            </div>
            <iframe v-if="previewHtml" class="preview" :srcdoc="previewHtml" />
            <el-empty v-else description="点「渲染预览」查看单版本效果" :image-size="60" />
          </el-tab-pane>

          <!-- 版本：源码 -->
          <el-tab-pane v-if="selected.kind === 'version'" label="源码">
            <div class="editor-toolbar">
              <span class="hint">html（njk）；内联 css 也可直接写在 njk 的 &lt;style&gt; 内</span>
              <el-button size="small" type="primary" class="push-right" @click="saveSource">保存</el-button>
            </div>
            <MonacoEditor :model-value="sourceText" :path="`source:${selected.id}`" language="njk" height="calc(100% - 40px)" @update:model-value="(v: string) => (sourceText = v)" />
          </el-tab-pane>

          <!-- 版本：样式 -->
          <el-tab-pane v-if="selected.kind === 'version'" label="样式">
            <div class="editor-toolbar">
              <span class="hint">css 就近 inline 随版本存储，渲染时注入（优先级最高）</span>
              <el-button size="small" type="primary" class="push-right" @click="saveStyle">保存</el-button>
            </div>
            <MonacoEditor :model-value="styleText" :path="`style:${selected.id}`" language="css" height="calc(100% - 40px)" @update:model-value="(v: string) => (styleText = v)" />
          </el-tab-pane>
        </el-tabs>

        <el-empty v-else class="detail-empty" description="从左侧选择品牌 / 族 / 版本；新增请先选品牌节点或点右上「新增品牌」" :image-size="80" />
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
.detail-empty { margin: auto; }
.detail-tabs { flex: 1; min-height: 0; display: flex; flex-direction: column; }
.detail-tabs :deep(.el-tabs__content) { flex: 1; min-height: 0; }
.detail-tabs :deep(.el-tab-pane) { height: 100%; display: flex; flex-direction: column; }
.editor-toolbar { display: flex; align-items: center; gap: 10px; flex: none; padding-bottom: 6px; }
/* 保存类主按钮居右，描述与其他操作居左 */
.editor-toolbar .push-right { margin-left: auto; }
.hint { font-size: 12px; opacity: .6; }
.meta-form { overflow: auto; flex: none; max-height: 40%; }
.meta-form :deep(.el-form-item__label) { white-space: nowrap; }
.sample-wrap { flex: 1; min-height: 0; overflow: auto; }
.preview { flex: 1; min-height: 0; width: 100%; border: 1px solid rgba(128,128,128,.2); border-radius: 6px; background: #fff; }
</style>
