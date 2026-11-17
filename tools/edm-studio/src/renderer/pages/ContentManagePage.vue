<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import * as yaml from 'js-yaml'
import { EmptyState, useToolId } from '@sshk/ui-kit'
import { CodeEditor } from '@sshk/code-editor'
import SampleForm from '../SampleForm.vue'
import FieldSchemaDesigner from '../FieldSchemaDesigner.vue'
import ComposeEditor from '../ComposeEditor.vue'
import type { PlacementItem, SlotDef } from '../ComposeEditor.vue'
import { applyDefaults, normalizeFields, parseYamlObject, validateModel, type FieldDef } from '../sample-schema'
import { replaceFieldsInMeta } from '../meta-fields'
import { api } from '../shared'
import { uploadInlineImages } from '../upload.js'

/**
 * 系统内容页（R12–R14 效果版）：
 * - 树：EDM → 品牌 → 片段/模板（类目）→ 族 → 版本，各级可挂 css 目录（v5 六处）
 * - 右键（v5 分层）：EDM 仅粘贴；品牌/族/版本=另存为+重命名+删除+粘贴；类目=重命名+删除+粘贴；
 *   css 目录=另存为+复制+粘贴+新建文件+重命名+删除；css 文件=另存为+复制+重命名+删除
 * - 编辑门控（R12）：main 裁决 canEdit（dev 全权 / 打包版需 developerMode），只读时隐藏一切编辑 UI
 * - 右侧：品牌/族=元数据（表单↔数据切换 R17）；版本=元数据/示例/njk/预览；css 文件=多 tab（外置 css）
 * - 示例数据表单渲染器（R15）与自定义库派生（R14 后半）为下一版，本版示例/njk 走 YAML/Monaco
 */
type Cat = 'fragment' | 'template'
type NodeKind = 'root' | 'brand' | 'category' | 'family' | 'version' | 'cssDir' | 'cssFile'
/** R24：内容来源——决定读写根与编辑门控；系统自带=文件域(受 dev/developerMode 门控)，自定义=自定义文件根(恒可写) */
type Source = 'system' | 'custom'

interface NodeData {
  kind: NodeKind
  source: Source
  /** 根相对路径（POSIX 分隔；根为 ''） */
  path: string
  label?: string
  brandCode?: string
  cat?: Cat
  familyCode?: string
  versionDir?: string
  metaPath?: string
  sourcePath?: string
  samplePath?: string
  /** cssDir 节点：目录下文件名列表 */
  cssFiles?: string[]
}
interface TreeNode {
  id: string
  label: string
  kind: NodeKind
  data: NodeData
  children?: TreeNode[]
}
interface CssTab {
  file: string
  content: string
  dirty: boolean
}
type Clipboard = { type: 'cssDir'; dirPath: string; files: string[]; source: Source } | { type: 'cssFile'; file: string; source: Source } | null
/** system:derive 返回的派生计数 */
interface DeriveCounts {
  brands: number
  fragments: number
  fragmentVersions: number
  templates: number
  templateVersions: number
}

const sysModel = ref<{ topCss: string[]; brands: any[] }>({ topCss: [], brands: [] })
const cusModel = ref<{ topCss: string[]; brands: any[] }>({ topCss: [], brands: [] })
/** 系统自带可编辑门控（dev / 打包版 developerMode）；自定义恒可写 */
const canEditSystem = ref(false)
/** R24：编辑权 = 节点 source==='custom' 或系统门控通过；未选节点默认放开（按钮另有选中守卫） */
const canEdit = computed<boolean>(() => !selected.value || selected.value.data.source === 'custom' || canEditSystem.value)
const loading = ref(false)
const selected = ref<TreeNode | null>(null)
const clipboard = ref<Clipboard>(null)

/* ── 图标（与宿主 SidebarMenu 同一视觉语言，铁律 #19） ── */
type IconKind = 'root' | 'brand' | 'fragment' | 'template' | 'version' | 'cssDir' | 'cssFile'
const NODE_ICON: Record<IconKind, { path: string; color: string }> = {
  root: { path: 'M12 2L2 7v10l10 5 10-5V7z', color: '#909399' },
  brand: { path: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z', color: '#409eff' },
  fragment: { path: 'M4 4h7v7H4zM13 11h7v7h-7zM4 13h7v7H4zM13 4h4v4h4', color: '#67c23a' },
  template: { path: 'M4 5h16v14H4zM4 9h16M9 9v10', color: '#b882e8' },
  version: { path: 'M12 3a9 9 0 100 18 9 9 0 000-18zM12 7v5l3 3', color: '#e6a23c' },
  cssDir: { path: 'M3 5h6l2 2h10v12H3zM8 13h8M12 10v6', color: '#e6a23c' },
  cssFile: { path: 'M6 2h9l5 5v15H6zM14 2v6h6M9 13h6M9 17h6', color: '#909399' },
}
function nodeIcon(kind: unknown): { path: string; color: string } {
  const key = (kind as IconKind) in NODE_ICON ? (kind as IconKind) : 'version'
  return NODE_ICON[key]
}

/* ── 树构造（R24：每个节点携带 source，决定读写根与编辑门控） ── */
function cssDirNode(parentPath: string, files: string[], idPrefix: string, source: Source): TreeNode {
  const dirPath = parentPath ? `${parentPath}/css` : 'css'
  return {
    id: `${idPrefix}:css`,
    label: 'css',
    kind: 'cssDir',
    data: { kind: 'cssDir', source, path: dirPath, cssFiles: [...files], label: 'css' },
    children: files.map((f) => ({
      id: `${idPrefix}:css:${f}`,
      label: f,
      kind: 'cssFile' as const,
      data: { kind: 'cssFile' as const, source, path: `${dirPath}/${f}`, label: f },
    })),
  }
}

function versionNode(brand: string, cat: Cat, fam: string, v: any, source: Source): TreeNode {
  const famPath = `${brand}/${cat}/${fam}`
  const verPath = v.dir ? `${famPath}/${v.dir}` : famPath
  const verCss = (v.css as string[]).filter((c) => c.startsWith('css/')).map((c) => c.slice(4))
  return {
    id: `ver:${source}:${brand}:${cat}:${fam}:${v.dir || 'default'}`,
    label: v.dir || 'default',
    kind: 'version',
    data: {
      kind: 'version',
      source,
      path: verPath,
      brandCode: brand,
      cat,
      familyCode: fam,
      versionDir: v.dir ?? '',
      metaPath: `${verPath}/meta.yaml`,
      sourcePath: v.sourcePath,
      samplePath: `${verPath}/sample.yaml`,
    },
    children: [cssDirNode(verPath, verCss, `ver:${source}:${brand}:${cat}:${fam}:${v.dir || 'default'}`, source)],
  }
}

function familyNode(brand: string, cat: Cat, f: any, source: Source): TreeNode {
  const famPath = `${brand}/${cat}/${f.code}`
  const id = `fam:${source}:${brand}:${cat}:${f.code}`
  return {
    id,
    label: f.meta.name ? `${f.code}（${f.meta.name}）` : f.code,
    kind: 'family',
    data: { kind: 'family', source, path: famPath, brandCode: brand, cat, familyCode: f.code, metaPath: `${famPath}/meta.yaml` },
    children: [
      cssDirNode(famPath, f.css ?? [], id, source),
      ...((f.versions as any[]) ?? []).map((v) => versionNode(brand, cat, f.code, v, source)),
    ],
  }
}

function brandNode(b: any, source: Source): TreeNode {
  const id = `brand:${source}:${b.code}`
  const catNode = (cat: Cat, label: string, cssFiles: string[], families: any[], metaPath: string): TreeNode => {
    const cid = `cat:${source}:${b.code}:${cat}`
    return {
      id: cid,
      label,
      kind: 'category',
      data: { kind: 'category', source, path: `${b.code}/${cat}`, brandCode: b.code, cat, metaPath, label },
      children: [cssDirNode(`${b.code}/${cat}`, cssFiles, cid, source), ...families.map((f) => familyNode(b.code, cat, f, source))],
    }
  }
  return {
    id,
    label: `${b.code}（${b.meta.name}）`,
    kind: 'brand',
    data: { kind: 'brand', source, path: b.code, brandCode: b.code, metaPath: `${b.code}/meta.yaml` },
    children: [
      cssDirNode(b.code, b.css ?? [], id, source),
      catNode('template', '模板', b.templateCss ?? [], b.templates ?? [], `${b.code}/template/meta.yaml`),
      catNode('fragment', '片段', b.fragmentCss ?? [], b.fragments ?? [], `${b.code}/fragment/meta.yaml`),
    ],
  }
}

/** R24 双顶层树：自定义（source=custom，上）/ 系统自带（source=system，下），下层结构不变 */
const tree = computed<TreeNode[]>(() => [
  {
    id: 'custom',
    label: '自定义',
    kind: 'root',
    data: { kind: 'root', source: 'custom', path: '', label: '自定义' },
    children: [cssDirNode('', cusModel.value.topCss ?? [], 'custom', 'custom'), ...cusModel.value.brands.map((b) => brandNode(b, 'custom'))],
  },
  {
    id: 'system',
    label: '系统自带',
    kind: 'root',
    data: { kind: 'root', source: 'system', path: '', label: '系统自带' },
    children: [cssDirNode('', sysModel.value.topCss ?? [], 'system', 'system'), ...sysModel.value.brands.map((b) => brandNode(b, 'system'))],
  },
])

/** R24 收尾：默认展开到「模板 / 片段」类目层——根 → 品牌 → 类目；族 / 版本 / css 目录保持折叠 */
const defaultExpandedKeys = computed<string[]>(() => {
  const keys: string[] = []
  const walk = (nodes: TreeNode[]): void => {
    for (const n of nodes) {
      if (n.kind === 'root' || n.kind === 'brand' || n.kind === 'category') {
        keys.push(n.id)
        if (n.children) walk(n.children)
      }
    }
  }
  walk(tree.value)
  return keys
})
/** el-tree 的 default-expanded-keys 仅在首次渲染生效；tree 恒返回两个根（空骨架也会渲染），
 *  故等 content:load 数据就绪后再挂载树，否则数据到达后展开配置不会重新应用。 */
const treeReady = ref(false)
/** toolId 由宿主 :tool-id 注入，深层页面经 inject 取用，源码不硬编码 */
const toolId = useToolId()

const stats = computed(() => {
  const src: Source = selected.value?.data.source ?? 'system'
  const m = src === 'custom' ? cusModel.value : sysModel.value
  const brands = m.brands
  return {
    brands: brands.length,
    fragments: brands.reduce((n, b) => n + (b.fragments?.length ?? 0), 0),
    templates: brands.reduce((n, b) => n + (b.templates?.length ?? 0), 0),
  }
})

/** 全部 css 目录（css 另存为目标下拉；携带 source 以便定位根） */
const allCssDirs = computed<{ path: string; label: string; source: Source }[]>(() => {
  const out: { path: string; label: string; source: Source }[] = []
  const walk = (nodes: TreeNode[]): void => {
    for (const n of nodes) {
      if (n.kind === 'cssDir') out.push({ path: n.data.path, label: n.data.path, source: n.data.source })
      if (n.children) walk(n.children)
    }
  }
  walk(tree.value)
  return out
})

/* ── 基础 IO（R24：按 source 路由到 content:*，系统根受门控、自定义根恒可写） ── */
async function read(file: string, source: Source = 'system'): Promise<string> {
  const r = (await api('content:readFile', { source, file })) as string | null
  return r ?? ''
}
async function existsIn(file: string, source: Source = 'system'): Promise<boolean> {
  return ((await api('content:readFile', { source, file })) as string | null) !== null
}
async function write(file: string, content: string, source: Source = 'system'): Promise<void> {
  await api('content:writeFile', { source, file, content })
}
function splitPath(p: string): string[] {
  return p.split(/[/\\]/)
}
function basename(p: string): string {
  return splitPath(p).pop() ?? p
}
function splitList(s: string | undefined): string[] {
  return (s ?? '').split(/[,，、]+/).map((x) => x.trim()).filter(Boolean)
}
/** 版本目录名 → 版本号（vN / 纯数字；否则 1） */
function parseVersion(dir: string): number {
  const m = /v?(\d+)/.exec(dir)
  return m ? Number(m[1]) : 1
}
/** R24：取某族当前最大版本号 +1（基于内存树，已加载） */
function nextVersionOf(famPath: string, source: Source): number {
  const root = tree.value.find((r) => r.data.source === source)
  let max = 0
  const walk = (nodes: TreeNode[]): void => {
    for (const n of nodes) {
      if (n.kind === 'family' && n.data.path === famPath) {
        for (const v of n.children ?? []) {
          if (v.kind === 'version') {
            const num = parseVersion(v.data.versionDir ?? '')
            if (num > max) max = num
          }
        }
      }
      if (n.children) walk(n.children)
    }
  }
  walk(root?.children ?? [])
  return max + 1
}
/** 代码合法性（目录名）：字母数字下划线连字符 */
function validCode(code: string): boolean {
  return /^[\w-]+$/.test(code)
}
async function promptCodeAndName(title: string, codeHint: string, nameDefault: string): Promise<{ code: string; name: string } | null> {
  const code = String((await ElMessageBox.prompt(codeHint, title, { inputValue: '' })).value ?? '').trim()
  if (!code) return null
  if (!validCode(code)) { ElMessage.error('代码仅限字母 / 数字 / 下划线 / 连字符'); return null }
  const name = String((await ElMessageBox.prompt('名称', title, { inputValue: nameDefault || code })).value ?? '').trim() || code
  return { code, name }
}

let treeRef: { setCurrentKey: (key: string) => void } | null = null
function setTreeRef(el: unknown): void {
  treeRef = el as { setCurrentKey: (key: string) => void } | null
}

async function load(silent = false): Promise<void> {
  if (!silent) loading.value = true
  try {
    const [sys, cus] = (await Promise.all([
      api('content:load', { source: 'system' }),
      api('content:load', { source: 'custom' }),
    ])) as [{ topCss: string[]; brands: any[] }, { topCss: string[]; brands: any[] }]
    sysModel.value = sys
    cusModel.value = cus
    const prevId = selected.value?.id
    await nextTick()
    if (prevId) treeRef?.setCurrentKey(prevId)
    void prefetchFamilyMetas() // 组合预览选项用（后台，不阻塞）
  } catch (err) {
    ElMessage.error((err as Error).message)
  } finally {
    treeReady.value = true
    loading.value = false
  }
}

/* ── 右侧详情：元数据（表单↔数据，R17） / 示例 / njk / 预览 ── */
const metaRaw = ref<Record<string, unknown> | null>(null)
const metaMode = ref<'form' | 'data'>('form')
const metaText = ref('')
const sourceText = ref('')
const sampleText = ref('')
const styleText = ref('')
const previewHtml = ref('')
const previewing = ref(false)
/* R15：示例数据表单化 —— schema（版本 meta fields 优先，族 meta 兜底）+ 表单模型 + 表单|数据切换 */
const sampleMode = ref<'form' | 'data' | 'design'>('form')
const sampleSchema = ref<FieldDef[]>([])
const sampleObj = ref<Record<string, unknown>>({})
const form = ref({
  name: '', code: '', description: '', logo: '', type: '',
  version: 1, changelog: '', policyB: '', policyW: '',
})

const showForm = computed(() => ({
  catBase: selected.value?.kind === 'category',
  brandBase: selected.value?.kind === 'brand' || selected.value?.kind === 'family',
  policy: selected.value?.kind === 'family' && selected.value?.data.cat === 'fragment',
  version: selected.value?.kind === 'version',
}))

async function renderPreview(node: TreeNode): Promise<void> {
  if (node.kind !== 'version') return
  previewing.value = true
  try {
    const res = (await api('content:render', {
      source: node.data.source,
      selector: {
        brandCode: node.data.brandCode, kind: node.data.cat, familyCode: node.data.familyCode, versionDir: node.data.versionDir,
      },
    })) as { html: string }
    previewHtml.value = res.html
  } catch (err) {
    previewHtml.value = ''
    ElMessage.warning(`预览渲染失败：${(err as Error).message}`)
  } finally {
    previewing.value = false
  }
}

/* ── R19 组合预览（片段/模板统一入口）：宿主模板 + 片段摆放 → system:render placements ── */
interface SysSelector { brandCode: string; kind: string; familyCode: string; versionDir: string }
interface Policy { blacklist?: string[]; whitelist?: string[] }
interface FamilyMetaLite { policy?: Policy; slots?: { key: string; type?: string }[]; fields?: unknown[] }
const composeTemplate = ref('') // 片段预览：宿主模板（id = JSON selector）
const composeSlots = ref<SlotDef[]>([])
const composePlacements = ref<PlacementItem[]>([])
const familyMetaCache = ref<Record<string, FamilyMetaLite>>({})
/* R22：布局配置收进弹框（预览页只留预览，避免 header 过多挤占 iframe） */
const composeOpen = ref(false)
const composeHostLabel = computed(() => {
  const node = selected.value
  if (!node) return ''
  if (node.data.cat !== 'fragment') return node.label
  return hostTemplateOptions.value.find((t) => t.id === composeTemplate.value)?.label ?? '未选（单渲本片段）'
})
function closeComposeDialog(): void {
  composeOpen.value = false
  void renderComposePreview()
}

/** D14 黑白名单（复刻 repository policyAllows）：匹配集合 = 模板族/版本播种 ID */
function policyAllows(policy: Policy | undefined, ids: string[]): boolean {
  if (!policy) return true
  if ((policy.blacklist ?? []).some((x) => ids.includes(x))) return false
  const wl = policy.whitelist ?? []
  if (wl.length === 0) return true
  return wl.some((x) => ids.includes(x))
}

/** 预读全部族 meta（policy / slots / fields），组合预览选项构造用（后台不阻塞 load） */
async function prefetchFamilyMetas(): Promise<void> {
  const out: Record<string, FamilyMetaLite> = {}
  const walk = async (nodes: TreeNode[]): Promise<void> => {
    for (const n of nodes) {
      if (n.kind === 'family' && n.data.metaPath) {
        try {
          out[n.data.path] = ((yaml.load(await read(n.data.metaPath, n.data.source)) as Record<string, unknown>) ?? {}) as FamilyMetaLite
        } catch { /* 忽略单族解析失败 */ }
      }
      if (n.children) await walk(n.children)
    }
  }
  await walk(tree.value)
  familyMetaCache.value = out
}

/** R24：按 source 定位品牌节点（双顶层树，根不再恒为 tree.value[0]） */
function brandNodeOf(brandCode: string, source: Source): TreeNode | undefined {
  const root = tree.value.find((r) => r.data.source === source)
  return root?.children?.find((n) => n.kind === 'brand' && n.data.brandCode === brandCode)
}

function versionSelector(node: TreeNode): SysSelector {
  return {
    brandCode: node.data.brandCode ?? '',
    kind: node.data.cat ?? '',
    familyCode: node.data.familyCode ?? '',
    versionDir: node.data.versionDir ?? '',
  }
}

/** 片段预览：宿主模板选项（本品牌模板族×版本，按当前片段黑白名单过滤） */
const hostTemplateOptions = computed<{ id: string; label: string; slots: SlotDef[] }[]>(() => {
  const node = selected.value
  if (node?.kind !== 'version' || node.data.cat !== 'fragment') return []
  const brand = node.data.brandCode ?? ''
  const famPolicy = familyMetaCache.value[`${brand}/fragment/${node.data.familyCode}`]?.policy
  const policy = (metaRaw.value?.policy as Policy | undefined) ?? famPolicy
  const out: { id: string; label: string; slots: SlotDef[] }[] = []
  const bNode = brandNodeOf(brand, node.data.source)
  const tplCat = bNode?.children?.find((n) => n.kind === 'category' && n.data.cat === 'template')
  for (const fam of tplCat?.children?.filter((n) => n.kind === 'family') ?? []) {
    const famCode = fam.data.familyCode ?? ''
    const slots = (familyMetaCache.value[fam.data.path]?.slots ?? []).map((s) => ({ key: s.key, label: s.type || s.key }))
    for (const ver of fam.children?.filter((n) => n.kind === 'version') ?? []) {
      const dir = ver.data.versionDir ?? ''
      const ids = [`tpl_sys_${brand}_${famCode}`, `tplv_sys_${brand}_${famCode}_${dir || 'default'}`]
      if (!policyAllows(policy, ids)) continue
      out.push({
        id: JSON.stringify({ brandCode: brand, kind: 'template', familyCode: famCode, versionDir: dir }),
        label: `${fam.label} / ${ver.label}`,
        slots,
      })
    }
  }
  return out
})

/** 组合编辑器的片段选项：片段预览=当前片段；模板预览=本品牌片段版本（族级 policy 过滤） */
const composeFragmentOptions = computed<{ id: string; label: string }[]>(() => {
  const node = selected.value
  if (node?.kind !== 'version') return []
  if (node.data.cat === 'fragment') return [{ id: JSON.stringify(versionSelector(node)), label: node.label }]
  const brand = node.data.brandCode ?? ''
  const famCode = node.data.familyCode ?? ''
  const dir = node.data.versionDir ?? ''
  const tplIds = [`tpl_sys_${brand}_${famCode}`, `tplv_sys_${brand}_${famCode}_${dir || 'default'}`]
  const out: { id: string; label: string }[] = []
  const bNode = brandNodeOf(brand, node.data.source)
  const fragCat = bNode?.children?.find((n) => n.kind === 'category' && n.data.cat === 'fragment')
  for (const fam of fragCat?.children?.filter((n) => n.kind === 'family') ?? []) {
    if (!policyAllows(familyMetaCache.value[fam.data.path]?.policy, tplIds)) continue
    for (const ver of fam.children?.filter((n) => n.kind === 'version') ?? []) {
      out.push({ id: JSON.stringify(versionSelector(ver)), label: `${fam.label} / ${ver.label}` })
    }
  }
  return out
})

/** 区块清单：片段预览=宿主模板 slots（选定后填充）；模板预览=本族 slots */
const composeSlotDefs = computed<SlotDef[]>(() => {
  if (composeSlots.value.length) return composeSlots.value
  const node = selected.value
  if (node?.kind === 'version' && node.data.cat === 'template') {
    const famMeta = familyMetaCache.value[`${node.data.brandCode}/template/${node.data.familyCode}`]
    return (famMeta?.slots ?? []).map((s) => ({ key: s.key, label: s.type || s.key }))
  }
  return []
})

function onHostTemplateChange(id: string): void {
  composeSlots.value = hostTemplateOptions.value.find((t) => t.id === id)?.slots ?? []
  const first = composeSlots.value[0]?.key ?? ''
  composePlacements.value = composePlacements.value.map((p, i) => ({
    ...p,
    slot: composeSlots.value.some((s) => s.key === p.slot) ? p.slot : first,
    order: i,
  }))
  void renderComposePreview()
}

async function renderComposePreview(): Promise<void> {
  const node = selected.value
  if (node?.kind !== 'version') return
  previewing.value = true
  try {
    const templateSel = node.data.cat === 'fragment'
      ? (JSON.parse(composeTemplate.value || 'null') as SysSelector | null)
      : versionSelector(node)
    if (!templateSel?.familyCode) {
      ElMessage.warning('请先选择宿主模板')
      return
    }
    const placements = composePlacements.value.map((p) => ({
      selector: JSON.parse(p.fragmentId) as SysSelector,
      slot: p.slot,
      order: p.order,
      repeat: p.repeat,
      data: p.data,
    }))
    const res = (await api('content:render', { source: selected.value?.data.source ?? 'system', selector: templateSel, placements })) as { html: string }
    previewHtml.value = res.html
  } catch (err) {
    ElMessage.warning(`组合预览失败：${(err as Error).message}`)
  } finally {
    previewing.value = false
  }
}

/* placement 独立数据编辑（Q12）：有 fields schema 用 SampleForm，否则 YAML */
const placementData = ref<{ open: boolean; uid: string; fields: FieldDef[]; obj: Record<string, unknown>; yamlText: string }>({
  open: false, uid: '', fields: [], obj: {}, yamlText: '',
})
async function openPlacementData(item: PlacementItem): Promise<void> {
  let fields: FieldDef[] = []
  try {
    const sel = JSON.parse(item.fragmentId) as SysSelector
    const famPath = `${sel.brandCode}/${sel.kind}/${sel.familyCode}`
    const verPath = sel.versionDir ? `${famPath}/${sel.versionDir}` : famPath
    const verMeta = ((yaml.load(await read(`${verPath}/meta.yaml`, selected.value?.data.source ?? 'system')) as Record<string, unknown>) ?? {})
    fields = normalizeFields((verMeta['fields'] as unknown) ?? familyMetaCache.value[famPath]?.fields ?? [])
  } catch { /* 无 schema 走 YAML */ }
  const obj = { ...(item.data ?? {}) }
  placementData.value = { open: true, uid: item.uid, fields, obj, yamlText: yaml.dump(obj, { lineWidth: -1 }) }
}
function savePlacementData(): void {
  const st = placementData.value
  let data: Record<string, unknown>
  if (st.fields.length) {
    data = { ...st.obj }
  } else {
    try {
      data = parseYamlObject(st.yamlText)
    } catch (err) {
      ElMessage.error(`片段数据不是合法 YAML：${(err as Error).message}`)
      return
    }
  }
  composePlacements.value = composePlacements.value.map((p) => (p.uid === st.uid ? { ...p, data } : p))
  st.open = false
  void renderComposePreview()
}

function fillForm(raw: Record<string, unknown>): void {
  const policy = (raw.policy ?? {}) as { blacklist?: string[]; whitelist?: string[] }
  form.value = {
    name: String(raw.name ?? ''),
    code: String(raw.code ?? ''),
    description: String(raw.description ?? ''),
    logo: String(raw.logo ?? ''),
    type: String(raw.type ?? ''),
    version: Number(raw.version ?? 1),
    changelog: String(raw.changelog ?? ''),
    policyB: (policy.blacklist ?? []).join('、'),
    policyW: (policy.whitelist ?? []).join('、'),
  }
}

async function onNode(node: TreeNode): Promise<void> {
  selected.value = node
  metaMode.value = 'form'
  if (node.kind === 'cssFile') {
    await openCssTab(node.data.path)
    return
  }
  metaRaw.value = null
  metaText.value = ''
  sourceText.value = ''
  sampleText.value = ''
  styleText.value = ''
  previewHtml.value = ''
  if (node.data.metaPath) {
    metaText.value = await read(node.data.metaPath, node.data.source)
    try {
      metaRaw.value = (yaml.load(metaText.value) as Record<string, unknown>) ?? {}
      fillForm(metaRaw.value)
    } catch {
      metaRaw.value = null
      metaMode.value = 'data'
    }
  }
  if (node.kind === 'version') {
    sourceText.value = await read(node.data.sourcePath ?? '', node.data.source)
    sampleText.value = await read(node.data.samplePath ?? '', node.data.source)
    styleText.value = await read(`${node.data.path}/style.css`, node.data.source)
    // R15：schema 取版本 meta fields，缺省回退族 meta fields；有 schema 默认表单模式
    let parsedSample: Record<string, unknown> = {}
    try {
      parsedSample = parseYamlObject(sampleText.value)
    } catch {
      // 空 / 非法 sample.yaml 都按空模型进入表单，不阻断编辑
      parsedSample = {}
    }
    const famPath = node.data.path.split('/').slice(0, 3).join('/')
    const fields = normalizeFields(metaRaw.value?.['fields'] ?? (await readFamilyFields(famPath, node.data.source)))
    sampleSchema.value = fields
    sampleObj.value = applyDefaults(fields, parsedSample)
    sampleMode.value = fields.length ? 'form' : 'data'
    // R19 组合预览初始化：片段=预置自身 placement（待选宿主模板）；模板=空布局
    composeSlots.value = []
    composeTemplate.value = ''
    composePlacements.value = node.data.cat === 'fragment'
      ? [{ uid: `p_${Date.now()}_0`, fragmentId: JSON.stringify(versionSelector(node)), label: node.label, slot: '', order: 0, repeat: 1 }]
      : []
    await renderPreview(node)
  }
}

/** 族级 meta.yaml 的 fields 段（版本未声明时兜底） */
async function readFamilyFields(famPath: string, source: Source): Promise<unknown> {
  const txt = await read(`${famPath}/meta.yaml`, source)
  try {
    return ((yaml.load(txt) as Record<string, unknown>) ?? {})['fields']
  } catch {
    return undefined
  }
}

/** 示例数据 表单↔数据 切换（R15） */
function switchSampleMode(mode: 'form' | 'data' | 'design'): void {
  if (mode === sampleMode.value) return
  if (mode === 'design') { sampleMode.value = 'design'; return }
  if (mode === 'data') sampleText.value = yaml.dump(sampleObj.value ?? {}, { lineWidth: -1 })
  else {
    // 复核项 8：空示例数据是合法初始状态，parseYamlObject 返回 {}，不再误报 YAML 问题
    let parsed: Record<string, unknown>
    try {
      parsed = parseYamlObject(sampleText.value)
    } catch (err) {
      ElMessage.error(`示例数据不是合法 YAML：${(err as Error).message}`)
      sampleMode.value = 'data'
      return
    }
    sampleObj.value = applyDefaults(sampleSchema.value, parsed)
  }
  sampleMode.value = mode
}

function syncFormToRaw(): Record<string, unknown> {
  const patch: Record<string, unknown> = {}
  const s = showForm.value
  if (s.catBase || s.brandBase || s.version) {
    if (form.value.name !== '') patch.name = form.value.name.trim()
    patch.description = form.value.description.trim() || undefined
    if (s.brandBase && form.value.code !== '') patch.code = form.value.code.trim()
  }
  if (s.brandBase && form.value.logo !== '') patch.logo = form.value.logo.trim()
  if (s.policy) {
    patch.type = form.value.type.trim() || undefined
    patch.policy = { blacklist: splitList(form.value.policyB), whitelist: splitList(form.value.policyW) }
  }
  if (s.version) {
    patch.version = form.value.version
    patch.changelog = form.value.changelog.trim() || undefined
  }
  return { ...(metaRaw.value ?? {}), ...patch }
}

function switchMetaMode(mode: 'form' | 'data'): void {
  if (mode === metaMode.value) return
  if (mode === 'data') metaText.value = yaml.dump(syncFormToRaw(), { lineWidth: -1 })
  else {
    // 复核项 8：meta.yaml 为空时按空对象进入表单，不弹 YAML 错误
    let parsed: Record<string, unknown>
    try {
      parsed = parseYamlObject(metaText.value)
    } catch (err) {
      ElMessage.error(`元数据不是合法 YAML：${(err as Error).message}`)
      metaMode.value = 'data'
      return
    }
    metaRaw.value = parsed
    fillForm(parsed)
  }
  metaMode.value = mode
}

async function saveMeta(): Promise<void> {
  const node = selected.value
  if (!node?.data.metaPath) return
  try {
    let out = ''
    if (metaMode.value === 'form') {
      out = yaml.dump(syncFormToRaw(), { lineWidth: -1 })
    } else {
      parseYamlObject(metaText.value) // 语法校验，非法即抛；空内容视为 {}
      out = metaText.value
    }
    await write(node.data.metaPath, out)
    if (node.kind !== 'root') await load(true) // 元数据名称/code 变更实时反馈到左树（#4）
    ElMessage.success('元数据已保存')
    if (node.kind === 'version') await renderPreview(node)
  } catch (err) {
    ElMessage.error(`保存失败：${(err as Error).message}`)
  }
}

async function saveSource(): Promise<void> {
  const node = selected.value
  if (!node?.data.sourcePath) return
  try {
    await write(node.data.sourcePath, sourceText.value)
    ElMessage.success('源码已保存')
    await renderPreview(node)
  } catch (err) {
    ElMessage.error(`保存失败：${(err as Error).message}`)
  }
}

/** 版本级内联样式：<verDir>/style.css，渲染时最后注入（优先级最高） */
async function saveStyle(): Promise<void> {
  const node = selected.value
  if (!node || node.kind !== 'version') return
  try {
    await write(`${node.data.path}/style.css`, styleText.value)
    ElMessage.success('样式已保存')
    await renderPreview(node)
  } catch (err) {
    ElMessage.error(`保存失败：${(err as Error).message}`)
  }
}

async function saveSample(): Promise<void> {
  const node = selected.value
  if (!node?.data.samplePath) return
  // R15：表单模式先全量校验（v5 §5.2 铁律：未通过阻止保存）
  if (sampleMode.value === 'form') {
    const errors = validateModel(sampleSchema.value, sampleObj.value)
    if (Object.keys(errors).length > 0) {
      ElMessage.error(`示例数据校验未通过（${Object.keys(errors).length} 处），请检查标红项`)
      return
    }
    sampleText.value = yaml.dump(sampleObj.value, { lineWidth: -1 })
  } else {
    try {
      parseYamlObject(sampleText.value)
    } catch (err) {
      ElMessage.error(`示例数据不是合法 YAML：${(err as Error).message}`)
      return
    }
  }
  try {
    // T8：把历史残留的内联 data: 图片上传为内容资源 URL，回写后再落盘 sample.yaml
    // （单张失败保留原内联图片，不阻断保存）
    const uploaded = await uploadInlineImages(sampleText.value, toolId.value)
    if (uploaded !== sampleText.value) {
      sampleText.value = uploaded
      if (sampleMode.value === 'form') {
        sampleObj.value = parseYamlObject(uploaded)
      }
    }
    await write(node.data.samplePath, sampleText.value)
    ElMessage.success('示例数据已保存')
    await renderPreview(node)
  } catch (err) {
    ElMessage.error(`保存失败：${(err as Error).message}`)
  }
}

/** 字段设计器写回：把 fields 外科手术式替换进 meta.yaml（保留其余键与注释） */
async function saveFields(): Promise<void> {
  const node = selected.value
  if (!node?.data.metaPath) return
  const fields = normalizeFields(sampleSchema.value)
  if (fields.length !== sampleSchema.value.length) {
    ElMessage.warning(`已忽略 ${sampleSchema.value.length - fields.length} 个非法字段（缺 key 或未知类型）`)
    sampleSchema.value = fields
  }
  try {
    const raw = metaText.value || (await read(node.data.metaPath))
    const updated = replaceFieldsInMeta(raw, fields)
    await write(node.data.metaPath, updated)
    metaText.value = updated
    metaRaw.value = (yaml.load(updated) as Record<string, unknown>) ?? {}
    ElMessage.success('字段定义已保存（meta.yaml fields:）')
    await renderPreview(node)
  } catch (err) {
    ElMessage.error(`保存失败：${(err as Error).message}`)
  }
}

/* ── css 多 tab 编辑（外置 css，互相参照） ── */
const cssTabs = ref<CssTab[]>([])
const activeCss = ref('')
const activeTab = computed(() => cssTabs.value.find((t) => t.file === activeCss.value) ?? null)

async function openCssTab(file: string): Promise<void> {
  if (!cssTabs.value.some((t) => t.file === file)) {
    cssTabs.value.push({ file, content: await read(file), dirty: false })
  }
  activeCss.value = file
}
function dropTabsUnder(pathPrefix: string): void {
  cssTabs.value = cssTabs.value.filter((t) => !t.file.startsWith(`${pathPrefix}/`))
  if (!cssTabs.value.some((t) => t.file === activeCss.value)) activeCss.value = cssTabs.value[0]?.file ?? ''
}
function onCssEdit(file: string, v: string): void {
  const tab = cssTabs.value.find((t) => t.file === file)
  if (tab) {
    tab.content = v
    tab.dirty = true
  }
}
async function saveCss(tab: CssTab): Promise<void> {
  try {
    await write(tab.file, tab.content)
    tab.dirty = false
    ElMessage.success('样式已保存')
    if (selected.value?.kind === 'version') await renderPreview(selected.value)
  } catch (err) {
    ElMessage.error(`保存失败：${(err as Error).message}`)
  }
}
async function saveAllCss(): Promise<void> {
  for (const t of cssTabs.value.filter((x) => x.dirty)) await saveCss(t)
}
async function closeCssTab(file: string): Promise<void> {
  const tab = cssTabs.value.find((t) => t.file === file)
  if (tab?.dirty) {
    try {
      await ElMessageBox.confirm(`「${basename(file)}」有未保存修改，关闭将丢弃`, '提示', { type: 'warning', confirmButtonText: '丢弃并关闭', cancelButtonText: '取消' })
    } catch {
      return
    }
  }
  cssTabs.value = cssTabs.value.filter((t) => t.file !== file)
  if (activeCss.value === file) activeCss.value = cssTabs.value[0]?.file ?? ''
}

/* ── 右键菜单（v5 分层） ── */
type MenuItem = { key: string; label: string; danger?: boolean }
const menu = ref<{ x: number; y: number; node: TreeNode } | null>(null)
/** R24：节点可编辑 ⟺ source==='custom'（恒可写）或系统门控通过 */
function nodeCanEdit(node: TreeNode): boolean {
  return node.data.source === 'custom' || canEditSystem.value
}
/**
 * R24 右键菜单——统一顺序：复制 → 粘贴 → 删除 → 重命名 → 另存为 → 新建。
 * 复制/粘贴仅 css 支持；新建按节点类型挂对应项；编辑项仅在节点可编辑时出现（onContextMenu 已门控）。
 */
const menuItems = computed<MenuItem[]>(() => {
  if (!menu.value) return []
  const node = menu.value.node
  const k = node.kind
  const items: MenuItem[] = []
  // 复制 / 粘贴（仅 css 目录、css 文件）
  if (k === 'cssDir' || k === 'cssFile') items.push({ key: 'copy', label: '复制' })
  if (k === 'cssDir') items.push({ key: 'paste', label: '粘贴' })
  // 删除 / 重命名（除根外均可）
  if (k !== 'root') items.push({ key: 'remove', label: '删除', danger: true })
  if (k !== 'root') items.push({ key: 'rename', label: '重命名' })
  // 另存为（实体 / css）
  if (k === 'brand' || k === 'family' || k === 'version' || k === 'cssDir' || k === 'cssFile')
    items.push({ key: 'saveAs', label: '另存为' })
  // 新建（逐个对应：品牌→新建品牌、片段→新建片段族、模板→新建模板族；族额外加新建版本）
  if (k === 'root') items.push({ key: 'newBrand', label: '新建品牌' })
  if (k === 'brand') {
    items.push({ key: 'newBrand', label: '新建品牌' })
    items.push({ key: 'newFragmentFamily', label: '新建片段族' })
    items.push({ key: 'newTemplateFamily', label: '新建模板族' })
  }
  if (k === 'category') {
    items.push(node.data.cat === 'fragment' ? { key: 'newFragmentFamily', label: '新建片段族' } : { key: 'newTemplateFamily', label: '新建模板族' })
  }
  if (k === 'family') {
    items.push({ key: 'newVersion', label: '新建版本' })
    items.push(node.data.cat === 'fragment' ? { key: 'newFragmentFamily', label: '新建片段族（同级）' } : { key: 'newTemplateFamily', label: '新建模板族（同级）' })
  }
  if (k === 'version') items.push({ key: 'newVersion', label: '新建版本（同级）' })
  if (k === 'cssDir') items.push({ key: 'newFile', label: '新建样式' })
  return items
})
function onContextMenu(event: MouseEvent, node: TreeNode): void {
  event.preventDefault()
  if (!nodeCanEdit(node)) return
  menu.value = { x: event.clientX, y: event.clientY, node }
}
function closeMenu(): void {
  menu.value = null
}
function onDocMouseDown(e: MouseEvent): void {
  if (!menu.value) return
  const el = document.querySelector('.ctx-menu')
  if (el && !el.contains(e.target as Node)) closeMenu()
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

/* ── 菜单动作 ── */
async function uniqueName(dir: string, name: string): Promise<string> {
  const m = name.match(/^(\.*[^.]*?)(\.[^.]+)?$/)
  const stem = m?.[1] || name
  const ext = m?.[2] ?? ''
  let cand = name
  let i = 1
  while (await existsIn(dir ? `${dir}/${cand}` : cand)) {
    cand = `${stem}-${i}${ext}`
    i++
  }
  return cand
}
/** 冲突抉择：覆盖（原名）/ 自动改名保留两者（唯一名）/ 关闭 = 放弃 */
async function resolveConflict(dir: string, name: string): Promise<string | null> {
  try {
    await ElMessageBox.confirm(`「${name}」已存在`, '同名冲突', {
      type: 'warning',
      distinguishCancelAndClose: true,
      confirmButtonText: '覆盖',
      cancelButtonText: '自动改名保留两者',
    })
    return name
  } catch (action) {
    if (action === 'cancel') return uniqueName(dir, name)
    return null
  }
}
async function pasteFileInto(dir: string, name: string, src: string, dest: Source, srcSource: Source): Promise<void> {
  let finalName = name
  if (await existsIn(dir ? `${dir}/${name}` : name, dest)) {
    const resolved = await resolveConflict(dir, name)
    if (!resolved) return
    finalName = resolved
  }
  await write(dir ? `${dir}/${finalName}` : finalName, await read(src, srcSource), dest)
}

async function onMenu(key: string): Promise<void> {
  const node = menu.value?.node
  closeMenu()
  if (!node) return
  try {
    if (key === 'copy') {
      clipboard.value =
        node.kind === 'cssDir'
          ? { type: 'cssDir', dirPath: node.data.path, files: node.data.cssFiles ?? [], source: node.data.source }
          : { type: 'cssFile', file: node.data.path, source: node.data.source }
      ElMessage.success('已复制')
      return
    }
    if (key === 'paste') {
      if (!clipboard.value) {
        ElMessage.warning('剪贴板为空，请先复制 css 目录或文件')
        return
      }
      const baseDir = node.kind === 'cssDir' ? node.data.path : node.data.path ? `${node.data.path}/css` : 'css'
      const dest = node.data.source
      if (clipboard.value.type === 'cssFile') {
        await pasteFileInto(baseDir, basename(clipboard.value.file), clipboard.value.file, dest, clipboard.value.source)
      } else {
        for (const f of clipboard.value.files) await pasteFileInto(baseDir, f, `${clipboard.value.dirPath}/${f}`, dest, clipboard.value.source)
      }
      ElMessage.success('已粘贴')
      await load(true)
      return
    }
    if (key === 'newFile') {
      let name = String((await ElMessageBox.prompt('css 文件名（可省略 .css 后缀）', '新建样式', { inputValue: '' })).value ?? '').trim()
      if (!name) return
      if (!name.endsWith('.css')) name += '.css'
      let finalName = name
      if (await existsIn(`${node.data.path}/${name}`, node.data.source)) {
        const resolved = await resolveConflict(node.data.path, name)
        if (!resolved) return
        finalName = resolved
      }
      await write(`${node.data.path}/${finalName}`, '', node.data.source)
      ElMessage.success('已创建')
      await load(true)
      return
    }
    if (key === 'rename') {
      const tip = node.kind === 'cssDir' || node.kind === 'cssFile' ? '' : '（目录 meta.yaml 内的 code 不会自动修改，请随后自行同步）'
      const newName = String(
        (await ElMessageBox.prompt(`新名称${tip}`, '重命名', { inputValue: basename(node.data.path) })).value ?? '',
      ).trim()
      if (!newName || newName === basename(node.data.path)) return
      await api('content:rename', { source: node.data.source, file: node.data.path, newName })
      ElMessage.success('已重命名')
      if (selected.value?.data.path === node.data.path) selected.value = null
      await load(true)
      return
    }
    if (key === 'remove') {
      await ElMessageBox.confirm(`确定删除「${node.label}」？此操作不可恢复。`, '危险操作', { type: 'error', confirmButtonText: '删除', cancelButtonText: '取消' })
      await api('content:remove', { source: node.data.source, file: node.data.path })
      ElMessage.success('已删除')
      if (selected.value?.data.path.startsWith(node.data.path)) selected.value = null
      dropTabsUnder(node.data.path)
      await load(true)
      return
    }
    /* ── R24 新建动作（写入节点所属 source 根） ── */
    if (key === 'newBrand') {
      const src = node.data.source
      const got = await promptCodeAndName('新建品牌', '品牌代码（目录名，英文）', '')
      if (!got) return
      if (await existsIn(`${got.code}/meta.yaml`, src)) { ElMessage.error(`品牌「${got.code}」已存在`); return }
      await write(`${got.code}/meta.yaml`, yaml.dump({ code: got.code, name: got.name }, { lineWidth: -1 }), src)
      ElMessage.success('已创建品牌'); await load(true); return
    }
    if (key === 'newFragmentFamily' || key === 'newTemplateFamily') {
      const src = node.data.source
      const cat: Cat = key === 'newFragmentFamily' ? 'fragment' : 'template'
      const brandCode = node.data.brandCode ?? ''
      if (!brandCode) { ElMessage.error('无法确定所属品牌'); return }
      const got = await promptCodeAndName('新建族', '族代码（目录名，英文）', '')
      if (!got) return
      const parent = `${brandCode}/${cat}`
      if (await existsIn(`${parent}/${got.code}/meta.yaml`, src)) { ElMessage.error(`族「${got.code}」已存在`); return }
      const meta: Record<string, unknown> = { code: got.code, name: got.name }
      if (cat === 'fragment') meta.type = 'product'
      else meta.slots = []
      await write(`${parent}/${got.code}/meta.yaml`, yaml.dump(meta, { lineWidth: -1 }), src)
      ElMessage.success('已创建族'); await load(true); return
    }
    if (key === 'newVersion') {
      const src = node.data.source
      const { brandCode, cat, familyCode } = node.data
      if (!brandCode || !cat || !familyCode) { ElMessage.error('无法确定所属族'); return }
      const famPath = `${brandCode}/${cat}/${familyCode}`
      const dirInput = String((await ElMessageBox.prompt('版本目录名（如 v2，留空自动递增）', '新建版本', { inputValue: '' })).value ?? '').trim()
      const finalDir = dirInput || `v${nextVersionOf(famPath, src)}`
      if (!validCode(finalDir)) { ElMessage.error('版本目录名仅限字母 / 数字 / 下划线 / 连字符'); return }
      if (await existsIn(`${famPath}/${finalDir}/meta.yaml`, src)) { ElMessage.error(`版本「${finalDir}」已存在`); return }
      await write(`${famPath}/${finalDir}/meta.yaml`, yaml.dump({ version: parseVersion(finalDir) }, { lineWidth: -1 }), src)
      await write(`${famPath}/${finalDir}/source.njk`, '', src)
      await write(`${famPath}/${finalDir}/sample.yaml`, '', src)
      ElMessage.success('已创建版本'); await load(true); return
    }
    if (key === 'saveAs') void openSaveAs(node)
  } catch (err) {
    if (err === 'cancel' || err === 'close') return // 取消/关闭不视为错误（#3）
    ElMessage.error((err as Error).message)
  }
}

/* ── 另存为弹框（R24：origin = 目标根 source；系统根受 dev 门控） ── */
const saveAsState = ref<{ visible: boolean; node: TreeNode | null; name: string; code: string; target: string; origin: Source; raw: Record<string, unknown> }>({
  visible: false, node: null, name: '', code: '', target: '', origin: 'system', raw: {},
})
const saveAsIsEntity = computed(() => ['brand', 'family', 'version'].includes(saveAsState.value.node?.kind ?? ''))
const saveAsIsCssFile = computed(() => saveAsState.value.node?.kind === 'cssFile')
/** 另存为目标位置（按类型过滤：片段→片段类目/族，模板→模板类目/族；仅列目标根，避免跨根错位），#5 */
const saveAsTargetOptions = computed<{ path: string; label: string }[]>(() => {
  const node = saveAsState.value.node
  if (!node || (node.kind !== 'family' && node.kind !== 'version')) return []
  const wantCat = node.data.cat
  const wantSource = saveAsState.value.origin
  const out: { path: string; label: string }[] = []
  const walk = (nodes: TreeNode[]): void => {
    for (const n of nodes) {
      if (node.kind === 'family' && n.kind === 'category' && n.data.cat === wantCat && n.data.source === wantSource)
        out.push({ path: n.data.path, label: `${n.data.brandCode} / ${n.label}` })
      if (node.kind === 'version' && n.kind === 'family' && n.data.cat === wantCat && n.data.source === wantSource)
        out.push({ path: n.data.path, label: `${n.data.brandCode} / ${n.label}` })
      if (n.children) walk(n.children)
    }
  }
  walk(tree.value)
  return out
})
async function openSaveAs(node: TreeNode): Promise<void> {
  let raw: Record<string, unknown> = {}
  if (node.data.metaPath) {
    try {
      raw = (yaml.load(await read(node.data.metaPath, node.data.source)) as Record<string, unknown>) ?? {}
    } catch {
      raw = {}
    }
  }
  const isEntity = ['brand', 'family', 'version'].includes(node.kind)
  // 默认目标根=同源（同根副本），用户可切到另一根
  const origin: Source = node.data.source
  saveAsState.value = { visible: true, node, name: `${basename(node.data.path)}-copy`, code: '', target: '', origin, raw }
  // 默认目标落点：实体按类型过滤后的首个候选（目标根内）；css 取目标根首个 css 目录（#1/#5）
  const opts = saveAsTargetOptions.value
  saveAsState.value.target = isEntity
    ? (opts[0]?.path ?? splitPath(node.data.path).slice(0, node.kind === 'version' ? 3 : 2).join('/'))
    : (allCssDirs.value.find((d) => d.source === origin)?.path ?? '')
}
async function confirmSaveAs(): Promise<void> {
  const { node, name, code, target, raw, origin } = saveAsState.value
  if (!node) return
  const fromSource = node.data.source
  const cleanName = name.trim()
  if (!cleanName) {
    ElMessage.warning('名称必填')
    return
  }
  // 写入系统根必须 dev / developerMode 门控通过
  if (origin === 'system' && !canEditSystem.value) {
    ElMessage.error('系统内容只读：写入系统根需开启开发者模式（dev）')
    return
  }
  try {
    // system→custom：派生（重写 custom-edm 文件根，文件为真相源；详见 ipc system:derive）
    if (fromSource === 'system' && origin === 'custom') {
      const res = await api<DeriveCounts>('system:derive', {
        kind: node.kind, name: cleanName,
        brandCode: node.data.brandCode ?? '', cat: node.data.cat ?? '',
        familyCode: node.data.familyCode ?? '', versionDir: node.data.versionDir ?? '',
        target: saveAsState.value.target,
      })
      saveAsState.value.visible = false
      const parts = [
        res.templates > 0 ? `模板族×${res.templates}` : '',
        res.templateVersions > 0 ? `模板版本×${res.templateVersions}` : '',
        res.fragments > 0 ? `片段族×${res.fragments}` : '',
        res.fragmentVersions > 0 ? `片段版本×${res.fragmentVersions}` : '',
        res.brands > 0 ? `品牌×${res.brands}` : '',
      ].filter(Boolean)
      ElMessage.success(`已派生到自定义内容库${parts.length ? `：${parts.join('、')}` : ''}`)
      await load(true)
      return
    }
    // 其余（同根副本 / 自定义→系统）：源 root 读、目标 root 写，逐文件拷贝
    if (node.kind === 'brand') {
      const newCode = (code.trim() || cleanName).trim()
      if (await existsIn(`${newCode}/meta.yaml`, origin)) {
        ElMessage.error(`品牌「${newCode}」已存在`)
        return
      }
      await write(`${newCode}/meta.yaml`, yaml.dump({ ...raw, code: newCode, name: cleanName }, { lineWidth: -1 }), origin)
    } else if (node.kind === 'family') {
      const newCode = (code.trim() || cleanName).trim()
      const parent = saveAsState.value.target || splitPath(node.data.path).slice(0, 2).join('/')
      if (await existsIn(`${parent}/${newCode}/meta.yaml`, origin)) {
        ElMessage.error(`同层已存在「${newCode}」`)
        return
      }
      await write(`${parent}/${newCode}/meta.yaml`, yaml.dump({ ...raw, code: newCode, name: cleanName }, { lineWidth: -1 }), origin)
    } else if (node.kind === 'version') {
      const famPath = saveAsState.value.target || splitPath(node.data.path).slice(0, 3).join('/')
      const dst = `${famPath}/${cleanName}`
      if (await existsIn(`${dst}/meta.yaml`, origin)) {
        ElMessage.error(`版本目录「${cleanName}」已存在`)
        return
      }
      // 复用该版本的全部文件 + css 目录（递归列出，含 css/ 子目录与任意附加文件），到新位置后稍作修改即可成型
      const files = (await api<string[]>('content:listDir', { source: fromSource, dir: node.data.path })) ?? []
      for (const rel of files) {
        const content = await read(`${node.data.path}/${rel}`, fromSource)
        if (content === null) continue
        await write(`${dst}/${rel}`, content, origin)
      }
    } else if (node.kind === 'cssDir') {
      // css 目录另存为 = 目录下文件整体复制到目标 css 目录（目录名恒为 css，不建子目录）
      for (const f of node.data.cssFiles ?? []) await pasteFileInto(target, f, `${node.data.path}/${f}`, origin, fromSource)
    } else {
      // css 文件另存为 = 目标 css 目录 + 新文件名
      const fileName = cleanName.endsWith('.css') ? cleanName : `${cleanName}.css`
      await pasteFileInto(target, fileName, node.data.path, origin, fromSource)
    }
    saveAsState.value.visible = false
    ElMessage.success('另存为完成')
    await load(true)
  } catch (err) {
    ElMessage.error(`另存为失败：${(err as Error).message}`)
  }
}
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
          v-if="treeReady && tree.length"
          :ref="setTreeRef"
          :data="tree"
          node-key="id"
          :default-expanded-keys="defaultExpandedKeys"
          highlight-current
          :expand-on-click-node="false"
          @node-click="(data: TreeNode) => onNode(data)"
          @node-contextmenu="(e: MouseEvent, data: TreeNode) => onContextMenu(e, data)"
        >
          <template #default="{ data }">
            <span class="tree-node" :class="`is-${String(data.kind)}`">
              <svg class="node-icon" viewBox="0 0 24 24" aria-hidden="true" :style="{ color: nodeIcon(data.kind).color }"><path :d="nodeIcon(data.kind).path" /></svg>
              <span class="node-label">{{ data.label }}</span>
            </span>
          </template>
        </el-tree>
        <EmptyState v-else :description="loading ? '正在加载内容…' : '暂无系统内容'" />
      </div>
      <div class="detail-pane">
        <!-- css 文件多 tab 编辑（选中 css 文件时）：tab 条只做切换，编辑器单实例常驻（隐藏 pane 内挂载 Monaco 会失效） -->
        <template v-if="selected?.kind === 'cssFile' && cssTabs.length">
          <div class="css-editor">
            <el-tabs v-model="activeCss" type="card" closable @tab-remove="closeCssTab(String($event))">
              <el-tab-pane v-for="t in cssTabs" :key="t.file" :name="t.file" :label="`${basename(t.file)}${t.dirty ? ' ●' : ''}`" />
            </el-tabs>
            <template v-if="activeTab">
              <div class="editor-toolbar">
                <span class="hint">外置 css：渲染时 &lt;link&gt; 引入（就近链，越深优先级越高）</span>
                <el-button size="small" type="primary" class="push-right" @click="saveCss(activeTab!)">保存</el-button>
                <el-button size="small" type="success" plain :disabled="!cssTabs.some((x) => x.dirty)" @click="saveAllCss">保存全部</el-button>
              </div>
              <CodeEditor
                :model-value="activeTab.content"
                :path="activeTab.file"
                language="css"
                :readonly="!canEdit"
                height="calc(100% - 80px)"
                @update:model-value="(v: string) => onCssEdit(activeTab!.file, v)"
              />
            </template>
          </div>
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
            <el-form v-if="metaMode === 'form' && (showForm.catBase || showForm.brandBase || showForm.version)" label-width="auto" class="meta-form">
              <el-form-item label="名称"><el-input clearable v-model="form.name" :disabled="!canEdit" /></el-form-item>
              <el-form-item v-if="showForm.brandBase" label="code"><el-input clearable v-model="form.code" :disabled="!canEdit" /></el-form-item>
              <el-form-item label="描述"><el-input clearable v-model="form.description" type="textarea" :rows="2" :disabled="!canEdit" /></el-form-item>
              <el-form-item v-if="selected?.kind === 'brand'" label="logo"><el-input clearable v-model="form.logo" :disabled="!canEdit" placeholder="图片地址" /></el-form-item>
              <template v-if="showForm.policy">
                <el-form-item label="类型"><el-input clearable v-model="form.type" :disabled="!canEdit" placeholder="如 product / banner" /></el-form-item>
                <el-form-item label="黑名单"><el-input clearable v-model="form.policyB" :disabled="!canEdit" placeholder="逗号分隔，标签内可含空格" /></el-form-item>
                <el-form-item label="白名单"><el-input clearable v-model="form.policyW" :disabled="!canEdit" placeholder="为空 = 本品牌内全部模板可用" /></el-form-item>
              </template>
              <el-form-item v-if="showForm.version" label="版本号"><el-input-number v-model="form.version" :min="1" :disabled="!canEdit" /></el-form-item>
              <el-form-item v-if="showForm.version" label="变更说明"><el-input clearable v-model="form.changelog" type="textarea" :rows="2" :disabled="!canEdit" /></el-form-item>
            </el-form>
            <CodeEditor v-else :model-value="metaText" :path="`meta:${selected.data.path}`" language="yaml" :readonly="!canEdit" height="calc(100% - 40px)" @update:model-value="(v: string) => (metaText = v)" />
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
              <span v-if="sampleMode === 'design'" class="hint">拖拽 ≡ 调整顺序；保存写入 meta.yaml 的 fields:</span>
              <el-button v-if="sampleMode === 'design'" size="small" type="primary" :disabled="!canEdit" class="push-right" @click="saveFields">保存字段定义</el-button>
              <el-button v-else size="small" type="primary" :disabled="!canEdit" class="push-right" @click="saveSample">保存</el-button>
            </div>
            <FieldSchemaDesigner v-if="sampleMode === 'design'" v-model="sampleSchema" :readonly="!canEdit" />
            <div v-else-if="sampleMode === 'form' && sampleSchema.length" class="sample-wrap">
              <SampleForm v-model="sampleObj" :fields="sampleSchema" :readonly="!canEdit" />
            </div>
            <CodeEditor v-else :model-value="sampleText" :path="`sample:${selected.data.path}`" language="yaml" :readonly="!canEdit" height="calc(100% - 40px)" @update:model-value="(v: string) => (sampleText = v)" />
          </el-tab-pane>
          <el-tab-pane v-if="selected.kind === 'version'" label="预览">
            <div class="editor-toolbar">
              <el-button size="small" type="primary" plain :disabled="!canEdit" @click="composeOpen = true">片段布局配置</el-button>
              <span class="hint">布局 {{ composePlacements.length }} 项 · 宿主模板：{{ composeHostLabel }}</span>
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
              <span class="hint">内联 css 也可直接写在 njk 的 &lt;style&gt; 内</span>
              <el-button size="small" type="primary" :disabled="!canEdit" class="push-right" @click="saveSource">保存</el-button>
            </div>
            <CodeEditor :model-value="sourceText" :path="`source:${selected.data.path}`" language="njk" :readonly="!canEdit" height="calc(100% - 40px)" @update:model-value="(v: string) => (sourceText = v)" />
          </el-tab-pane>
          <el-tab-pane v-if="selected.kind === 'version'" label="样式">
            <div class="editor-toolbar">
              <span class="hint">内联样式：保存至版本目录 style.css，渲染时最后注入（优先级最高）；外置 css 走左树 css 目录</span>
              <el-button size="small" type="primary" :disabled="!canEdit" class="push-right" @click="saveStyle">保存</el-button>
            </div>
            <CodeEditor :model-value="styleText" :path="`style:${selected.data.path}`" language="css" :readonly="!canEdit" height="calc(100% - 40px)" @update:model-value="(v: string) => (styleText = v)" />
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

    <!-- 另存为弹框（一屏简化版） -->
    <el-dialog v-model="saveAsState.visible" title="另存为" width="480px" :close-on-click-modal="false" :close-on-press-escape="false">
      <el-form label-width="auto">
        <template v-if="saveAsIsEntity">
          <el-form-item label="新名称"><el-input clearable v-model="saveAsState.name" placeholder="默认带 -copy 后缀" /></el-form-item>
          <el-form-item v-if="saveAsState.node?.kind !== 'version' && saveAsState.origin === 'system'" label="code（目录名）">
            <el-input clearable v-model="saveAsState.code" placeholder="留空则用新名称" />
          </el-form-item>
          <el-form-item v-if="saveAsState.node?.kind === 'family' || saveAsState.node?.kind === 'version'" label="目标位置">
            <el-select v-model="saveAsState.target" filterable style="width: 100%">
              <el-option v-for="t in saveAsTargetOptions" :key="t.path" :value="t.path" :label="t.label" />
            </el-select>
          </el-form-item>
          <el-form-item label="保存目标">
            <el-radio-group v-model="saveAsState.origin">
              <el-radio value="system">系统自带（文件域）</el-radio>
              <el-radio value="custom">自定义（文件域）</el-radio>
            </el-radio-group>
          </el-form-item>
          <el-form-item v-if="saveAsState.origin === 'custom' && saveAsState.node?.data.source === 'system'" label="携带内容">
            <span class="hint">派生为自定义副本：整棵内容（meta/源码/示例/css）写入自定义文件根，可在邮件编辑器直接使用</span>
          </el-form-item>
          <el-form-item v-if="saveAsState.node?.kind === 'version'" label="携带内容">
            <span class="hint">版本内全部文件 + 版本级 css 目录（品牌/族级 css 与元数据不跟）</span>
          </el-form-item>
        </template>
        <template v-else>
          <el-form-item label="来源">
            <el-radio-group v-model="saveAsState.origin">
              <el-radio value="system">系统自带</el-radio>
              <el-radio value="custom">自定义</el-radio>
            </el-radio-group>
          </el-form-item>
          <el-form-item label="目标 css 目录">
            <el-select v-model="saveAsState.target" filterable style="width: 100%">
              <el-option v-for="d in allCssDirs.filter((x) => x.source === saveAsState.origin)" :key="d.path" :value="d.path" :label="d.label" />
            </el-select>
          </el-form-item>
          <el-form-item v-if="saveAsIsCssFile" label="新文件名"><el-input clearable v-model="saveAsState.name" /></el-form-item>
          <el-form-item v-else label="携带内容"><span class="hint">目录下全部 css 文件（目录名恒为 css，文件名不变，冲突时询问）</span></el-form-item>
        </template>
      </el-form>
      <template #footer>
        <el-button @click="saveAsState.visible = false">取消</el-button>
        <el-button type="primary" @click="confirmSaveAs">确定</el-button>
      </template>
    </el-dialog>

    <!-- placement 独立数据编辑（Q12：有 fields schema 用表单，否则 YAML） -->
    <el-dialog v-model="placementData.open" title="片段数据" width="560px" :close-on-click-modal="false" :close-on-press-escape="false">
      <SampleForm v-if="placementData.fields.length" v-model="placementData.obj" :fields="placementData.fields" />
      <CodeEditor v-else :model-value="placementData.yamlText" language="yaml" height="320px" @update:model-value="(v: string) => (placementData.yamlText = v)" />
      <template #footer>
        <el-button @click="placementData.open = false">取消</el-button>
        <el-button type="primary" @click="savePlacementData">保存并刷新预览</el-button>
      </template>
    </el-dialog>

    <!-- 片段布局配置弹框（R22：宿主模板选择 + 组合编辑器收进弹框，预览页只留预览） -->
    <el-dialog v-model="composeOpen" title="片段布局配置" width="720px" close-on-click-modal="false" close-on-press-escape="false">
      <div v-if="selected?.data.cat === 'fragment'" class="editor-toolbar" style="padding-bottom: 10px">
        <span class="hint">宿主模板</span>
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
        <span class="hint">拖拽 = 区块内排序；次数 = 重复渲染</span>
      </div>
      <div v-else class="editor-toolbar" style="padding-bottom: 10px">
        <span class="hint">拖入片段布局，模板 css + 片段 css 就近合并看真实效果</span>
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
.detail-tabs, .css-editor { flex: 1; min-height: 0; display: flex; flex-direction: column; }
.detail-tabs :deep(.el-tabs__content), .css-editor :deep(.el-tabs__content) { flex: 1; min-height: 0; }
.detail-tabs :deep(.el-tab-pane), .css-editor :deep(.el-tab-pane) { height: 100%; display: flex; flex-direction: column; }
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
.hint { font-size: 12px; opacity: .6; }
.meta-form { overflow: auto; }
/* #2 表单 label 防换行：长 label（如「code（目录名）」）不再折行破坏行对齐 */
.meta-form :deep(.el-form-item__label),
:deep(.el-dialog .el-form-item__label) { white-space: nowrap; }
.sample-wrap { flex: 1; min-height: 0; overflow: auto; padding: 4px 2px; }
.overview { display: flex; flex-direction: column; gap: 16px; overflow: auto; }
.preview { flex: 1; width: 100%; border: none; background: #fff; border-radius: 4px; }
.compose-editor-dialog { height: 46vh; overflow: auto; padding-bottom: 6px; }

.ctx-menu { position: fixed; z-index: 3000; min-width: 130px; background: var(--el-bg-color-overlay, #fff); border: 1px solid rgba(128,128,128,.25); border-radius: 6px; box-shadow: 0 4px 16px rgba(0,0,0,.18); padding: 4px; }
.ctx-item { padding: 6px 12px; font-size: 13px; border-radius: 4px; cursor: pointer; color: var(--el-text-color-primary); }
.ctx-item:hover { background: var(--el-fill-color-light, rgba(128,128,128,.12)); }
.ctx-item.danger { color: var(--el-color-danger); }
</style>
