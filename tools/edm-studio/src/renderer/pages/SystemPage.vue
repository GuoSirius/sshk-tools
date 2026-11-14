<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import * as yaml from 'js-yaml'
import { EmptyState } from '@sshk/ui-kit'
import MonacoEditor from '../MonacoEditor.vue'
import { api } from '../shared'

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

interface NodeData {
  kind: NodeKind
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
type Clipboard = { type: 'cssDir'; dirPath: string; files: string[] } | { type: 'cssFile'; file: string } | null

const model = ref<{ topCss: string[]; brands: any[] }>({ topCss: [], brands: [] })
const canEdit = ref(false)
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

/* ── 树构造 ── */
function cssDirNode(parentPath: string, files: string[], idPrefix: string): TreeNode {
  const dirPath = parentPath ? `${parentPath}/css` : 'css'
  return {
    id: `${idPrefix}:css`,
    label: 'css',
    kind: 'cssDir',
    data: { kind: 'cssDir', path: dirPath, cssFiles: [...files], label: 'css' },
    children: files.map((f) => ({
      id: `${idPrefix}:css:${f}`,
      label: f,
      kind: 'cssFile' as const,
      data: { kind: 'cssFile' as const, path: `${dirPath}/${f}`, label: f },
    })),
  }
}

function versionNode(brand: string, cat: Cat, fam: string, v: any): TreeNode {
  const famPath = `${brand}/${cat}/${fam}`
  const verPath = v.dir ? `${famPath}/${v.dir}` : famPath
  const verCss = (v.css as string[]).filter((c) => c.startsWith('css/')).map((c) => c.slice(4))
  return {
    id: `ver:${brand}:${cat}:${fam}:${v.dir || 'default'}`,
    label: v.dir || 'default',
    kind: 'version',
    data: {
      kind: 'version',
      path: verPath,
      brandCode: brand,
      cat,
      familyCode: fam,
      versionDir: v.dir ?? '',
      metaPath: `${verPath}/meta.yaml`,
      sourcePath: v.sourcePath,
      samplePath: `${verPath}/sample.yaml`,
    },
    children: [cssDirNode(verPath, verCss, `ver:${brand}:${cat}:${fam}:${v.dir || 'default'}`)],
  }
}

function familyNode(brand: string, cat: Cat, f: any): TreeNode {
  const famPath = `${brand}/${cat}/${f.code}`
  const id = `fam:${brand}:${cat}:${f.code}`
  return {
    id,
    label: f.meta.name ?? f.code,
    kind: 'family',
    data: { kind: 'family', path: famPath, brandCode: brand, cat, familyCode: f.code, metaPath: `${famPath}/meta.yaml` },
    children: [
      cssDirNode(famPath, f.css ?? [], id),
      ...((f.versions as any[]) ?? []).map((v) => versionNode(brand, cat, f.code, v)),
    ],
  }
}

function brandNode(b: any): TreeNode {
  const id = `brand:${b.code}`
  const catNode = (cat: Cat, label: string, cssFiles: string[], families: any[]): TreeNode => {
    const cid = `cat:${b.code}:${cat}`
    return {
      id: cid,
      label,
      kind: 'category',
      data: { kind: 'category', path: `${b.code}/${cat}`, brandCode: b.code, cat, label },
      children: [cssDirNode(`${b.code}/${cat}`, cssFiles, cid), ...families.map((f) => familyNode(b.code, cat, f))],
    }
  }
  return {
    id,
    label: `${b.meta.name}（${b.code}）`,
    kind: 'brand',
    data: { kind: 'brand', path: b.code, brandCode: b.code, metaPath: `${b.code}/meta.yaml` },
    children: [
      cssDirNode(b.code, b.css ?? [], id),
      catNode('fragment', '片段', b.fragmentCss ?? [], b.fragments ?? []),
      catNode('template', '模板', b.templateCss ?? [], b.templates ?? []),
    ],
  }
}

const tree = computed<TreeNode[]>(() => [
  {
    id: 'edm',
    label: 'EDM',
    kind: 'root',
    data: { kind: 'root', path: '', label: 'EDM' },
    children: [cssDirNode('', model.value.topCss ?? [], 'edm'), ...model.value.brands.map((b) => brandNode(b))],
  },
])

const stats = computed(() => {
  const brands = model.value.brands
  return {
    brands: brands.length,
    fragments: brands.reduce((n, b) => n + (b.fragments?.length ?? 0), 0),
    templates: brands.reduce((n, b) => n + (b.templates?.length ?? 0), 0),
  }
})

/** 全部 css 目录（css 另存为目标下拉） */
const allCssDirs = computed<{ path: string; label: string }[]>(() => {
  const out: { path: string; label: string }[] = []
  const walk = (nodes: TreeNode[]): void => {
    for (const n of nodes) {
      if (n.kind === 'cssDir') out.push({ path: n.data.path, label: n.data.path })
      if (n.children) walk(n.children)
    }
  }
  walk(tree.value)
  return out
})

/* ── 基础 IO ── */
async function read(file: string): Promise<string> {
  const r = (await api('system:readFile', { file })) as string | null
  return r ?? ''
}
async function existsIn(file: string): Promise<boolean> {
  return ((await api('system:readFile', { file })) as string | null) !== null
}
async function write(file: string, content: string): Promise<void> {
  await api('system:writeFile', { file, content })
}
function basename(p: string): string {
  return p.split('/').pop() ?? p
}
function splitList(s: string | undefined): string[] {
  return (s ?? '').split(/[,，、]+/).map((x) => x.trim()).filter(Boolean)
}

let treeRef: { setCurrentKey: (key: string) => void } | null = null
function setTreeRef(el: unknown): void {
  treeRef = el as { setCurrentKey: (key: string) => void } | null
}

async function load(silent = false): Promise<void> {
  if (!silent) loading.value = true
  try {
    model.value = (await api('system:load')) as typeof model.value
    const prevId = selected.value?.id
    await nextTick()
    if (prevId) treeRef?.setCurrentKey(prevId)
  } catch (err) {
    ElMessage.error((err as Error).message)
  } finally {
    loading.value = false
  }
}

/* ── 右侧详情：元数据（表单↔数据，R17） / 示例 / njk / 预览 ── */
const metaRaw = ref<Record<string, unknown> | null>(null)
const metaMode = ref<'form' | 'data'>('form')
const metaText = ref('')
const sourceText = ref('')
const sampleText = ref('')
const previewHtml = ref('')
const previewing = ref(false)
const form = ref({
  name: '', code: '', description: '', logo: '', type: '',
  version: 1, changelog: '', policyB: '', policyW: '',
})

const showForm = computed(() => ({
  brandBase: selected.value?.kind === 'brand' || selected.value?.kind === 'family',
  policy: selected.value?.kind === 'family' && selected.value?.data.cat === 'fragment',
  version: selected.value?.kind === 'version',
}))

async function renderPreview(node: TreeNode): Promise<void> {
  if (node.kind !== 'version') return
  previewing.value = true
  try {
    const res = (await api('system:render', {
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
  previewHtml.value = ''
  if (node.data.metaPath) {
    metaText.value = await read(node.data.metaPath)
    try {
      metaRaw.value = (yaml.load(metaText.value) as Record<string, unknown>) ?? {}
      fillForm(metaRaw.value)
    } catch {
      metaRaw.value = null
      metaMode.value = 'data'
    }
  }
  if (node.kind === 'version') {
    sourceText.value = await read(node.data.sourcePath ?? '')
    sampleText.value = await read(node.data.samplePath ?? '')
    await renderPreview(node)
  }
}

function syncFormToRaw(): Record<string, unknown> {
  const patch: Record<string, unknown> = {}
  const s = showForm.value
  if (s.brandBase || s.version) {
    if (form.value.name !== '') patch.name = form.value.name.trim()
    if (form.value.code !== '') patch.code = form.value.code.trim()
    patch.description = form.value.description.trim() || undefined
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
  if (!node?.data.metaPath) return
  try {
    let out = ''
    if (metaMode.value === 'form') {
      out = yaml.dump(syncFormToRaw(), { lineWidth: -1 })
    } else {
      yaml.load(metaText.value) // 语法校验，非法即抛
      out = metaText.value
    }
    await write(node.data.metaPath, out)
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
    ElMessage.success('源文件已保存')
    await renderPreview(node)
  } catch (err) {
    ElMessage.error(`保存失败：${(err as Error).message}`)
  }
}

async function saveSample(): Promise<void> {
  const node = selected.value
  if (!node?.data.samplePath) return
  try {
    yaml.load(sampleText.value)
  } catch (err) {
    ElMessage.error(`YAML 语法错误：${(err as Error).message}`)
    return
  }
  try {
    await write(node.data.samplePath, sampleText.value)
    ElMessage.success('示例数据已保存')
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
const menuItems = computed<MenuItem[]>(() => {
  if (!canEdit.value || !menu.value) return []
  const k = menu.value.node.kind
  if (k === 'root') return [{ key: 'paste', label: '粘贴' }]
  if (k === 'category') return [{ key: 'rename', label: '重命名' }, { key: 'remove', label: '删除', danger: true }, { key: 'paste', label: '粘贴' }]
  if (k === 'brand' || k === 'family' || k === 'version')
    return [{ key: 'saveAs', label: '另存为' }, { key: 'rename', label: '重命名' }, { key: 'remove', label: '删除', danger: true }, { key: 'paste', label: '粘贴' }]
  if (k === 'cssDir')
    return [
      { key: 'saveAs', label: '另存为' }, { key: 'copy', label: '复制' }, { key: 'paste', label: '粘贴' },
      { key: 'newFile', label: '新建文件' }, { key: 'rename', label: '重命名' }, { key: 'remove', label: '删除', danger: true },
    ]
  return [{ key: 'saveAs', label: '另存为' }, { key: 'copy', label: '复制' }, { key: 'rename', label: '重命名' }, { key: 'remove', label: '删除', danger: true }]
})
function onContextMenu(event: MouseEvent, node: TreeNode): void {
  event.preventDefault()
  if (!canEdit.value) return
  menu.value = { x: event.clientX, y: event.clientY, node }
}
function closeMenu(): void {
  menu.value = null
}
onMounted(async () => {
  document.addEventListener('click', closeMenu)
  document.addEventListener('contextmenu', closeMenu)
  try {
    canEdit.value = ((await api('system:canEdit')) as { canEdit: boolean }).canEdit
  } catch {
    canEdit.value = false
  }
  await load()
})
onUnmounted(() => {
  document.removeEventListener('click', closeMenu)
  document.removeEventListener('contextmenu', closeMenu)
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
async function pasteFileInto(dir: string, name: string, src: string): Promise<void> {
  let finalName = name
  if (await existsIn(dir ? `${dir}/${name}` : name)) {
    const resolved = await resolveConflict(dir, name)
    if (!resolved) return
    finalName = resolved
  }
  await write(dir ? `${dir}/${finalName}` : finalName, await read(src))
}

async function onMenu(key: string): Promise<void> {
  const node = menu.value?.node
  closeMenu()
  if (!node) return
  try {
    if (key === 'copy') {
      clipboard.value =
        node.kind === 'cssDir'
          ? { type: 'cssDir', dirPath: node.data.path, files: node.data.cssFiles ?? [] }
          : { type: 'cssFile', file: node.data.path }
      ElMessage.success('已复制')
      return
    }
    if (key === 'paste') {
      if (!clipboard.value) {
        ElMessage.warning('剪贴板为空，请先复制 css 目录或文件')
        return
      }
      const baseDir = node.kind === 'cssDir' ? node.data.path : node.data.path ? `${node.data.path}/css` : 'css'
      if (clipboard.value.type === 'cssFile') {
        await pasteFileInto(baseDir, basename(clipboard.value.file), clipboard.value.file)
      } else {
        for (const f of clipboard.value.files) await pasteFileInto(baseDir, f, `${clipboard.value.dirPath}/${f}`)
      }
      ElMessage.success('已粘贴')
      await load(true)
      return
    }
    if (key === 'newFile') {
      let name = String((await ElMessageBox.prompt('css 文件名（可省略 .css 后缀）', '新建文件', { inputValue: '' })).value ?? '').trim()
      if (!name) return
      if (!name.endsWith('.css')) name += '.css'
      let finalName = name
      if (await existsIn(`${node.data.path}/${name}`)) {
        const resolved = await resolveConflict(node.data.path, name)
        if (!resolved) return
        finalName = resolved
      }
      await write(`${node.data.path}/${finalName}`, '')
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
      await api('system:rename', { file: node.data.path, newName })
      ElMessage.success('已重命名')
      if (selected.value?.data.path === node.data.path) selected.value = null
      await load(true)
      return
    }
    if (key === 'remove') {
      await ElMessageBox.confirm(`确定删除「${node.label}」？此操作不可恢复。`, '危险操作', { type: 'error', confirmButtonText: '删除', cancelButtonText: '取消' })
      await api('system:remove', { file: node.data.path })
      ElMessage.success('已删除')
      if (selected.value?.data.path.startsWith(node.data.path)) selected.value = null
      dropTabsUnder(node.data.path)
      await load(true)
      return
    }
    if (key === 'saveAs') void openSaveAs(node)
  } catch (err) {
    ElMessage.error((err as Error).message)
  }
}

/* ── 另存为弹框（R14 简化版：一屏） ── */
const saveAsState = ref<{ visible: boolean; node: TreeNode | null; name: string; code: string; target: string; raw: Record<string, unknown> }>({
  visible: false, node: null, name: '', code: '', target: '', raw: {},
})
const saveAsIsEntity = computed(() => ['brand', 'family', 'version'].includes(saveAsState.value.node?.kind ?? ''))
const saveAsIsCssFile = computed(() => saveAsState.value.node?.kind === 'cssFile')
async function openSaveAs(node: TreeNode): Promise<void> {
  let raw: Record<string, unknown> = {}
  if (node.data.metaPath) {
    try {
      raw = (yaml.load(await read(node.data.metaPath)) as Record<string, unknown>) ?? {}
    } catch {
      raw = {}
    }
  }
  saveAsState.value = { visible: true, node, name: `${basename(node.data.path)}-copy`, code: '', target: allCssDirs.value[0]?.path ?? '', raw }
}
async function confirmSaveAs(): Promise<void> {
  const { node, name, code, target, raw } = saveAsState.value
  if (!node) return
  const cleanName = name.trim()
  if (!cleanName) {
    ElMessage.warning('名称必填')
    return
  }
  try {
    if (node.kind === 'brand') {
      const newCode = (code.trim() || cleanName).trim()
      if (await existsIn(`${newCode}/meta.yaml`)) {
        ElMessage.error(`品牌「${newCode}」已存在`)
        return
      }
      await write(`${newCode}/meta.yaml`, yaml.dump({ ...raw, code: newCode, name: cleanName }, { lineWidth: -1 }))
    } else if (node.kind === 'family') {
      const newCode = (code.trim() || cleanName).trim()
      const parent = node.data.path.split('/').slice(0, 2).join('/')
      if (await existsIn(`${parent}/${newCode}/meta.yaml`)) {
        ElMessage.error(`同层已存在「${newCode}」`)
        return
      }
      await write(`${parent}/${newCode}/meta.yaml`, yaml.dump({ ...raw, code: newCode, name: cleanName }, { lineWidth: -1 }))
    } else if (node.kind === 'version') {
      const famPath = node.data.path.split('/').slice(0, 3).join('/')
      const dst = `${famPath}/${cleanName}`
      if (await existsIn(`${dst}/meta.yaml`)) {
        ElMessage.error(`版本目录「${cleanName}」已存在`)
        return
      }
      await write(`${dst}/meta.yaml`, await read(`${node.data.path}/meta.yaml`))
      const sample = await read(node.data.samplePath ?? '')
      if (sample !== '') await write(`${dst}/sample.yaml`, sample)
      const srcBase = basename(node.data.sourcePath ?? '')
      if (srcBase) await write(`${dst}/${srcBase}`, await read(node.data.sourcePath ?? ''))
      const cssChild = node.children?.find((c) => c.kind === 'cssDir')
      for (const f of cssChild?.data.cssFiles ?? []) await write(`${dst}/css/${f}`, await read(`${node.data.path}/css/${f}`))
    } else if (node.kind === 'cssDir') {
      // css 目录另存为 = 目录下文件整体复制到目标 css 目录（目录名恒为 css，不建子目录）
      for (const f of node.data.cssFiles ?? []) await pasteFileInto(target, f, `${node.data.path}/${f}`)
    } else {
      // css 文件另存为 = 目标 css 目录 + 新文件名
      const fileName = cleanName.endsWith('.css') ? cleanName : `${cleanName}.css`
      await pasteFileInto(target, fileName, node.data.path)
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
        系统内容
      </span>
      <div class="head-actions">
        <el-tag :type="canEdit ? 'success' : 'info'" size="small">{{ canEdit ? '可编辑' : '只读' }}</el-tag>
        <el-button size="small" :loading="loading" @click="load()">刷新</el-button>
      </div>
    </div>
    <div class="body">
      <div class="tree-pane">
        <el-tree
          v-if="tree.length"
          :ref="setTreeRef"
          :data="tree"
          node-key="id"
          default-expand-all
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
        <EmptyState v-else description="暂无系统内容" />
      </div>
      <div class="detail-pane">
        <!-- css 文件多 tab 编辑（选中 css 文件时） -->
        <template v-if="selected?.kind === 'cssFile' && cssTabs.length">
          <div class="css-editor">
            <el-tabs v-model="activeCss" type="card" closable @tab-remove="closeCssTab(String($event))">
              <el-tab-pane v-for="t in cssTabs" :key="t.file" :name="t.file" :label="`${basename(t.file)}${t.dirty ? ' ●' : ''}`">
                <div class="editor-toolbar">
                  <el-button size="small" type="primary" @click="saveCss(t)">保存</el-button>
                  <el-button size="small" type="success" plain :disabled="!cssTabs.some((x) => x.dirty)" @click="saveAllCss">保存全部</el-button>
                  <span class="hint">外置 css：渲染时 &lt;link&gt; 引入（就近链，越深优先级越高）</span>
                </div>
                <MonacoEditor
                  v-if="activeTab?.file === t.file"
                  :model-value="t.content"
                  language="css"
                  :read-only="!canEdit"
                  height="calc(100% - 40px)"
                  @update:model-value="(v: string) => onCssEdit(t.file, v)"
                />
              </el-tab-pane>
            </el-tabs>
          </div>
        </template>
        <el-empty v-else-if="!selected" description="选择左侧节点查看 / 编辑" :image-size="80" class="detail-empty" />
        <!-- EDM 根概览 -->
        <div v-else-if="selected.kind === 'root'" class="overview">
          <el-descriptions title="EDM 概览" :column="3" border>
            <el-descriptions-item label="品牌">{{ stats.brands }}</el-descriptions-item>
            <el-descriptions-item label="片段族">{{ stats.fragments }}</el-descriptions-item>
            <el-descriptions-item label="模板族">{{ stats.templates }}</el-descriptions-item>
          </el-descriptions>
          <EmptyState :description="canEdit ? '根节点右键可粘贴 css 目录 / 文件' : '只读模式：浏览与预览'" />
        </div>
        <!-- css 目录：仅展开折叠入口 -->
        <el-empty v-else-if="selected.kind === 'cssDir'" description="点具体 css 文件进行编辑（多 tab 互相参照）；右键可复制 / 粘贴 / 新建文件 / 另存为" :image-size="80" />
        <!-- 类目说明 -->
        <el-empty v-else-if="selected.kind === 'category'" description="类目仅分组导航：右键可 重命名 / 删除 / 粘贴 css；无自身元数据" :image-size="80" />
        <!-- 品牌 / 族 / 版本 -->
        <el-tabs v-else class="detail-tabs">
          <el-tab-pane label="元数据">
            <div class="editor-toolbar">
              <el-radio-group v-model="metaMode" size="small" @change="(m: unknown) => switchMetaMode(m as 'form' | 'data')">
                <el-radio-button value="form">表单</el-radio-button>
                <el-radio-button value="data">数据</el-radio-button>
              </el-radio-group>
              <el-button size="small" type="primary" :disabled="!canEdit" @click="saveMeta">保存</el-button>
            </div>
            <el-form v-if="metaMode === 'form' && (showForm.brandBase || showForm.version)" label-width="90px" class="meta-form">
              <el-form-item label="名称"><el-input v-model="form.name" :disabled="!canEdit" /></el-form-item>
              <el-form-item v-if="showForm.brandBase" label="code"><el-input v-model="form.code" :disabled="!canEdit" /></el-form-item>
              <el-form-item label="描述"><el-input v-model="form.description" type="textarea" :rows="2" :disabled="!canEdit" /></el-form-item>
              <el-form-item v-if="selected?.kind === 'brand'" label="logo"><el-input v-model="form.logo" :disabled="!canEdit" placeholder="图片地址" /></el-form-item>
              <template v-if="showForm.policy">
                <el-form-item label="类型"><el-input v-model="form.type" :disabled="!canEdit" placeholder="如 product / banner" /></el-form-item>
                <el-form-item label="黑名单"><el-input v-model="form.policyB" :disabled="!canEdit" placeholder="逗号分隔，标签内可含空格" /></el-form-item>
                <el-form-item label="白名单"><el-input v-model="form.policyW" :disabled="!canEdit" placeholder="为空 = 本品牌内全部模板可用" /></el-form-item>
              </template>
              <el-form-item v-if="showForm.version" label="版本号"><el-input-number v-model="form.version" :min="1" :disabled="!canEdit" /></el-form-item>
              <el-form-item v-if="showForm.version" label="变更说明"><el-input v-model="form.changelog" type="textarea" :rows="2" :disabled="!canEdit" /></el-form-item>
            </el-form>
            <MonacoEditor v-else :model-value="metaText" language="yaml" :read-only="!canEdit" height="calc(100% - 40px)" @update:model-value="(v: string) => (metaText = v)" />
          </el-tab-pane>
          <el-tab-pane v-if="selected.kind === 'version'" label="示例 sample.yaml">
            <div class="editor-toolbar">
              <el-tag size="small" type="info">表单渲染器（R15）下一版提供，本版直接编辑 YAML</el-tag>
              <el-button size="small" type="primary" :disabled="!canEdit" @click="saveSample">保存</el-button>
            </div>
            <MonacoEditor :model-value="sampleText" language="yaml" :read-only="!canEdit" height="calc(100% - 40px)" @update:model-value="(v: string) => (sampleText = v)" />
          </el-tab-pane>
          <el-tab-pane v-if="selected.kind === 'version'" label="源 njk">
            <div class="editor-toolbar">
              <el-button size="small" type="primary" :disabled="!canEdit" @click="saveSource">保存</el-button>
              <span class="hint">内联 css 可直接写在 njk 的 &lt;style&gt; 内；外置 css 走左树 css 目录</span>
            </div>
            <MonacoEditor :model-value="sourceText" language="njk" :read-only="!canEdit" height="calc(100% - 40px)" @update:model-value="(v: string) => (sourceText = v)" />
          </el-tab-pane>
          <el-tab-pane v-if="selected.kind === 'version'" label="预览">
            <div class="editor-toolbar">
              <el-button size="small" type="success" plain :loading="previewing" @click="renderPreview(selected)">刷新预览</el-button>
            </div>
            <iframe v-if="previewHtml" class="preview" :srcdoc="previewHtml" />
            <el-empty v-else description="无预览" :image-size="60" />
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
    <el-dialog v-model="saveAsState.visible" title="另存为" width="460px" :close-on-click-modal="false">
      <el-form label-width="100px">
        <template v-if="saveAsIsEntity">
          <el-form-item label="新名称"><el-input v-model="saveAsState.name" placeholder="默认带 -copy 后缀" /></el-form-item>
          <el-form-item v-if="saveAsState.node?.kind !== 'version'" label="code（目录名）">
            <el-input v-model="saveAsState.code" placeholder="留空则用新名称" />
          </el-form-item>
          <el-form-item label="保存目标">
            <el-radio-group model-value="system">
              <el-radio value="system">系统内容（新副本）</el-radio>
              <el-radio value="custom" disabled>自定义内容库（下一版开放）</el-radio>
            </el-radio-group>
          </el-form-item>
          <el-form-item v-if="saveAsState.node?.kind === 'version'" label="携带内容">
            <span class="hint">版本内全部文件 + 版本级 css 目录（品牌/族级 css 与元数据不跟）</span>
          </el-form-item>
        </template>
        <template v-else>
          <el-form-item label="目标 css 目录">
            <el-select v-model="saveAsState.target" filterable style="width: 100%">
              <el-option v-for="d in allCssDirs" :key="d.path" :value="d.path" :label="d.label" />
            </el-select>
          </el-form-item>
          <el-form-item v-if="saveAsIsCssFile" label="新文件名"><el-input v-model="saveAsState.name" /></el-form-item>
          <el-form-item v-else label="携带内容"><span class="hint">目录下全部 css 文件（目录名恒为 css，文件名不变，冲突时询问）</span></el-form-item>
        </template>
      </el-form>
      <template #footer>
        <el-button @click="saveAsState.visible = false">取消</el-button>
        <el-button type="primary" @click="confirmSaveAs">确定</el-button>
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
.hint { font-size: 12px; opacity: .6; }
.meta-form { overflow: auto; }
.overview { display: flex; flex-direction: column; gap: 16px; overflow: auto; }
.preview { flex: 1; width: 100%; border: none; background: #fff; border-radius: 4px; }

.ctx-menu { position: fixed; z-index: 3000; min-width: 130px; background: var(--el-bg-color-overlay, #fff); border: 1px solid rgba(128,128,128,.25); border-radius: 6px; box-shadow: 0 4px 16px rgba(0,0,0,.18); padding: 4px; }
.ctx-item { padding: 6px 12px; font-size: 13px; border-radius: 4px; cursor: pointer; color: var(--el-text-color-primary); }
.ctx-item:hover { background: var(--el-fill-color-light, rgba(128,128,128,.12)); }
.ctx-item.danger { color: var(--el-color-danger); }
</style>
