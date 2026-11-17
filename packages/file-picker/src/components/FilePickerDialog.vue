<script setup lang="ts">
/**
 * 通用文件选择弹框（自 rich-text ImageLibraryDialog 2026-11-17 泛化抽取）：
 * - 模式（=内容类别）：image 图片库 / document 文档库 / code 代码库 / all 文件库（全部文件）；标题/文案/默认 accept 按类别推导，应用方可覆盖
 * - 来源：本地 / 远程 profile / 云 profile；默认云→远程→本地；设置按 stateKey 持久化，多实例隔离
 * - 统一选择池：上传项与已有项共用一份「已选」，跨 tab / 跨目录 / 跨来源累积，确认时一并交付
 * - 上传项并入列表可见（按 url 去重，标「本次上传」）；切页/重列不清空已选
 * - 列表一次拉足（桥接层提高 limit）+ 前端分批渲染 + 懒加载；文件名搜索支持跨页全量扫描
 * - 定制面：accept / allowedExts / maxSize / maxUploads / maxCount / multiple / naming / conflict /
 *   confirmText / initialTab / defaultTarget / resolveSrc / stateKey；确认行为完全交给应用方（@confirm 交付条目，不替应用方拼接）
 */
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import type { CascaderInstance } from 'element-plus'
// 图标约定（2026-11-17）：优先 @element-plus/icons-vue / FontAwesome，均无再用自定义 SVG
import { Close, Delete, Document, Link, Picture } from '@element-plus/icons-vue'
import type {
  FilePickerConflict,
  FilePickerItem,
  FilePickerLibrary,
  FilePickerMode,
  FilePickerNaming,
  FilePickerSource,
  FilePickerTarget,
} from '../types'
import {
  defaultSourceId,
  loadSettings,
  matchFileKeyword,
  normalizeDirInput,
  saveSettings,
  sortSourcesByDefault,
  validateDirInput,
} from '../picker-settings'
import type { DirValidation } from '../picker-settings'
import { FILE_KIND_ACCEPT, FILE_KIND_LABELS, isKindFileName } from '@sshk/shared'
import { fingerprintKey, hashFile, resolveUploadName } from '../upload-dedupe'

const props = withDefaults(
  defineProps<{
    open: boolean
    library: FilePickerLibrary
    /** 内容类别（图片/文档/代码/全部文件）：影响默认标题、页签文案、卡片渲染、默认 accept 与上传类别校验 */
    mode?: FilePickerMode
    /** 文件选择框 accept（如 'image/*'、'.pdf,.docx'、'video/*'）；优先级 accept > allowedExts 推导 > kind 类别默认 */
    accept?: string
    /**
     * 自定义扩展名白名单（如 ['.md', '.pdf']）：非空时**替代** kind 类别白名单，
     * 作为上传拦截（含拖拽）与列表前端过滤的双重强制口径；accept 缺省时由它推导文件选择框过滤。
     */
    allowedExts?: string[]
    /** 是否允许一次确认多个；false 时等价 maxCount=1（新选替换旧选） */
    multiple?: boolean
    /** 最大可选数量；0 / 缺省 = 不限制；=1 时单选替换 */
    maxCount?: number
    /** 本次打开弹框期间累计上传文件数上限（0 / 缺省 = 不限制）；与 maxCount 独立，可分别控制上传量与选择量 */
    maxUploads?: number
    /** 单文件字节上限（组件侧快速拦截；0 / 缺省 = 不限制，真正的校验在 Upload Service 侧） */
    maxSize?: number
    /** 上传存储命名：hash=内容寻址名（默认，现状逻辑）；original=保留原文件名 */
    naming?: FilePickerNaming
    /** original 命名时同名不同内容的处理：hash=追加 -hash8（默认，不覆盖）；overwrite=直接覆盖 */
    conflict?: FilePickerConflict
    /** 确认按钮文案；缺省 image→「插入所选」、其余类别→「确认选择」 */
    confirmText?: string
    /** 弹框标题；缺省按类别：「图片库」「文档库」「代码库」「文件库」 */
    title?: string
    /** 打开时默认页签（无已保存设置时生效） */
    initialTab?: 'upload' | 'gallery' | 'selected'
    /** 无已保存设置时的预设桶/目录（打开即定位；已保存的设置优先） */
    defaultTarget?: FilePickerTarget
    /** 预览 URL 解析钩子（rich-text 传 localres 显示形态转换；其他应用可不传） */
    resolveSrc?: (url: string) => string
    /** 多实例隔离键：不同实例各存各的来源/目录设置 */
    stateKey?: string
  }>(),
  {
    mode: 'image',
    accept: undefined,
    allowedExts: undefined,
    multiple: true,
    maxCount: 0,
    maxUploads: 0,
    maxSize: 0,
    naming: 'hash',
    conflict: 'hash',
    confirmText: undefined,
    title: undefined,
    initialTab: 'upload',
    defaultTarget: undefined,
    resolveSrc: undefined,
    stateKey: 'default',
  },
)

const emit = defineEmits<{
  (e: 'update:open', v: boolean): void
  /** 确认：交付已选条目（url/name/size/key），用途由应用方定义 */
  (e: 'confirm', items: FilePickerItem[]): void
}>()

/** 生效的展示文案与默认值（mode 推导 + props 覆盖） */
const isImage = computed(() => props.mode === 'image')
const kindLabel = computed(() => FILE_KIND_LABELS[props.mode] ?? '文件')
const dialogTitle = computed(() => props.title ?? `${kindLabel.value}库`)
/** 生效扩展名白名单：归一化（去空白/小写/补点），空列表视为未设置返回 null */
const effectiveExts = computed<string[] | null>(() => {
  const list = (props.allowedExts ?? [])
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
    .map((e) => (e.startsWith('.') ? e : `.${e}`))
  return list.length > 0 ? list : null
})
/** 扩展名是否在白名单内；白名单未设置时恒 true，无文件名时按「宁缺勿滥」拒绝 */
function extAllowed(name?: string): boolean {
  if (!effectiveExts.value) return true
  if (!name) return false
  const lower = name.toLowerCase()
  return effectiveExts.value.some((e) => lower.endsWith(e))
}
const acceptAttr = computed(() => props.accept ?? effectiveExts.value?.join(',') ?? FILE_KIND_ACCEPT[props.mode] ?? '')
const confirmLabel = computed(() => props.confirmText ?? (props.mode === 'image' ? '插入所选' : '确认选择'))
/** 上传 input 的多选：跟随 multiple */
const uploadMultiple = computed(() => props.multiple)
/** 生效最大可选数：multiple=false 视为 1（新选替换旧选） */
const effectiveMax = computed(() => (props.multiple ? (props.maxCount || 0) : 1))

/** 一批渲染的文件数：一次拉全但分批挂 DOM，滚动到底再追加 */
const PAGE_SIZE = 48
/** 一次向后端拉取的文件上限（各云 SDK 单页上限 ≥ 500；前端再分批渲染/懒加载） */
const FETCH_LIMIT = 500

const tab = ref<'upload' | 'gallery' | 'selected'>('upload')
const sources = ref<FilePickerSource[]>([])
const sourceId = ref('')
const target = ref<FilePickerTarget>({})
const loadingSources = ref(false)
/** 设置恢复完成前不写回，避免空状态覆盖已存值 */
const restored = ref(false)

const uploading = ref(false)
const uploadInput = ref<HTMLInputElement | null>(null)
/** 拖拽投放高亮态 */
const dropActive = ref(false)
/** 本次上传的文件（未确认前可删除）；列表页也会合并展示 */
interface PoolItem extends FilePickerItem {
  key?: string
  origin: 'upload' | 'existing'
  /** 归属作用域：sourceId|bucket|目录，跨源/桶/目录的同名文件互不串扰 */
  scope: string
}
const uploaded = ref<PoolItem[]>([])
/** 上传任务队列（含进行中/成功/失败），用于总体与单项进度、失败重试/删除 */
interface UploadTask {
  id: number
  file: File
  name: string
  status: 'uploading' | 'success' | 'failed'
  /** 0–100；Provider 无 byte 级上报时由 UI 爬升动画推进到 90，成功置 100，失败停在当时值 */
  percent: number
  error?: string
  url?: string
  /** 本地预览 objectURL（缩略图），卸载/删除时 revoke；文件模式仅用于图片类文件的预览 */
  previewUrl?: string
  /** 缩略图加载失败（CSP 拦截/损坏文件/不支持格式）时改用占位，不显示浏览器裂图 */
  previewFailed?: boolean
  /** 完成时间戳：成功后短暂保留「完成」卡片让用户看到进度结果，到点降级为普通缩略图 */
  doneAt?: number
  size: number
  /** 去重指纹（目标位置 + 源文件名 + 内容 hash / 文件名+大小）；重试沿用同一指纹 */
  fingerprint: string
  /** 实际存储名（按 naming/conflict 策略解析）；UI 显示原名 name，上传用此名，保证重试幂等 */
  uploadName: string
  scope: string
  source: FilePickerSource
  target: FilePickerTarget
}
const uploadTasks = ref<UploadTask[]>([])
let uploadSeq = 0
/** 进行中任务总数（总体进度分母） */
const uploadTotal = computed(() => uploadTasks.value.length)
const uploadDone = computed(() => uploadTasks.value.filter((t) => t.status !== 'uploading').length)
const uploadSucceeded = computed(() => uploadTasks.value.filter((t) => t.status === 'success').length)
const uploadFailed = computed(() => uploadTasks.value.filter((t) => t.status === 'failed').length)
/** 总体进度：已完成任务按 100% 计，进行中按其 percent 计 */
const overallPercent = computed(() => {
  const all = uploadTasks.value
  if (all.length === 0) return 0
  const sum = all.reduce((acc, t) => acc + (t.status === 'success' ? 100 : t.percent), 0)
  return Math.min(100, Math.round(sum / all.length))
})
/** 有活动上传任务时显示总体进度条 */
const uploadInProgress = computed(() => uploadTasks.value.some((t) => t.status === 'uploading'))
/** 成功项完成后在卡片区保留这么久，让用户看清「上传中→100% 完成」的过程（Provider 太快时会一闪而过） */
const DONE_KEEP_MS = 2500
/** 时钟 tick：驱动「完成展示窗口」到期后重渲染（仅窗口内有任务时定时器才运行） */
const nowTick = ref(0)
let doneWindowTimer: ReturnType<typeof setInterval> | null = null
function ensureDoneWindowTimer(): void {
  if (doneWindowTimer) return
  doneWindowTimer = setInterval(() => {
    nowTick.value = Date.now()
    if (!uploadTasks.value.some((t) => t.status === 'success' && t.doneAt && Date.now() - t.doneAt < DONE_KEEP_MS)) {
      clearInterval(doneWindowTimer!)
      doneWindowTimer = null
    }
  }, 300)
}
function stopDoneWindowTimer(): void {
  if (!doneWindowTimer) return
  clearInterval(doneWindowTimer)
  doneWindowTimer = null
}
/** 上传中/失败 + 刚完成仍在展示窗口内的任务：以卡片并入网格，受文件名搜索过滤 */
const activeUploadTasks = computed(() => {
  void nowTick.value // 依赖时钟，窗口到期后重算
  const inWindow = (t: UploadTask): boolean =>
    t.status !== 'success' || Boolean(t.doneAt && Date.now() - t.doneAt < DONE_KEEP_MS)
  return uploadTasks.value.filter(
    (t) => inWindow(t) && (!keyword.value || t.name.toLowerCase().includes(keyword.value.toLowerCase())),
  )
})
/** 列表已列文件 */
const items = ref<FilePickerItem[]>([])
const loadingList = ref(false)
/** 目录懒加载失败原因（仍可手输目录） */
const dirError = ref('')
/** 级联面板序号：换源/换桶/上传成功后自增重挂载，清掉已加载的懒加载缓存 */
const dirPanelKey = ref(0)
/** 面板交互代次：用户显式选择或面板重挂时自增，作废在途的「空目录自动选中」，防止覆盖用户新选择 */
const dirPanelGen = ref(0)
watch(dirPanelKey, () => { dirPanelGen.value++ })
const cascaderRef = ref<CascaderInstance | null>(null)
/** 文件名搜索关键词 */
const keyword = ref('')
/** 已渲染数量（分批渲染） */
const renderedCount = ref(PAGE_SIZE)

/** 统一选择池键：url 唯一标识一个文件。不同源/桶的对象 URL 本身就不同；
 *  上传选中后切列表（同 url）仍保持选中，切目录/源亦然，且计数不重复。 */
const itemKey = (i: { url: string }): string => i.url

/** 统一选择池：跨 tab / 目录 / 源 / 桶累积；scope 只记录来源用于清单展示 */
const pool = ref<Record<string, PoolItem>>({})
const poolList = computed(() => Object.values(pool.value))
const poolCount = computed(() => poolList.value.length)
const uploadPicked = computed(() => poolList.value.filter((i) => i.origin === 'upload').length)
const existingPicked = computed(() => poolList.value.filter((i) => i.origin === 'existing').length)
const isSelected = (item: PoolItem): boolean => Boolean(pool.value[itemKey(item)])
/** 剩余可选数量：不限时为 Infinity */
const capacityLeft = computed(() => (effectiveMax.value > 0 ? effectiveMax.value - poolCount.value : Number.POSITIVE_INFINITY))
function addToPool(item: PoolItem): boolean {
  if (!item.url) return false
  if (pool.value[itemKey(item)]) {
    pool.value[itemKey(item)] = item
    return true
  }
  if (capacityLeft.value <= 0) {
    ElMessage.warning(`最多可选 ${effectiveMax.value} 个`)
    return false
  }
  pool.value[itemKey(item)] = item
  return true
}
function removeFromPool(item: PoolItem): void {
  const k = itemKey(item)
  if (!pool.value[k]) return
  const next = { ...pool.value }
  delete next[k]
  pool.value = next
}
function togglePool(item: PoolItem): void {
  if (isSelected(item)) removeFromPool(item)
  else addToPool(item)
}
/** 按作用域 key 移除（用于跨源清单，item 可能来自已切换的旧源） */
function removePoolKey(k: string): void {
  const next = { ...pool.value }
  delete next[k]
  pool.value = next
}
function clearPool(): void {
  pool.value = {}
}
/** 作用域中文标签，用于「已选择」tab 卡片标注来源 */
function scopeLabel(scope: string): string {
  const [sid = '', bucket = '', dir = ''] = scope.split('|')
  const src = sources.value.find((s) => s.id === sid)
  const base = src?.label ?? sid
  const extra = [bucket, dir].filter(Boolean).join(' / ')
  return extra ? `${base} · ${extra}` : base
}

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

/** EP cascader-panel 实例的最小类型面（expose 的 Ref 运行时已解包，按实际形态取用） */
interface CascaderPanelApi {
  getFlattedNodes(leafOnly: boolean): { value: unknown }[]
  handleCheckChange(node: { value: unknown }, checked: boolean, emitClose?: boolean): void
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
    const source = activeSource.value
    if (!source || !props.library.listDirectories) {
      resolve([])
      return
    }
    const parent = node.level === 0 ? '' : String(node.value ?? '')
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
          const last = seg.slice(seg.lastIndexOf('/') + 1) || seg
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
  cascaderRef.value?.togglePopperVisible(false)
  dirModel.value = v ?? ''
}

/** 列表页可见项：本次上传（含旧源上传的）优先，当前源列文件按作用域+url 去重补充，再按文件名过滤 */
const galleryView = computed<PoolItem[]>(() => {
  const map = new Map<string, PoolItem>()
  for (const u of uploaded.value) map.set(itemKey(u), u)
  const scope = currentScope.value
  for (const it of items.value) {
    // 自定义扩展名白名单时前端同步过滤列取结果（kind 只支持五类，无法表达任意扩展名组合）
    if (!extAllowed(it.name ?? it.key)) continue
    const wrapped: PoolItem = { ...it, origin: 'existing', scope }
    if (!map.has(itemKey(wrapped))) map.set(itemKey(wrapped), wrapped)
  }
  return [...map.values()].filter((i) => matchFileKeyword(i, keyword.value))
})
/** 上传页可见项（同样支持文件名搜索） */
const uploadView = computed<PoolItem[]>(() => {
  // 按 url 去重兜底（上传前已按内容 hash 去重，这里防历史/异常数据重复卡片）
  const map = new Map<string, PoolItem>()
  for (const i of uploaded.value) map.set(itemKey(i), i)
  return [...map.values()].filter((i) => matchFileKeyword(i, keyword.value))
})
/** 已选择 tab：展示统一选择池（跨 tab/源/桶/目录累积），同样支持文件名搜索 */
const selectedView = computed<PoolItem[]>(() => poolList.value.filter((i) => matchFileKeyword(i, keyword.value)))
const visible = computed<PoolItem[]>(() =>
  tab.value === 'upload' ? uploadView.value : tab.value === 'selected' ? selectedView.value : galleryView.value,
)
const rendered = computed<PoolItem[]>(() => {
  // 仍在任务卡片里展示进度的成功项先不在普通缩略图重复渲染，窗口过后自然回归（仅上传 tab 有任务卡片）
  const inTaskCard = new Set(
    tab.value === 'upload'
      ? activeUploadTasks.value.filter((t) => t.status === 'success' && t.url).map((t) => t.url!)
      : [],
  )
  return visible.value.filter((i) => !inTaskCard.has(i.url)).slice(0, renderedCount.value)
})

/** 放大预览源始终取「当前可见全集」（非仅已渲染），可左右翻看；initial-index 用全集下标 */
const previewUrls = computed(() => visible.value.map((i) => resolveSrcOf(i.url)))
function resolveSrcOf(url: string): string {
  return props.resolveSrc ? props.resolveSrc(url) : url
}

/** 上传区主提示（模式推导；模板表达式里不写嵌套模板字符串） */
const uploadHint = computed<string>(() => {
  if (uploading.value) return '上传中…'
  return `点击或拖拽${kindLabel.value}到此处${uploadMultiple.value ? '（可多选）' : ''}`
})

/** 空态文案：按页签与模式推导（模板表达式里不写嵌套模板字符串，vue-tsc 解析不稳） */
const emptyStateText = computed<string>(() => {
  if (tab.value === 'upload') {
    return keyword.value ? '无匹配文件' : `尚未上传；上传后在此预览，不会立即${isImage.value ? '插入正文' : '交付'}`
  }
  if (tab.value === 'selected') {
    if (keyword.value) return '无匹配文件'
    return poolCount.value ? '无匹配文件' : '尚未选择；在「上传」或「从库选择」里勾选，会汇总到这里'
  }
  if (loadingList.value) return '读取中…'
  return keyword.value ? '无匹配文件' : `暂无${kindLabel.value}，点「刷新」或先上传${isImage.value ? '几张' : '几个'}`
})

function storage(): Storage | null {
  try { return window.localStorage } catch { return null }
}

function persist(): void {
  if (!restored.value) return
  saveSettings(storage(), props.stateKey, {
    sourceId: sourceId.value,
    targets: { ...(targetCache[props.stateKey] ?? {}), [sourceId.value]: { ...target.value } },
    tab: tab.value,
  })
  targetCache[props.stateKey] = { ...(targetCache[props.stateKey] ?? {}), [sourceId.value]: { ...target.value } }
}

/** 模块内只做缓存镜像；真正持久化在 localStorage，按 stateKey 隔离 */
const targetCache: Record<string, Record<string, FilePickerTarget>> = {}

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

watch(
  () => props.open,
  async (open) => {
    if (!open) return
    restored.value = false
    // 每次重新打开是新一轮会话：重置上传缓存与选择池
    uploaded.value = []
    for (const t of uploadTasks.value) if (t.previewUrl) URL.revokeObjectURL(t.previewUrl)
    uploadTasks.value = []
    stopProgressTimer()
    stopDoneWindowTimer()
    pool.value = {}
    items.value = []
    keyword.value = ''
    renderedCount.value = PAGE_SIZE
    await loadSources()
    const saved = loadSettings(storage(), props.stateKey)
    targetCache[props.stateKey] = saved?.targets ?? {}
    sourceId.value = defaultSourceId(sources.value, saved?.sourceId)
    // 已保存设置优先；没有时回落到应用方预设的桶/目录（defaultTarget）
    target.value = {
      ...(props.defaultTarget ?? {}),
      ...(targetCache[props.stateKey]?.[sourceId.value] ?? {}),
    }
    normalizeRestoredDir()
    tab.value = saved?.tab ?? props.initialTab ?? 'upload'
    // 设置恢复后再打开写回监听，防止空值落盘覆盖
    await nextTick()
    restored.value = true
    if (tab.value === 'gallery') await loadGallery()
  },
)

let sourceWatchBusy = false
watch(sourceId, async (id) => {
  if (!restored.value || sourceWatchBusy) return
  target.value = {
    ...(props.defaultTarget ?? {}),
    ...(targetCache[props.stateKey]?.[id] ?? {}),
  }
  normalizeRestoredDir()
  items.value = [] // 仅清当前列表；统一选择池保留，跨来源累积
  dirError.value = ''
  dirPanelKey.value++ // 换源重挂级联：清掉上一来源的懒加载缓存
  renderedCount.value = PAGE_SIZE
  persist()
  if (tab.value === 'gallery') await loadGallery()
})

/** 列表页改桶/目录后自动重列（防抖，避免逐字输入时反复请求） */
let galleryReloadTimer: ReturnType<typeof setTimeout> | null = null
function scheduleGalleryReload(): void {
  if (!props.open || !restored.value || tab.value !== 'gallery') return
  if (galleryReloadTimer) clearTimeout(galleryReloadTimer)
  galleryReloadTimer = setTimeout(() => { galleryReloadTimer = null; void loadGallery() }, 300)
}

watch(target, () => {
  persist()
  scheduleGalleryReload()
}, { deep: true })
/** 换桶：根目录列取随桶变化，重挂级联清缓存（目录手输不触发——只动 prefix/remotePath/localDir） */
watch(() => target.value.bucket, () => {
  dirError.value = ''
  dirPanelKey.value++
})
watch(tab, async (v) => {
  persist()
  renderedCount.value = PAGE_SIZE
  if (v === 'gallery' && props.open && restored.value) await loadGallery()
})
watch(keyword, (kw) => {
  renderedCount.value = PAGE_SIZE
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = null
  if (!kw) {
    cancelScan() // 清空关键词：终止扫描，回到分页浏览
    return
  }
  // 仅列表 tab 需要跨页扫描（上传/已选择数据全在内存）；防抖 400ms 避免逐字触发
  if (tab.value !== 'gallery') return
  searchTimer = setTimeout(() => { searchTimer = null; void runSearchScan() }, 400)
})

function close(): void {
  if (galleryReloadTimer) clearTimeout(galleryReloadTimer)
  galleryReloadTimer = null
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = null
  emit('update:open', false)
}

onBeforeUnmount(() => {
  if (galleryReloadTimer) clearTimeout(galleryReloadTimer)
  if (searchTimer) clearTimeout(searchTimer)
  stopProgressTimer()
  stopDoneWindowTimer()
  for (const t of uploadTasks.value) if (t.previewUrl) URL.revokeObjectURL(t.previewUrl)
})

/** 文件扩展名（小写、含点；无扩展名返回空串） */
function extOf(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot).toLowerCase() : ''
}

/** 字节数的简短中文展示（文件卡片用） */
function formatSize(size?: number): string {
  if (!size || size <= 0) return ''
  const units = ['B', 'KB', 'MB', 'GB']
  let v = size
  let u = 0
  while (v >= 1024 && u < units.length - 1) { v /= 1024; u++ }
  return `${v >= 100 ? Math.round(v) : v.toFixed(1)} ${units[u]!}`
}

/** 复制文件完整链接：优先 Clipboard API，失败回退 execCommand（file:// 等非安全上下文） */
async function copyLink(item: PoolItem): Promise<void> {
  const url = item.url
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(url)
      ElMessage.success('链接已复制')
      return
    }
    const ta = document.createElement('textarea')
    ta.value = url
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    document.execCommand('copy')
    document.body.removeChild(ta)
    ElMessage.success('链接已复制')
  } catch {
    ElMessage.error('复制失败，请手动复制')
  }
}

/** 确认：交付已选条目给应用方；弹框只收尾（清池、清上传缓存、关闭），不决定用途 */
function confirmSelected(): void {
  const picked = poolList.value
  if (picked.length === 0) return
  emit('confirm', picked.map((i) => ({ url: i.url, name: i.name, size: i.size, key: i.key, modified: i.modified })))
  pool.value = {}
  uploaded.value = []
  close()
  ElMessage.success(`已选择 ${picked.length} 个文件`)
}

function pickFiles(): void {
  uploadInput.value?.click()
}

async function uploadMore(): Promise<void> {
  if (tab.value !== 'upload') {
    tab.value = 'upload'
    await nextTick()
  }
  pickFiles()
}

/** 进度爬升定时器：Provider 无 byte 级上报，上传中让百分比平滑推进到 90，完成由回调置 100 */
let progressTimer: ReturnType<typeof setInterval> | null = null
function ensureProgressTimer(): void {
  if (progressTimer) return
  progressTimer = setInterval(() => {
    for (const t of uploadTasks.value) {
      if (t.status === 'uploading' && t.percent < 90) t.percent = Math.min(90, t.percent + 3)
    }
  }, 220)
}
function stopProgressTimer(): void {
  if (!progressTimer) return
  clearInterval(progressTimer)
  progressTimer = null
}

/** 执行一次上传任务：更新单项状态/进度，成功后并入 uploaded 与选择池；失败留给 UI 重试/删除 */
async function runUpload(task: UploadTask): Promise<boolean> {
  task.status = 'uploading'
  task.percent = 0
  task.error = undefined
  task.doneAt = undefined
  ensureProgressTimer()
  try {
    // 用策略解析出的存储名上传；重试沿用同一 uploadName 天然幂等。
    // File.name 只读，包一层引用原内容即可（不重复拷贝数据）。UI 仍显示用户选的原名 task.name。
    const uploadFile = new File([task.file], task.uploadName, {
      type: task.file.type,
      lastModified: task.file.lastModified,
    })
    const url = await props.library.upload(uploadFile, task.source, task.target, (p) => {
      if (p.status === 'success') task.percent = 100
    })
    task.url = url
    task.percent = 100
    task.status = 'success'
    task.doneAt = Date.now()
    ensureDoneWindowTimer()
    // 入库项用存储名：与 Provider 列表刷新回来的名字一致，避免刷新前后显示不一致
    const item: PoolItem = { url, key: task.uploadName, name: task.uploadName, origin: 'upload', scope: task.scope, size: task.size }
    uploaded.value.push(item)
    addToPool(item) // 上传即默认选中，可取消
    return true
  } catch (err) {
    task.status = 'failed'
    task.error = (err as Error).message || String(err)
    return false
  }
}

/** 选中的文件统一入口（点击选择与拖拽投放共用）：大小拦截 → 指纹去重 → 入队上传 */
async function handleFiles(files: File[]): Promise<void> {
  const source = activeSource.value
  if (!source || files.length === 0) return
  const scope = currentScope.value

  // 组件侧快速拦截：单文件超 maxSize 直接拒绝（真正的校验在 Upload Service 侧，这里给即时反馈）
  if (props.maxSize > 0) {
    const oversized = files.filter((f) => f.size > props.maxSize!)
    if (oversized.length > 0) {
      ElMessage.error(`以下文件超过大小限制（${formatSize(props.maxSize)}）：${oversized.slice(0, 3).map((f) => f.name).join('、')}${oversized.length > 3 ? ' 等' : ''}`)
      files = files.filter((f) => f.size <= props.maxSize!)
    }
    if (files.length === 0) return
  }

  // 扩展名拦截：allowedExts 非空时替代 kind 类别白名单（自定义口径优先）；否则 image/document/code 按类别白名单
  if (effectiveExts.value) {
    const mismatched = files.filter((f) => !extAllowed(f.name))
    if (mismatched.length > 0) {
      ElMessage.error(`仅允许 ${effectiveExts.value.join('、')} 格式，已跳过：${mismatched.slice(0, 3).map((f) => f.name).join('、')}${mismatched.length > 3 ? ' 等' : ''}`)
      files = files.filter((f) => extAllowed(f.name))
    }
    if (files.length === 0) return
  } else if (props.mode !== 'all') {
    const mismatched = files.filter((f) => !isKindFileName(props.mode, f.name))
    if (mismatched.length > 0) {
      ElMessage.error(`以下文件不属于${kindLabel.value}类，已跳过：${mismatched.slice(0, 3).map((f) => f.name).join('、')}${mismatched.length > 3 ? ' 等' : ''}`)
      files = files.filter((f) => isKindFileName(props.mode, f.name))
    }
    if (files.length === 0) return
  }

  // 上传前去重：目标位置 + 源文件名（带后缀）+ 内容 hash。三者全同才算重复；
  // 同一内容改不同名字视为不同文件，都允许上传。已在传/已成功的不重复上传，失败的可重选。
  const existing = new Set(
    uploadTasks.value.filter((t) => t.status !== 'failed').map((t) => t.fingerprint),
  )
  let fresh: { file: File; fingerprint: string; uploadName: string }[] = []
  let skipped = 0
  for (const file of files) {
    const hash = await hashFile(file)
    const fp = fingerprintKey({ scope, name: file.name, size: file.size, hash })
    if (existing.has(fp)) {
      skipped += 1
      continue
    }
    existing.add(fp) // 同一批内也去重
    fresh.push({ file, fingerprint: fp, uploadName: resolveUploadName(file.name, hash, props.naming, props.conflict) })
  }
  if (skipped > 0) ElMessage.info(`已跳过 ${skipped} 个重复文件（同位置已上传或上传中）`)
  if (fresh.length === 0) return

  // 上传数量拦截：本次打开期间累计额度（进行中+成功，不含失败）；与 maxCount 独立，超出部分不发起上传
  if (props.maxUploads > 0) {
    const used = uploadTasks.value.filter((t) => t.status !== 'failed').length
    const left = props.maxUploads - used
    if (left <= 0) {
      ElMessage.warning(`本次打开最多可上传 ${props.maxUploads} 个文件，额度已用完`)
      return
    }
    if (fresh.length > left) {
      ElMessage.warning(`本次打开最多可上传 ${props.maxUploads} 个文件，剩余额度 ${left} 个，超出部分已跳过`)
      fresh = fresh.slice(0, left)
    }
  }

  for (const { file, fingerprint, uploadName } of fresh) {
    const task: UploadTask = {
      id: ++uploadSeq, file, name: file.name, uploadName, status: 'uploading', percent: 0,
      size: file.size, previewUrl: URL.createObjectURL(file), fingerprint,
      scope, source, target: { ...target.value },
    }
    uploadTasks.value.push(task)
  }
  uploading.value = true
  const results = await Promise.all(uploadTasks.value.filter((t) => t.status === 'uploading').map((t) => runUpload(t)))
  uploading.value = false
  stopProgressTimer()
  const ok = results.filter(Boolean).length
  const failed = results.length - ok
  if (ok > 0) {
    // 上传成功后重挂级联：清掉懒加载缓存，下次展开即可看到新目录
    dirPanelKey.value++
    ElMessage.success(`${ok} 个文件已上传并选中，切到列表页可继续挑选，最后一并确认`)
  }
  if (failed > 0) ElMessage.warning(`${failed} 个文件上传失败，可在上传列表中重试或删除`)
}

async function onFilesChosen(e: Event): Promise<void> {
  const input = e.target as HTMLInputElement
  const files = Array.from(input.files ?? [])
  input.value = ''
  await handleFiles(files)
}

/** 拖拽投放上传：与点击选择走同一入口（dataTransfer.files） */
async function onDrop(e: DragEvent): Promise<void> {
  dropActive.value = false
  const files = Array.from(e.dataTransfer?.files ?? [])
  if (files.length === 0) return
  await handleFiles(files)
}

/** 重试单个失败任务（沿用原文件与来源/目录） */
async function retryUpload(task: UploadTask): Promise<void> {
  const ok = await runUpload(task)
  if (!uploadInProgress.value) stopProgressTimer()
  if (ok) ElMessage.success(`「${task.name}」已重新上传并选中`)
  else ElMessage.error(`「${task.name}」重试失败：${task.error}`)
}

/** 删除单个任务：成功的同步从上传列表/选择池移除，失败的直接移出任务列表 */
function removeUploadTask(task: UploadTask): void {
  if (task.previewUrl) URL.revokeObjectURL(task.previewUrl)
  uploadTasks.value = uploadTasks.value.filter((t) => t.id !== task.id)
  if (task.status === 'success' && task.url) {
    uploaded.value = uploaded.value.filter((i) => itemKey(i) !== task.url)
    removePoolKey(task.url!)
  }
  if (!uploadInProgress.value) stopProgressTimer()
}

function removeUploaded(item: PoolItem): void {
  const k = itemKey(item)
  uploaded.value = uploaded.value.filter((i) => itemKey(i) !== k)
  removePoolKey(k)
}

/** 只删除「本次上传且已选」的项，未选中的上传文件保留 */
function removeSelectedUploaded(): void {
  const removed = uploaded.value.filter(isSelected)
  if (removed.length === 0) return
  for (const i of removed) removePoolKey(itemKey(i))
  const keys = new Set(removed.map(itemKey))
  uploaded.value = uploaded.value.filter((i) => !keys.has(itemKey(i)))
  ElMessage.success(`已删除 ${removed.length} 个未确认文件`)
}

/** 全选/全不选/反选作用于「当前可见集合」，不清空其他 tab / 目录 / 源已选的项 */
function selectAllVisible(v: boolean): void {
  for (const i of visible.value) {
    if (v) {
      if (!addToPool(i)) break // 达到上限即止（addToPool 已提示）
    } else removeFromPool(i)
  }
}
function invertVisible(): void {
  for (const i of visible.value) togglePool(i)
}

/** 列表分页游标：非空表示来源侧还有剩余文件，可「加载更多」续拉 */
const galleryCursor = ref<string | null>(null)
const loadingMore = ref(false)

/** ── 搜索跨页全量扫描：来源侧还有未加载页时自动分块续拉，保证关键词能命中后面页的文件 ── */
const SEARCH_SCAN_CHUNK = 2000
/** 扫描上限：防异常超大桶无限拉取（达到即提示「结果可能不全」） */
const SEARCH_SCAN_MAX = 10_000
const scanning = ref(false)
const scanTotal = ref(0)
const scanCapped = ref(false)
let scanSeq = 0
let searchTimer: ReturnType<typeof setTimeout> | null = null

function cancelScan(): void {
  scanSeq++
  scanning.value = false
}

/** 从已加载页的游标开始分块续拉，直到扫完/达上限/被新上下文取代；匹配结果随 items 增长即时过滤呈现 */
async function runSearchScan(): Promise<void> {
  const source = activeSource.value
  if (!source || !keyword.value || !galleryCursor.value || scanning.value) return
  const seq = ++scanSeq
  scanning.value = true
  scanTotal.value = items.value.length
  scanCapped.value = false
  try {
    let cursor: string | null = galleryCursor.value
    while (cursor && scanTotal.value < SEARCH_SCAN_MAX) {
      const page = await props.library.list(source, target.value, { limit: SEARCH_SCAN_CHUNK, cursor, kind: props.mode })
      if (seq !== scanSeq) return // 关键词/目录/来源已变，本轮结果丢弃
      items.value = [...items.value, ...page.items]
      scanTotal.value = items.value.length
      cursor = page.nextCursor ?? null
      galleryCursor.value = cursor
    }
    if (cursor) scanCapped.value = true
  } catch (err) {
    if (seq === scanSeq) ElMessage.error(`搜索扫描失败：${(err as Error).message}`)
  } finally {
    if (seq === scanSeq) scanning.value = false
  }
}

async function loadGallery(): Promise<void> {
  const source = activeSource.value
  if (!source) return
  scanSeq++ // 上下文重置：进行中的搜索扫描立即失效
  scanning.value = false
  loadingList.value = true
  renderedCount.value = PAGE_SIZE
  try {
    // 不清空 pool：重选目录得到新列表后，此前已选仍保留，可继续累积
    const page = await props.library.list(source, target.value, { limit: FETCH_LIMIT, kind: props.mode })
    items.value = page.items
    galleryCursor.value = page.nextCursor ?? null
  } catch (err) {
    items.value = []
    galleryCursor.value = null
    ElMessage.error(`读取文件列表失败：${(err as Error).message}`)
  } finally {
    loadingList.value = false
  }
  // 带关键词进入/刷新列表：来源侧还有未加载页时自动续扫，保证搜索能命中后面页
  if (keyword.value && galleryCursor.value) void runSearchScan()
}

/** 「加载更多」续拉下一页（大目录 1000/10000+ 个文件时按页取，不一次列爆） */
async function loadMoreGallery(): Promise<void> {
  const source = activeSource.value
  if (!source || !galleryCursor.value || loadingMore.value) return
  loadingMore.value = true
  try {
    const page = await props.library.list(source, target.value, { limit: FETCH_LIMIT, cursor: galleryCursor.value, kind: props.mode })
    items.value = [...items.value, ...page.items]
    galleryCursor.value = page.nextCursor ?? null
    renderedCount.value += PAGE_SIZE
  } catch (err) {
    ElMessage.error(`加载更多失败：${(err as Error).message}`)
  } finally {
    loadingMore.value = false
  }
}

/** 滚动到底追加下一批（一次性拉全，分批挂 DOM；图片本身再走 loading=lazy） */
function onPaneScroll(e: Event): void {
  const el = e.target as HTMLElement
  if (el.scrollTop + el.clientHeight >= el.scrollHeight - 80 && renderedCount.value < visible.value.length) {
    renderedCount.value += PAGE_SIZE
  }
}
</script>

<template>
  <el-dialog
    :model-value="open"
    class="file-picker-dialog"
    :title="dialogTitle"
    width="820px"
    top="4vh"
    :close-on-click-modal="false"
    :close-on-press-escape="false"
    append-to-body
    @update:model-value="(v: boolean) => emit('update:open', v)"
  >
    <!-- 高频工具栏放 header：结构上脱离内容滚动区，滚动时始终可见 -->
    <template #header>
      <div class="lib-header">
        <span class="lib-title">{{ dialogTitle }}</span>
        <div class="lib-top">
          <div class="lib-row lib-row-source">
            <el-select v-model="sourceId" placeholder="选择来源（默认优先云）" class="source-select" :loading="loadingSources">
              <el-option v-for="s in sources" :key="s.id" :value="s.id" :label="s.label" />
            </el-select>
            <el-radio-group v-model="tab" class="mode-tabs">
              <el-radio-button value="upload">上传{{ kindLabel }}</el-radio-button>
              <el-radio-button value="gallery">从{{ kindLabel }}库选择</el-radio-button>
              <el-radio-button value="selected">已选择{{ poolCount ? ` ${poolCount}` : '' }}</el-radio-button>
            </el-radio-group>
          </div>
          <div class="lib-row lib-row-target">
            <el-input v-if="showBucket" v-model="target.bucket" placeholder="桶 / 容器（留空用 profile 默认）" class="bucket-input" />
            <el-cascader
              ref="cascaderRef"
              :key="dirPanelKey"
              v-model="dirModel"
              :props="cascaderProps"
              clearable
              class="dir-cascader"
              :placeholder="showBucket ? '目录前缀（逐级选或手输）' : typeOf === 'remote' ? '远程目录（逐级选或手输）' : '本地目录（逐级选或手输）'"
              @change="onDirChange"
            />
            <el-input
              v-model="dirModel"
              clearable
              class="dir-manual"
              :class="{ 'dir-invalid': dirValidation.level === 'error' }"
              placeholder="或手输目录"
              @change="commitDirInput"
            />
          </div>
          <div v-if="dirValidation.level !== 'ok'" class="dir-validation" :class="`dir-validation--${dirValidation.level}`">
            {{ dirValidation.message }}
          </div>
          <!-- 目录懒加载失败：透出原因，仍可手输 -->
          <div v-if="dirError" class="dir-validation dir-validation--warning">目录列表加载失败：{{ dirError }}（仍可手输目录）</div>
          <div class="lib-row lib-row-actions">
            <span class="lib-count">
              已选 {{ poolCount }}{{ effectiveMax > 0 ? ` / ${effectiveMax}` : '' }}（上传 {{ uploadPicked }} · 库选 {{ existingPicked }}）
            </span>
            <el-input v-model="keyword" clearable class="search-input" placeholder="搜索文件名" />
            <el-button size="small" type="primary" plain @click="selectAllVisible(true)">全选本页</el-button>
            <el-button size="small" type="info" plain @click="selectAllVisible(false)">全不选</el-button>
            <el-button size="small" type="info" plain @click="invertVisible">反选本页</el-button>
            <el-button v-if="tab === 'gallery'" size="small" type="success" plain :loading="loadingList" @click="loadGallery">刷新</el-button>
            <el-button v-else-if="tab === 'selected'" size="small" type="danger" plain :disabled="poolCount === 0" @click="clearPool">清空</el-button>
            <el-button v-else size="small" type="danger" plain :disabled="uploadPicked === 0" @click="removeSelectedUploaded">删除所选</el-button>
          </div>
        </div>
        <!-- 上传总体进度固定在 header，滚动区只放纯文件列表 -->
        <div v-if="uploadTotal" class="upload-progress-bar">
          <div class="up-summary">
            <span>上传进度 {{ uploadDone }}/{{ uploadTotal }} · 成功 {{ uploadSucceeded }} · 失败 {{ uploadFailed }}</span>
            <el-button size="small" text type="info" @click="uploadTasks = uploadTasks.filter((t) => t.status === 'uploading')">清除已完成</el-button>
          </div>
          <el-progress :percentage="overallPercent" :status="uploadFailed && !uploadInProgress ? 'exception' : uploadDone === uploadTotal ? 'success' : undefined" :stroke-width="8" />
        </div>
      </div>
    </template>
    <input
      ref="uploadInput"
      type="file"
      :accept="acceptAttr"
      :multiple="uploadMultiple"
      class="hidden-input"
      @change="onFilesChosen"
    />

    <div class="lib-pane" @scroll="onPaneScroll">
      <div
        v-if="tab === 'upload'"
        class="drop-hint"
        :class="{ busy: uploading, active: dropActive }"
        @click="pickFiles"
        @dragover.prevent="dropActive = true"
        @dragleave.prevent="dropActive = false"
        @drop.prevent="onDrop"
      >
        <div class="drop-main">{{ uploadHint }}</div>
        <div class="drop-sub">上传后先预览、可删除/点开查看；切到列表页可继续挑选，最后一并确认</div>
      </div>
      <div v-if="visible.length || (tab === 'upload' && activeUploadTasks.length)" class="thumb-grid">
        <!-- 上传中/失败任务：卡片上叠进度/状态，卡片底部放重试与删除 -->
        <div
          v-for="task in tab === 'upload' ? activeUploadTasks : []"
          :key="'task-' + task.id"
          class="thumb-cell task-cell"
          :class="'st-' + task.status"
          :title="task.status === 'failed' ? task.error : task.name"
        >
          <div class="task-thumb">
            <img
              v-if="isImage && task.previewUrl && !task.previewFailed"
              :src="task.previewUrl"
              :alt="task.name"
              @error="task.previewFailed = true"
            />
            <div v-else-if="!isImage" class="file-tile">
              <el-icon :size="26"><Document /></el-icon>
              <span class="file-ext">{{ extOf(task.name) || 'FILE' }}</span>
            </div>
            <span v-else class="task-thumb-ph" title="图片预览不可用">
              <el-icon :size="24"><Picture /></el-icon>
            </span>
            <span v-if="task.status === 'success'" class="task-thumb-state ok">✓</span>
            <span v-else-if="task.status === 'failed'" class="task-thumb-state err">!</span>
            <el-progress
              v-if="task.status !== 'failed'"
              class="task-thumb-progress"
              :percentage="task.status === 'success' ? 100 : task.percent"
              :status="task.status === 'success' ? 'success' : undefined"
              :stroke-width="4"
              :show-text="false"
            />
          </div>
          <div class="thumb-name">{{ task.name }}</div>
          <div class="task-meta">
            <span class="task-status" :class="'st-' + task.status">
              {{ task.status === 'uploading' ? `上传中 ${task.percent}%` : task.status === 'success' ? '上传完成' : '上传失败' }}
            </span>
          </div>
          <div class="task-ops">
            <el-button v-if="task.status === 'failed'" size="small" type="primary" link @click="retryUpload(task)">重试</el-button>
            <el-button size="small" type="danger" link @click="removeUploadTask(task)">删除</el-button>
          </div>
        </div>
        <div v-for="item in rendered" :key="itemKey(item)" class="thumb-cell" :class="{ picked: isSelected(item) }">
          <el-checkbox :model-value="isSelected(item)" class="thumb-check" @change="togglePool(item)" @click.stop />
          <!-- 图片模式：缩略图 + 大图预览；文件模式：类型图标卡片 -->
          <el-image
            v-if="isImage"
            :src="resolveSrcOf(item.url)"
            fit="cover"
            loading="lazy"
            class="thumb-img"
            :preview-src-list="previewUrls"
            :initial-index="visible.indexOf(item)"
            :preview-teleported="true"
            @click.stop
          >
            <template #placeholder>
              <div class="img-placeholder" aria-hidden="true">
                <el-icon class="img-placeholder-icon" :size="26"><Picture /></el-icon>
              </div>
            </template>
            <template #error>
              <div class="img-fallback" title="图片加载失败">
                <svg class="img-fallback-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <rect x="3" y="3" width="18" height="18" rx="2.5" />
                  <circle cx="8.5" cy="8.5" r="1.5" />
                  <path d="M21 15.5 16 11 7 20" />
                  <path d="M4 4 20 20" class="img-fallback-slash" />
                </svg>
                <span class="img-fallback-text">图片不可用</span>
              </div>
            </template>
          </el-image>
          <div v-else class="thumb-img file-tile" title="文件">
            <el-icon :size="30"><Document /></el-icon>
            <span class="file-ext">{{ extOf(item.name || item.key || '') || 'FILE' }}</span>
            <span v-if="item.size" class="file-size">{{ formatSize(item.size) }}</span>
          </div>
          <div class="thumb-name" :title="item.url">
            <span class="thumb-name-text">{{ item.name || item.key }}</span>
            <button
              type="button"
              class="copy-link"
              title="复制链接"
              @click.stop="copyLink(item)"
            >
              <el-icon :size="12"><Link /></el-icon>
            </button>
          </div>
          <span v-if="tab === 'selected'" class="thumb-badge" :title="scopeLabel(item.scope)">{{ scopeLabel(item.scope) }}</span>
          <span v-else-if="item.origin === 'upload'" class="thumb-badge">本次上传</span>
          <!-- 删除/移除改为右上角 icon 悬浮钮：删除(垃圾桶)=移出本次上传，移除(✕)=取消已选，图形区分避免歧义（2026-11-17 用户反馈） -->
          <button
            v-if="tab === 'selected'"
            type="button"
            class="thumb-del"
            title="移除已选"
            @click.stop="removePoolKey(itemKey(item))"
          >
            <el-icon :size="12"><Close /></el-icon>
          </button>
          <button
            v-else-if="item.origin === 'upload'"
            type="button"
            class="thumb-del"
            title="删除"
            @click.stop="removeUploaded(item)"
          >
            <el-icon :size="12"><Delete /></el-icon>
          </button>
        </div>
      </div>
      <div v-else class="gallery-empty">{{ emptyStateText }}</div>
      <div v-if="scanning" class="load-more load-more--action">
        正在搜索全部文件：已扫描 {{ scanTotal }} 个…
        <el-button size="small" type="danger" plain @click="cancelScan">取消</el-button>
      </div>
      <div v-else-if="scanCapped" class="load-more">已扫描 {{ scanTotal }} 个（达扫描上限，更深的文件未纳入搜索）</div>
      <div v-else-if="renderedCount < visible.length" class="load-more">已显示 {{ rendered.length }} / {{ visible.length }}，滚动继续加载</div>
      <div v-else-if="galleryCursor && tab === 'gallery'" class="load-more load-more--action">
        已加载 {{ items.length }} 个，来源侧可能还有更多
        <el-button size="small" type="primary" plain :loading="loadingMore" @click="loadMoreGallery">加载更多</el-button>
      </div>
    </div>

    <template #footer>
      <!-- 确认动作沉底：继续上传 / 插入所选与关闭同行，关闭固定最右（2026-11-17 用户反馈） -->
      <el-button type="primary" plain @click="uploadMore">继续上传</el-button>
      <el-button type="primary" :disabled="poolCount === 0" @click="confirmSelected">
        {{ confirmLabel }}{{ poolCount ? ` ${poolCount} 个` : '' }}
      </el-button>
      <el-button type="info" plain @click="close">关闭</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
/* 工具栏已移入 header：标题 + 三行高频操作区，结构上不随内容滚动 */
.lib-title { display: block; font-size: 18px; font-weight: 600; line-height: 24px; margin-bottom: 8px; padding-right: 32px; }
.lib-top { border-bottom: 1px solid var(--sshk-border, rgba(128, 128, 128, 0.25)); padding-bottom: 8px; }
.lib-row { display: flex; align-items: center; gap: 6px; margin-bottom: 6px; }
.lib-row:last-child { margin-bottom: 0; }
.source-select { flex: 1 1 auto; }
.mode-tabs { flex: 0 0 auto; }
.bucket-input { flex: 0 0 220px; }
.dir-cascader { flex: 0 1 240px; min-width: 0; }
.dir-manual { flex: 1 1 auto; min-width: 0; }
.dir-validation { font-size: 12px; line-height: 1.4; margin-top: -2px; }
.dir-validation--warn { color: #e6a23c; }
.dir-validation--warning { color: #e6a23c; }
.dir-validation--error { color: #f56c6c; }
.dir-validation--info { color: var(--el-text-color-secondary); }
.dir-invalid :deep(.el-input__wrapper) { box-shadow: 0 0 0 1px #f56c6c inset; }
.search-input { flex: 0 0 150px; }
.hidden-input { display: none; }
.lib-row-actions { flex-wrap: wrap; gap: 6px; }
.lib-count { font-size: 12px; opacity: 0.75; margin-right: 2px; }
.drop-hint {
  border: 1px dashed rgba(128, 128, 128, 0.45);
  border-radius: 8px;
  padding: 16px 14px;
  text-align: center;
  cursor: pointer;
  transition: border-color 0.2s, background 0.2s;
  margin-bottom: 10px;
}
.drop-hint:hover, .drop-hint.active { border-color: var(--el-color-primary); }
.drop-hint.active { background: rgba(64, 158, 255, 0.08); }
.drop-hint.busy { opacity: 0.6; cursor: wait; }
/* 上传总体进度条 */
.upload-progress-bar { border: 1px solid var(--sshk-border, rgba(128, 128, 128, 0.25)); border-radius: 6px; padding: 8px 10px; margin-top: 10px; margin-bottom: 0; }
.up-summary { display: flex; align-items: center; justify-content: space-between; font-size: 12px; margin-bottom: 6px; }
/* 上传中/失败任务卡片：与成功缩略图同网格，进度直接叠在图片上 */
.task-cell { border-color: var(--sshk-border, rgba(128, 128, 128, 0.3)); }
.task-cell.st-failed { border-color: var(--el-color-danger); }
.task-thumb { position: relative; width: 100%; height: 80px; border-radius: 4px; overflow: hidden; background: rgba(128, 128, 128, 0.1); }
.task-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
.task-thumb-ph { display: grid; place-items: center; width: 100%; height: 100%; color: var(--el-text-color-placeholder); opacity: 0.4; }
.task-thumb-state { position: absolute; top: 4px; right: 4px; width: 18px; height: 18px; display: grid; place-items: center; font-size: 12px; color: #fff; border-radius: 50%; }
.task-thumb-state.ok { background: var(--el-color-success); }
.task-thumb-state.err { background: var(--el-color-danger); }
.task-thumb-progress { position: absolute; left: 0; right: 0; bottom: 0; padding: 0 3px 3px; }
.task-meta { margin-top: 2px; }
.task-status { font-size: 10px; }
.task-status.st-uploading { color: var(--el-color-primary); }
.task-status.st-success { color: var(--el-color-success); }
.task-status.st-failed { color: var(--el-color-danger); }
.task-ops { display: flex; justify-content: center; gap: 4px; margin-top: 2px; }
.task-ops .el-button { padding: 2px 4px; height: auto; font-size: 11px; }
.drop-main { font-size: 14px; }
.drop-sub { font-size: 12px; opacity: 0.6; margin-top: 5px; }
.thumb-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(110px, 1fr)); gap: 8px; }
.thumb-cell {
  position: relative;
  border: 2px solid transparent;
  border-radius: 6px;
  padding: 3px;
  text-align: center;
}
.thumb-cell.picked { border-color: var(--el-color-primary); background: rgba(64, 158, 255, 0.08); }
/* 悬浮复选框：半透明暗色毛玻璃背板 + 白描边，避免纯白方块浮在深色/失败占位上突兀（明暗主题通用）。
   EP 的 .el-checkbox 默认 height:32px（theme.css 又把内芯定为 15px）——背板会上下多出灰色，
   必须让 wrapper 高度塌到内芯 + 2px padding（用户反馈 2026-11-17） */
.thumb-check {
  position: absolute; top: 5px; left: 5px; z-index: 2;
  height: auto;
  margin: 0; padding: 2px; line-height: 0;
  background: rgba(0, 0, 0, 0.34);
  border-radius: 5px;
  backdrop-filter: blur(2px);
  -webkit-backdrop-filter: blur(2px);
}
.thumb-check :deep(.el-checkbox__inner) {
  width: 15px; height: 15px;
  background-color: transparent;
  border-color: rgba(255, 255, 255, 0.92);
  border-radius: 3px;
}
.thumb-check :deep(.el-checkbox__inner:hover) { border-color: var(--el-color-primary); }
.thumb-check.is-checked :deep(.el-checkbox__inner) {
  background-color: var(--el-color-primary);
  border-color: var(--el-color-primary);
}
.thumb-img { width: 100%; height: 80px; border-radius: 4px; display: block; cursor: zoom-in; }
/* 文件模式卡片：类型图标 + 扩展名 + 大小（无缩略图/无大图预览） */
.file-tile {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 3px; color: var(--el-text-color-placeholder);
  background: repeating-linear-gradient(135deg, rgba(128, 128, 128, 0.06) 0 6px, transparent 6px 12px);
}
.file-ext { font-size: 11px; font-weight: 600; letter-spacing: 0.5px; }
.file-size { font-size: 10px; opacity: 0.7; }
/* 图片加载失败：统一柔和占位（替代 Element Plus 默认 FAILED 与生硬的「裂图」文案） */
.img-fallback {
  width: 100%; height: 100%; display: flex; flex-direction: column;
  align-items: center; justify-content: center; gap: 3px;
  color: var(--el-text-color-placeholder);
  background: repeating-linear-gradient(135deg, rgba(128, 128, 128, 0.06) 0 6px, transparent 6px 12px);
}
/* 图片尚未加载（懒加载未触发/加载中）：柔和淡图标占位，替代纯空白卡片 */
.img-placeholder {
  width: 100%; height: 100%; display: flex; align-items: center; justify-content: center;
  color: var(--el-text-color-placeholder);
  background: repeating-linear-gradient(135deg, rgba(128, 128, 128, 0.04) 0 6px, transparent 6px 12px);
}
.img-placeholder-icon { width: 26px; height: 26px; opacity: 0.4; }
.img-fallback-icon { width: 26px; height: 26px; opacity: 0.7; }
.img-fallback-slash { opacity: 0.45; }
.img-fallback-text { font-size: 11px; line-height: 1; }
.thumb-name { font-size: 11px; margin-top: 3px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; opacity: 0.75; display: flex; align-items: center; gap: 4px; min-width: 0; }
.thumb-name-text { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
/* 复制链接 icon：悬浮缩略图时浮现，点击复制完整 URL（title 已带完整链接可悬停查看） */
.copy-link {
  flex: none; display: none; align-items: center; justify-content: center;
  width: 18px; height: 18px; padding: 0; border: 0; border-radius: 4px;
  background: transparent; color: inherit; cursor: pointer;
}
.thumb-cell:hover .copy-link { display: inline-flex; opacity: 0.85; }
.thumb-cell:hover .thumb-name { opacity: 1; }
.copy-link:hover { background: color-mix(in srgb, var(--sshk-accent, #4f8cff) 22%, transparent); color: var(--sshk-accent, #4f8cff); opacity: 1; }
.thumb-badge { display: block; font-size: 10px; color: var(--el-color-primary); }
/* 删除/移除 icon：右上角悬浮小钮（替代文字按钮），毛玻璃暗底与左上复选框呼应，hover 红色填充 */
.thumb-del {
  position: absolute; top: 5px; right: 5px; z-index: 2;
  width: 18px; height: 18px; padding: 0; border: 0; border-radius: 4px;
  display: grid; place-items: center; cursor: pointer;
  background: rgba(0, 0, 0, 0.34);
  color: var(--el-color-danger);
  backdrop-filter: blur(2px);
  -webkit-backdrop-filter: blur(2px);
}
.thumb-del:hover { background: color-mix(in srgb, var(--el-color-danger) 30%, transparent); }
.gallery-empty { text-align: center; padding: 28px 0; font-size: 13px; opacity: 0.6; }
.load-more { text-align: center; padding: 10px 0 2px; font-size: 12px; opacity: 0.6; }
.load-more--action { display: flex; align-items: center; justify-content: center; gap: 10px; }

/* 整个弹框（含 header 工具栏 + footer）占应用视口约 75%，body 用 flex 吃掉 header 之外的剩余 */
:global(.file-picker-dialog) {
  height: 75vh;
  min-height: 460px;
  max-height: 92vh;
  padding-bottom: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
:global(.file-picker-dialog .el-dialog__header) { flex: 0 0 auto; padding: 0 !important; margin-right: 0 !important; }
:global(.file-picker-dialog .el-dialog__body) {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding: 12px 0 0 !important;
}
:global(.file-picker-dialog .el-dialog__footer) { flex: 0 0 auto; padding: 12px 0 16px !important; }
/* 缩略图区占满剩余高度并单独滚动；已选清单用 flex-basis 受自身 max-height 约束后单独滚动 */
.lib-pane { flex: 1 1 0; min-height: 120px; overflow-y: auto; padding-right: 6px; }
</style>
