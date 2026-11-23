import { computed, nextTick, ref, watch, type ComputedRef, type Ref, type WritableComputedRef } from 'vue'
import { ElMessage } from 'element-plus'
import type { CascaderInstance } from 'element-plus'
import type { FilePickerLibrary, FilePickerSource, FilePickerTarget } from '../types'
import {
  defaultSourceId,
  displayDirPath,
  loadSettings,
  normalizeDirInput,
  saveSettings,
  sortSourcesByDefault,
  validateDirInput,
} from '../picker-settings'
import type { DirValidation } from '../picker-settings'

/** 页签三态（壳层持有，本 composable 只做持久化写回与重列判断） */
export type PickerTab = 'upload' | 'gallery' | 'selected'

/**
 * 目录/来源选择域（P6-3 自 FilePickerDialog 拆出，搬代码不改行为）：
 * 来源列表 + 桶/目录 target（级联懒加载 + 手输归一化）+ 全局一份持久化（来源/目录/页签，D58）。
 * 壳组件负责编排：open 时 restoreSettings → 设页签 → finishRestore；换源/换目录经事件回调驱动重列。
 */
export interface DirPickerProps {
  open: boolean
  library: FilePickerLibrary
  /** 无已保存设置时的预设桶/目录（打开即定位；已保存的设置优先） */
  defaultTarget?: FilePickerTarget
}

export interface DirPickerDeps {
  /** 页签（壳层状态镜像进来）：持久化写回 + 换源重列判断 */
  tab: Ref<PickerTab>
  /** 级联组件实例（壳层持有并经 ref="cascaderRef" 绑定；本 composable 只读它收面板/取面板 API） */
  cascaderRef: Ref<CascaderInstance | null>
  /** 换源完成（target 已按缓存恢复）：壳清列表/重置分页/按需重列 */
  onSourceChanged(): void
  /** 桶/目录变化（持久化由本 composable 负责）：壳防抖重列 */
  onTargetChanged(): void
}

export interface DirPicker {
  sources: Ref<FilePickerSource[]>
  sourceId: Ref<string>
  target: Ref<FilePickerTarget>
  loadingSources: Ref<boolean>
  /** 设置恢复完成前不写回，避免空状态覆盖已存值 */
  restored: Ref<boolean>
  activeSource: ComputedRef<FilePickerSource | null>
  typeOf: ComputedRef<'cloud' | 'remote' | 'local'>
  showBucket: ComputedRef<boolean>
  /** 目录懒加载失败原因（仍可手输目录） */
  dirError: Ref<string>
  /** 级联面板序号：换源/换桶/上传成功后自增重挂载，清掉已加载的懒加载缓存 */
  dirPanelKey: Ref<number>
  /** 级联自身选中值镜像（仅 @change 驱动）：用于「只选根」回显 / 的 class 判断 */
  dirCascaderPicked: Ref<string | null>
  cascaderProps: {
    lazy: boolean
    checkStrictly: boolean
    emitPath: boolean
    lazyLoad(node: { level: number; value?: string | number | null }, resolve: (nodes: unknown[]) => void): Promise<void>
  }
  /** 目录统一完整路径（云前缀 / 远程路径 / 本地目录），支持级联选择与手输 */
  dirModel: WritableComputedRef<string>
  dirManualFocused: Ref<boolean>
  dirManualDisplay: WritableComputedRef<string>
  commitDirInput(): void
  onDirChange(v: string | null): void
  /** 作用域用归一化目录：同一目录的不同写法不应被视为不同位置（影响去重与选择池） */
  scopeDir: ComputedRef<string>
  dirValidation: ComputedRef<DirValidation>
  /** 当前来源+桶+目录的作用域串，构造条目时固化进 pool key */
  currentScope: ComputedRef<string>
  targetForDir(dir: string): FilePickerTarget
  /** 打开会话第一阶段：读来源 + 恢复持久化设置（期间 restored=false，watcher 全部被挡）；返回已保存页签（无则 undefined，由壳落 initialTab） */
  restoreSettings(): Promise<PickerTab | undefined>
  /** 打开会话第二阶段：等 DOM 一拍后再放行写回（与原实现逐行对齐） */
  finishRestore(): Promise<void>
}

/** EP cascader-panel 实例的最小类型面（expose 的 Ref 运行时已解包，按实际形态取用） */
interface CascaderPanelApi {
  getFlattedNodes(leafOnly: boolean): { value: unknown }[]
  handleCheckChange(node: { value: unknown }, checked: boolean, emitClose?: boolean): void
}

function storage(): Storage | null {
  try { return window.localStorage } catch { return null }
}

export function useDirPicker(props: DirPickerProps, deps: DirPickerDeps): DirPicker {
  const sources = ref<FilePickerSource[]>([])
  const sourceId = ref('')
  const target = ref<FilePickerTarget>({})
  const loadingSources = ref(false)
  /** 设置恢复完成前不写回，避免空状态覆盖已存值 */
  const restored = ref(false)

  const dirError = ref('')
  /** 级联面板序号：换源/换桶/上传成功后自增重挂载，清掉已加载的懒加载缓存 */
  const dirPanelKey = ref(0)
  /** 级联自身选中值镜像（仅 @change 驱动）：用于「只选根」回显 / 的 class 判断。
   *  三态：null=从未经级联选择（不补显 /）；''=只选了根；其他=选了子目录。
   *  不直接判 dirModel——它和手输框共享，用户手输不该影响级联框显示 */
  const dirCascaderPicked = ref<string | null>(null)
  /** 面板交互代次：用户显式选择或面板重挂时自增，作废在途的「空目录自动选中」，防止覆盖用户新选择 */
  const dirPanelGen = ref(0)
  watch(dirPanelKey, () => {
    dirPanelGen.value++
    // 目录为空 = 根目录：保持根选中态补显 /（用户 2026-11-19 反馈：初次打开默认选中根目录）
    dirCascaderPicked.value = dirModel.value ? null : ''
  })
  const cascaderRef = deps.cascaderRef

  const activeSource = computed(() => sources.value.find((s) => s.id === sourceId.value) ?? null)
  const typeOf = computed(() => activeSource.value?.type ?? 'cloud')
  const showBucket = computed(() => typeOf.value === 'cloud')
  /** 目录（云前缀 / 远程路径 / 本地目录）统一完整路径字符串，支持级联选择与手输 */
  const dirModel = computed({
    get: () => target.value.prefix || target.value.remotePath || target.value.localDir || '',
    set: (v: string) => {
      // 手输过程中保持原样（逐字输入 a/ 会被立刻归一化成 a，打断输入）；在 @change/blur 时再归一化
      if (typeOf.value === 'cloud') target.value = { ...target.value, prefix: v }
      else if (typeOf.value === 'remote') target.value = { ...target.value, remotePath: v }
      else target.value = { ...target.value, localDir: v }
    },
  })

  /**
   * 手输目录提交时归一化（本地文件系统路径只 trim，保留 /..、盘符等语义）。
   */
  function commitDirInput(): void {
    const raw = dirModel.value
    const normalized = typeOf.value === 'local' ? String(raw ?? '').trim() : normalizeDirInput(raw)
    dirModel.value = normalized
  }

  /**
   * 手输框的显示镜像：非编辑态补前导 / 与级联回显一致（/bt_backup），编辑时还原内部原值，
   * 避免光标跳动、无法删改前导 /。写回仍落 dirModel（桶根相对路径），上传/作用域/校验口径不变。
   */
  const dirManualFocused = ref(false)
  const dirManualDisplay = computed({
    get: () => (dirManualFocused.value || typeOf.value === 'local' ? dirModel.value : displayDirPath(dirModel.value, typeOf.value)),
    set: (v: string) => { dirModel.value = v },
  })

  /** 恢复持久化设置后归一化目录写法（旧数据可能带首尾斜杠），保持作用域口径一致 */
  function normalizeRestoredDir(): void {
    const raw = dirModel.value
    if (!raw) return
    const normalized = typeOf.value === 'local' ? String(raw).trim() : normalizeDirInput(raw)
    if (normalized === raw) return
    if (typeOf.value === 'cloud') target.value = { ...target.value, prefix: normalized }
    else if (typeOf.value === 'remote') target.value = { ...target.value, remotePath: normalized }
    else target.value = { ...target.value, localDir: normalized }
  }
  /** 作用域用归一化目录：同一目录的不同写法不应被视为不同位置（影响去重与选择池） */
  const scopeDir = computed(() => (typeOf.value === 'local' ? dirModel.value.trim() : normalizeDirInput(dirModel.value)))
  /** 手输目录实时校验提示（不阻断输入；error 仅提示，仍允许保存后由 Provider 兜底） */
  const dirValidation = computed<DirValidation>(() => validateDirInput(dirModel.value, typeOf.value))
  /** 当前来源+桶+目录的作用域串，构造条目时固化进 pool key */
  const currentScope = computed(() => [sourceId.value, target.value.bucket ?? '', scopeDir.value].join('|'))

  /** ── 目录级联懒加载：展开某级时才列该级子目录（三种源统一），Provider 返回该源语义下的完整路径 ── */
  function targetForDir(dir: string): FilePickerTarget {
    if (typeOf.value === 'cloud') return { ...target.value, prefix: dir }
    if (typeOf.value === 'remote') return { ...target.value, remotePath: dir }
    return { ...target.value, localDir: dir }
  }

  const cascaderProps = {
    /** 逐级懒加载：点文字下钻（触发 lazyLoad），圈单选（checkStrictly）选中即回显 */
    lazy: true,
    checkStrictly: true,
    emitPath: false,
    lazyLoad: async (node: { level: number; value?: string | number | null }, resolve: (nodes: unknown[]) => void) => {
      // 打开瞬间的挂载竞态：cascader 挂载早于 open 初始化流程（sources 还没拉到、激活源为空），
      // EP 会在挂载时立刻触发根节点懒加载；此时若 resolve([]) 会把根节点钉死成已加载空态，
      // 之后展开不再重新拉取（2026-11-17 用户反馈「必须切一次源才能拉出目录」）。
      // 等初始化完成（或弹框已关）再继续；等待期间 EP 自带 loading 态。
      if (!activeSource.value && props.open && !restored.value) {
        await new Promise<void>((done) => {
          const stop = watch(
            [restored, () => props.open],
            () => {
              if (restored.value || !props.open) {
                stop()
                done()
              }
            },
            { flush: 'post' },
          )
        })
      }
      // 根目录规则（2026-11-19 定版，与文件管理页目录级联一致）：
      // 根 label 置 '' + 级联 separator="/" → 回显 /a/b/c（根 label 为 '/' 会拼出 //a/b 双斜杠）；
      // 面板首列根节点的 "/" 由非 scoped CSS 伪元素补显示（fp-dir-cascader-popper）
      if (node.level === 0) { resolve([{ value: '', label: '' }]); return } // 根目录独立首级（value '' = 三种源的根语义）
      const source = activeSource.value
      if (!source || !props.library.listDirectories) {
        resolve([])
        return
      }
      const parent = String(node.value ?? '')
      // 捕获交互代次与已选值：在途期间用户另做选择/面板重挂则放弃自动选中；值已选中说明是回显同步加载
      const gen = dirPanelGen.value
      const echoing = dirModel.value === parent
      try {
        const children = await props.library.listDirectories(source, targetForDir(parent))
        dirError.value = ''
        // 不写 leaf 字段：EP 在「已加载且无子数据」时自动推断叶子；显式 leaf:false 会把节点永久钉死为
        // 非叶子（isLeaf 直接取 data.leaf，不再走推断），导致空目录不被标记为叶子、点文字永远不能选中
        resolve(
          children.map((seg) => {
            // label 取末段（兼容 Windows 本地绝对路径的反斜杠）；value 保持完整路径供 dirModel 语义
            const last = seg.slice(Math.max(seg.lastIndexOf('/'), seg.lastIndexOf('\\')) + 1) || seg
            return { value: seg, label: last }
          }),
        )
        // 点文字下钻发现该级无子目录：视为叶子，第一次点击即按选中走（回显+关闭），不让用户点两次（2026-11-17）
        if (node.level > 0 && children.length === 0 && !echoing && gen === dirPanelGen.value) {
          const panel = (cascaderRef.value as unknown as { cascaderPanelRef?: CascaderPanelApi } | null)?.cascaderPanelRef
          const targetNode = panel?.getFlattedNodes(false).find((n) => String(n.value) === parent)
          if (panel && targetNode) panel.handleCheckChange(targetNode, true, false)
        }
      } catch (err) {
        dirError.value = (err as Error)?.message || String(err)
        resolve([])
      }
    },
  }

  /** 点单选圈选中：回显 + 关闭面板（checkStrictly 下 EP 不会自动收起）；点文字由 EP 下钻 */
  function onDirChange(v: string | null): void {
    dirPanelGen.value++
    dirCascaderPicked.value = String(v ?? '') // 镜像级联自身选中值：只选根（''）时靠它判 is-root-selected 补显 /
    cascaderRef.value?.togglePopperVisible(false)
    dirModel.value = v ?? ''
  }

  /** 来源内只做缓存镜像（sourceId → target）；真正持久化在 localStorage 全局键（D58） */
  const targetCache: Record<string, FilePickerTarget> = {}

  function persist(): void {
    if (!restored.value) return
    saveSettings(storage(), undefined, {
      sourceId: sourceId.value,
      targets: { ...targetCache, [sourceId.value]: { ...target.value } },
      tab: deps.tab.value,
    })
    targetCache[sourceId.value] = { ...target.value }
  }

  async function loadSources(): Promise<void> {
    loadingSources.value = true
    try {
      const list = await props.library.sources()
      sources.value = sortSourcesByDefault(list)
    } catch (err) {
      ElMessage.error(`读取来源失败：${(err as Error).message}`)
    } finally {
      loadingSources.value = false
    }
  }

  watch(sourceId, (id) => {
    if (!restored.value) return
    target.value = {
      ...(props.defaultTarget ?? {}),
      ...(targetCache[id] ?? {}),
    }
    normalizeRestoredDir()
    // 换源后无已存目录时同样默认根选中（与首次打开口径一致）
    if (!dirModel.value) dirCascaderPicked.value = ''
    dirError.value = ''
    dirPanelKey.value++ // 换源重挂级联：清掉上一来源的懒加载缓存
    persist()
    deps.onSourceChanged()
  })

  /** 页签变化：只持久化（原 watch(tab) 的分页重置/重列在壳层） */
  watch(deps.tab, () => { persist() })
  /** 列表页改桶/目录后自动重列（防抖在壳层；这里只负责持久化 + 通知） */
  watch(target, () => {
    persist()
    deps.onTargetChanged()
  }, { deep: true })
  /** 换桶：根目录列取随桶变化，重挂级联清缓存（目录手输不触发——只动 prefix/remotePath/localDir） */
  watch(() => target.value.bucket, () => {
    dirError.value = ''
    dirPanelKey.value++
  })

  async function restoreSettings(): Promise<PickerTab | undefined> {
    restored.value = false
    await loadSources()
    const saved = loadSettings(storage())
    Object.keys(targetCache).forEach((k) => delete targetCache[k])
    Object.assign(targetCache, saved?.targets ?? {})
    sourceId.value = defaultSourceId(sources.value, saved?.sourceId)
    // 已保存设置优先；没有时回落到应用方预设的桶/目录（defaultTarget）
    target.value = {
      ...(props.defaultTarget ?? {}),
      ...(targetCache[sourceId.value] ?? {}),
    }
    normalizeRestoredDir()
    // 初次打开无已存目录时默认选中根目录（用户 2026-11-19 反馈）：
    // dirModel 空 = 根语义，补 is-root-selected class 让级联输入框回显「/」
    if (!dirModel.value) dirCascaderPicked.value = ''
    return saved?.tab
  }

  async function finishRestore(): Promise<void> {
    // 设置恢复后再打开写回监听，防止空值落盘覆盖
    await nextTick()
    restored.value = true
  }

  return {
    sources, sourceId, target, loadingSources, restored,
    activeSource, typeOf, showBucket,
    dirError, dirPanelKey, dirCascaderPicked, cascaderProps,
    dirModel, dirManualFocused, dirManualDisplay, commitDirInput, onDirChange,
    scopeDir, dirValidation, currentScope, targetForDir,
    restoreSettings, finishRestore,
  }
}
