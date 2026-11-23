import { computed, ref, type ComputedRef, type Ref } from 'vue'
import { ElMessage } from 'element-plus'
import * as yaml from 'js-yaml'
import { api } from '../tool-api'
import type { Source, TreeNode } from './useContentTree'

/**
 * 另存为域（P6-4 自 ContentManagePage 拆出，搬代码不改行为）：
 * R24 另存为（origin = 目标根 source；系统根受 dev 门控）；system→custom 走 system:derive 派生，
 * 其余（同根副本 / 自定义→系统）逐文件拷贝；弹框模板见 SaveAsDialog.vue。
 */
/** system:derive 返回的派生计数 */
export interface DeriveCounts {
  brands: number
  fragments: number
  fragmentVersions: number
  templates: number
  templateVersions: number
}

export interface SaveAsState {
  visible: boolean
  node: TreeNode | null
  name: string
  code: string
  target: string
  origin: Source
  raw: Record<string, unknown>
}

export interface SaveAsDeps {
  canEditSystem: Ref<boolean>
  load(silent?: boolean): Promise<void>
  read(file: string, source?: Source): Promise<string>
  write(file: string, content: string, source?: Source): Promise<void>
  existsIn(file: string, source?: Source): Promise<boolean>
  basename(p: string): string
  splitPath(p: string): string[]
  /** 全部 css 目录（css 另存为目标下拉；携带 source 以便定位根） */
  allCssDirs: ComputedRef<{ path: string; label: string; source: Source }[]>
  /** 双顶层树（目标位置下拉构造） */
  tree: ComputedRef<TreeNode[]>
  pasteFileInto(dir: string, name: string, src: string, dest: Source, srcSource: Source): Promise<void>
}

export interface SaveAs {
  saveAsState: Ref<SaveAsState>
  saveAsIsEntity: ComputedRef<boolean>
  saveAsIsCssFile: ComputedRef<boolean>
  /** 另存为目标位置（按类型过滤：片段→片段类目/族，模板→模板类目/族；仅列目标根，避免跨根错位），#5 */
  saveAsTargetOptions: ComputedRef<{ path: string; label: string }[]>
  openSaveAs(node: TreeNode): Promise<void>
  confirmSaveAs(): Promise<void>
}

export function useSaveAs(deps: SaveAsDeps): SaveAs {
  const saveAsState = ref<SaveAsState>({
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
    walk(deps.tree.value)
    return out
  })

  async function openSaveAs(node: TreeNode): Promise<void> {
    let raw: Record<string, unknown> = {}
    if (node.data.metaPath) {
      try {
        raw = (yaml.load(await deps.read(node.data.metaPath, node.data.source)) as Record<string, unknown>) ?? {}
      } catch {
        raw = {}
      }
    }
    const isEntity = ['brand', 'family', 'version'].includes(node.kind)
    // 默认目标根=同源（同根副本），用户可切到另一根
    const origin: Source = node.data.source
    saveAsState.value = { visible: true, node, name: `${deps.basename(node.data.path)}-copy`, code: '', target: '', origin, raw }
    // 默认目标落点：实体按类型过滤后的首个候选（目标根内）；css 取目标根首个 css 目录（#1/#5）
    const opts = saveAsTargetOptions.value
    saveAsState.value.target = isEntity
      ? (opts[0]?.path ?? deps.splitPath(node.data.path).slice(0, node.kind === 'version' ? 3 : 2).join('/'))
      : (deps.allCssDirs.value.find((d) => d.source === origin)?.path ?? '')
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
    if (origin === 'system' && !deps.canEditSystem.value) {
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
        await deps.load(true)
        return
      }
      // 其余（同根副本 / 自定义→系统）：源 root 读、目标 root 写，逐文件拷贝
      if (node.kind === 'brand') {
        const newCode = (code.trim() || cleanName).trim()
        if (await deps.existsIn(`${newCode}/meta.yaml`, origin)) {
          ElMessage.error(`品牌「${newCode}」已存在`)
          return
        }
        await deps.write(`${newCode}/meta.yaml`, yaml.dump({ ...raw, code: newCode, name: cleanName }, { lineWidth: -1 }), origin)
      } else if (node.kind === 'family') {
        const newCode = (code.trim() || cleanName).trim()
        const parent = saveAsState.value.target || deps.splitPath(node.data.path).slice(0, 2).join('/')
        if (await deps.existsIn(`${parent}/${newCode}/meta.yaml`, origin)) {
          ElMessage.error(`同层已存在「${newCode}」`)
          return
        }
        await deps.write(`${parent}/${newCode}/meta.yaml`, yaml.dump({ ...raw, code: newCode, name: cleanName }, { lineWidth: -1 }), origin)
      } else if (node.kind === 'version') {
        const famPath = saveAsState.value.target || deps.splitPath(node.data.path).slice(0, 3).join('/')
        const dst = `${famPath}/${cleanName}`
        if (await deps.existsIn(`${dst}/meta.yaml`, origin)) {
          ElMessage.error(`版本目录「${cleanName}」已存在`)
          return
        }
        // 复用该版本的全部文件 + css 目录（递归列出，含 css/ 子目录与任意附加文件），到新位置后稍作修改即可成型
        const files = (await api<string[]>('content:listDir', { source: fromSource, dir: node.data.path })) ?? []
        for (const rel of files) {
          const content = await deps.read(`${node.data.path}/${rel}`, fromSource)
          if (content === null) continue
          await deps.write(`${dst}/${rel}`, content, origin)
        }
      } else if (node.kind === 'cssDir') {
        // css 目录另存为 = 目录下文件整体复制到目标 css 目录（目录名恒为 css，不建子目录）
        for (const f of node.data.cssFiles ?? []) await deps.pasteFileInto(target, f, `${node.data.path}/${f}`, origin, fromSource)
      } else {
        // css 文件另存为 = 目标 css 目录 + 新文件名
        const fileName = cleanName.endsWith('.css') ? cleanName : `${cleanName}.css`
        await deps.pasteFileInto(target, fileName, node.data.path, origin, fromSource)
      }
      saveAsState.value.visible = false
      ElMessage.success('另存为完成')
      await deps.load(true)
    } catch (err) {
      ElMessage.error(`另存为失败：${(err as Error).message}`)
    }
  }

  return { saveAsState, saveAsIsEntity, saveAsIsCssFile, saveAsTargetOptions, openSaveAs, confirmSaveAs }
}
