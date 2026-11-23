import { computed, nextTick, ref, type ComputedRef, type Ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { api } from '../tool-api'

/**
 * 内容树域（P6-4 自 ContentManagePage 拆出，搬代码不改行为）：
 * - 双顶层树构造（R24：自定义/系统自带，每个节点携带 source，决定读写根与编辑门控）
 * - 基础 IO（按 source 路由到 content:*）与目录/文件小工具（basename/版本号推算/合法性校验）
 * - load（content:load 双根拉取 + 选中恢复 + 默认展开）与概览统计/全部 css 目录清单
 * - 复制/粘贴与同名冲突抉择（覆盖/自动改名保留两者）——右键菜单与另存为共用
 */
export type Cat = 'fragment' | 'template'
export type NodeKind = 'root' | 'brand' | 'category' | 'family' | 'version' | 'cssDir' | 'cssFile'
/** R24：内容来源——决定读写根与编辑门控；系统自带=文件域(受 dev/developerMode 门控)，自定义=自定义文件根(恒可写) */
export type Source = 'system' | 'custom'

export interface NodeData {
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
export interface TreeNode {
  id: string
  label: string
  kind: NodeKind
  data: NodeData
  children?: TreeNode[]
}

export interface ContentTreeDeps {
  /** load 完成后的后台回调（组合预览预读族 meta，不阻塞） */
  onLoaded?(): void
}

export interface ContentTree {
  sysModel: Ref<{ topCss: string[]; brands: any[] }>
  cusModel: Ref<{ topCss: string[]; brands: any[] }>
  /** 系统自带可编辑门控（dev / 打包版 developerMode）；自定义恒可写 */
  canEditSystem: Ref<boolean>
  /** R24：编辑权 = 节点 source==='custom' 或系统门控通过；未选节点默认放开（按钮另有选中守卫） */
  canEdit: ComputedRef<boolean>
  loading: Ref<boolean>
  selected: Ref<TreeNode | null>
  tree: ComputedRef<TreeNode[]>
  /** R24 收尾：默认展开到「模板 / 片段」类目层——根 → 品牌 → 类目；族 / 版本 / css 目录保持折叠 */
  defaultExpandedKeys: ComputedRef<string[]>
  /** el-tree 的 default-expanded-keys 仅在首次渲染生效；等 content:load 数据就绪后再挂载树 */
  treeReady: Ref<boolean>
  stats: ComputedRef<{ brands: number; fragments: number; templates: number }>
  /** 全部 css 目录（css 另存为目标下拉；携带 source 以便定位根） */
  allCssDirs: ComputedRef<{ path: string; label: string; source: Source }[]>
  setTreeRef(el: unknown): void
  load(silent?: boolean): Promise<void>
  read(file: string, source?: Source): Promise<string>
  existsIn(file: string, source?: Source): Promise<boolean>
  write(file: string, content: string, source?: Source): Promise<void>
  splitPath(p: string): string[]
  basename(p: string): string
  splitList(s: string | undefined): string[]
  parseVersion(dir: string): number
  /** R24：取某族当前最大版本号 +1（基于内存树，已加载） */
  nextVersionOf(famPath: string, source: Source): number
  /** 代码合法性（目录名）：字母数字下划线连字符 */
  validCode(code: string): boolean
  promptCodeAndName(title: string, codeHint: string, nameDefault: string): Promise<{ code: string; name: string } | null>
  /** 唯一名：重名追加 -N 序号 */
  uniqueName(dir: string, name: string): Promise<string>
  /** 冲突抉择：覆盖（原名）/ 自动改名保留两者（唯一名）/ 关闭 = 放弃 */
  resolveConflict(dir: string, name: string): Promise<string | null>
  pasteFileInto(dir: string, name: string, src: string, dest: Source, srcSource: Source): Promise<void>
}

/* ── 图标（与宿主 SidebarMenu 同一视觉语言，铁律 #19） ── */
type IconKind = 'root' | 'brand' | 'fragment' | 'template' | 'version' | 'cssDir' | 'cssFile'
export const NODE_ICON: Record<IconKind, { path: string; color: string }> = {
  root: { path: 'M12 2L2 7v10l10 5 10-5V7z', color: '#909399' },
  brand: { path: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z', color: '#409eff' },
  fragment: { path: 'M4 4h7v7H4zM13 11h7v7h-7zM4 13h7v7H4zM13 4h4v4h4', color: '#67c23a' },
  template: { path: 'M4 5h16v14H4zM4 9h16M9 9v10', color: '#b882e8' },
  version: { path: 'M12 3a9 9 0 100 18 9 9 0 000-18zM12 7v5l3 3', color: '#e6a23c' },
  cssDir: { path: 'M3 5h6l2 2h10v12H3zM8 13h8M12 10v6', color: '#e6a23c' },
  cssFile: { path: 'M6 2h9l5 5v15H6zM14 2v6h6M9 13h6M9 17h6', color: '#909399' },
}
export function nodeIcon(kind: unknown): { path: string; color: string } {
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

function storagePathSplit(p: string): string[] {
  return p.split(/[/\\]/)
}

export function useContentTree(deps: ContentTreeDeps = {}): ContentTree {
  const sysModel = ref<{ topCss: string[]; brands: any[] }>({ topCss: [], brands: [] })
  const cusModel = ref<{ topCss: string[]; brands: any[] }>({ topCss: [], brands: [] })
  /** 系统自带可编辑门控（dev / 打包版 developerMode）；自定义恒可写 */
  const canEditSystem = ref(false)
  const loading = ref(false)
  const selected = ref<TreeNode | null>(null)
  /** R24：编辑权 = 节点 source==='custom' 或系统门控通过；未选节点默认放开（按钮另有选中守卫） */
  const canEdit = computed<boolean>(() => !selected.value || selected.value.data.source === 'custom' || canEditSystem.value)

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
    return storagePathSplit(p)
  }
  function basename(p: string): string {
    return storagePathSplit(p).pop() ?? p
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
      deps.onLoaded?.() // 组合预览选项用（后台，不阻塞）
    } catch (err) {
      ElMessage.error((err as Error).message)
    } finally {
      treeReady.value = true
      loading.value = false
    }
  }

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
        closeOnClickModal: false,
        closeOnPressEscape: false,
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

  return {
    sysModel, cusModel, canEditSystem, canEdit, loading, selected,
    tree, defaultExpandedKeys, treeReady, stats, allCssDirs,
    setTreeRef, load,
    read, existsIn, write, splitPath, basename, splitList, parseVersion, nextVersionOf, validCode, promptCodeAndName,
    uniqueName, resolveConflict, pasteFileInto,
  }
}
