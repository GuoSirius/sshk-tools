import { computed, ref, type ComputedRef, type Ref } from 'vue'
import { ElMessage } from 'element-plus'
import * as yaml from 'js-yaml'
import type { FieldDef } from '../sample-schema'
import { applyDefaults, normalizeFields, parseYamlObject, validateModel, validateSchema } from '../sample-schema'
import { replaceFieldsInMeta, withMetaIdentity } from '../meta-fields'
import { isCodeReadonly, META_CODE_MODE, resolveMetaCode, validateMetaIdentity } from '../../core/meta-contract'
import { foreignPolicyIds, toStringList } from '../../core/fragment-policy'
import { api } from '../tool-api'
import { uploadInlineImages } from '../upload.js'
import type { Source, TreeNode } from './useContentTree'

/**
 * 节点详情编辑域（P6-4 自 ContentManagePage 拆出，搬代码不改行为）：
 * 元数据（表单↔数据切换 R17）/ 示例数据（R15 表单化 + 设计器）/ njk 源码 / 版本内联样式 的读取、编辑与保存；
 * 以及版本预览渲染（content:render 单渲）。组合预览（R19/R22）见 useComposePreview。
 */
export interface NodeDetailDeps {
  /** 当前选中节点（树域持有） */
  selected: Ref<TreeNode | null>
  read(file: string, source?: Source): Promise<string>
  write(file: string, content: string, source?: Source): Promise<void>
  /** 元数据名称/code 变更实时反馈到左树（#4） */
  load(silent?: boolean): Promise<void>
  /** 工具 id（T8 内联图片上传通道归属） */
  toolId: Ref<string>
  /** 元数据/源码保存后的派生缓存刷新（组合预览 slot 定义来自模板 njk 源码） */
  onAfterSave?(kind: 'meta' | 'source'): void | Promise<void>
}

export interface NodeDetail {
  metaRaw: Ref<Record<string, unknown> | null>
  metaMode: Ref<'form' | 'data'>
  metaText: Ref<string>
  sourceText: Ref<string>
  sampleText: Ref<string>
  styleText: Ref<string>
  previewHtml: Ref<string>
  previewing: Ref<boolean>
  /* R15：示例数据表单化 —— schema（版本 meta fields 优先，族 meta 兜底）+ 表单模型 + 表单|数据切换 */
  sampleMode: Ref<'form' | 'data' | 'design'>
  sampleSchema: Ref<FieldDef[]>
  sampleObj: Ref<Record<string, unknown>>
  form: Ref<{ name: string; code: string; description: string; favicon: string; tags: string[]; type: string; version: number; changelog: string; policyB: string[]; policyW: string[] }>
  showForm: ComputedRef<{ catBase: boolean; brandBase: boolean; base: boolean; codeReadonly: boolean; favicon: boolean; tags: boolean; typeField: boolean; policy: boolean; version: boolean }>
  /** favicon 继承提示（版本→族→类型→品牌） */
  faviconHint: ComputedRef<string>
  /** 当前节点真实目录名（code 镜像源） */
  dirNameOf(node: TreeNode): string
  /** 选中节点填充右侧详情（原文 onNode 的读取/回显段；compose 初始化与预览渲染由壳编排，顺序不变） */
  loadNode(node: TreeNode): Promise<void>
  renderPreview(node: TreeNode): Promise<void>
  switchSampleMode(mode: 'form' | 'data' | 'design'): void
  switchMetaMode(mode: 'form' | 'data'): void
  saveMeta(): Promise<void>
  saveSource(): Promise<void>
  saveStyle(): Promise<void>
  saveSample(): Promise<void>
  /** 字段设计器写回：把 fields 外科手术式替换进 meta.yaml（保留其余键与注释） */
  saveFields(): Promise<void>
}

/** 节点真实目录名：类型取 cat，版本取版本目录（折叠版 = default），其余取路径末段 */
function dirNameOf(node: TreeNode): string {
  if (node.kind === 'category') return node.data.cat ?? ''
  if (node.kind === 'version') return node.data.versionDir || 'default'
  return (node.data.path || '').split(/[/\\]/).pop() ?? ''
}

/**
 * 版本号只读派生（用户 2026-11-23 拍板）：恒取版本目录名 vN（default=1），
 * 手改 meta.yaml 的 version 会与目录名漂移、邮件编辑器误判最新版本，故表单不再手填。
 * 与 edm-manifest.versionOfDir / edm-seed.versionNumberOf 同口径。
 */
function versionOfDirName(dir: string): number {
  const m = /v(\d+)/i.exec(dir)
  return m ? Number(m[1]) : 1
}

/** 仅供必填校验使用：非法 YAML 当作空对象，由后续正规 parse 抛出可读错误 */
function safeParseYaml(text: string): unknown {
  try {
    return (yaml.load(text) as Record<string, unknown>) ?? {}
  } catch {
    return {}
  }
}

export function useNodeDetail(deps: NodeDetailDeps): NodeDetail {
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
    name: '', code: '', description: '', favicon: '', tags: [] as string[], type: '',
    version: 1, changelog: '', policyB: [] as string[], policyW: [] as string[],
  })

  const showForm = computed(() => {
    const k = deps.selected.value?.kind
    const cat = deps.selected.value?.data.cat
    const isFragment = cat === 'fragment'
    return {
      catBase: k === 'category',
      brandBase: k === 'brand' || k === 'family',
      base: k === 'brand' || k === 'category' || k === 'family' || k === 'version',
      codeReadonly: isCodeReadonly(META_CODE_MODE),
      // 片段侧全线不维护图标（类目/族/版本）；仅品牌与模板侧（类目/族/版本）显示
      favicon: k === 'brand' || ((k === 'category' || k === 'family' || k === 'version') && !isFragment),
      // 标签：品牌 / 类型 / 族有 tags（版本 meta 无 tags 字段）
      tags: k === 'brand' || k === 'category' || k === 'family',
      // 类型仅片段族可配；黑白名单片段族与版本都可配（版本在族结果上做增量修正）
      typeField: k === 'family' && isFragment,
      policy: (k === 'family' || k === 'version') && isFragment,
      version: k === 'version',
    }
  })

  const faviconHint = computed(() => {
    const k = deps.selected.value?.kind
    if (k === 'brand') return '品牌图标；无上级可继承'
    if (k === 'category') return '留空回退所属品牌 favicon'
    if (k === 'family') return '留空回退所属类型 favicon（再回退品牌）'
    if (k === 'version') return '留空回退所属族 favicon（再回退类型 / 品牌）'
    return ''
  })

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

  function fillForm(raw: Record<string, unknown>, node: TreeNode | null): void {
    const policy = (raw.policy ?? {}) as { blacklist?: unknown; whitelist?: unknown }
    form.value = {
      name: String(raw.name ?? ''),
      code: String(raw.code ?? ''),
      description: String(raw.description ?? ''),
      favicon: String(raw.favicon ?? ''),
      tags: toStringList(raw.tags),
      type: String(raw.type ?? ''),
      // 版本号只读派生：取目录名 vN，不读 meta.yaml 手填值（避免 v1 目录写 version:3 造成显示/最新判定混乱）
      version: node && node.kind === 'version' ? versionOfDirName(dirNameOf(node)) : Number(raw.version ?? 1),
      changelog: String(raw.changelog ?? ''),
      policyB: toStringList(policy.blacklist),
      policyW: toStringList(policy.whitelist),
    }
  }

  async function loadNode(node: TreeNode): Promise<void> {
    metaMode.value = 'form'
    metaRaw.value = null
    metaText.value = ''
    sourceText.value = ''
    sampleText.value = ''
    styleText.value = ''
    previewHtml.value = ''
    if (node.data.metaPath) {
      metaText.value = await deps.read(node.data.metaPath, node.data.source)
      try {
        // 类型层（template/fragment）meta.yaml 常不存在 → read 返回空串；js-yaml 5.x 的 load('') 抛
        // "expected a document"，会让整节点掉进 catch 变数据模式、code 空且不可编辑（用户实测无法保存）。
        // parseYamlObject 对空文档返回 {}，保留表单模式并由下方补齐目录名 code。
        metaRaw.value = parseYamlObject(metaText.value)
        fillForm(metaRaw.value, node)
        // code 当前 = 真实目录名镜像；旧文件缺 code / 文件不存在时这里就填可保存的默认值
        form.value.code = resolveMetaCode(dirNameOf(node), metaRaw.value?.code)
      } catch {
        metaRaw.value = null
        metaMode.value = 'data'
      }
    }
    if (node.kind === 'version') {
      sourceText.value = await deps.read(node.data.sourcePath ?? '', node.data.source)
      sampleText.value = await deps.read(node.data.samplePath ?? '', node.data.source)
      styleText.value = await deps.read(`${node.data.path}/style.css`, node.data.source)
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
    }
  }

  /** 族级 meta.yaml 的 fields 段（版本未声明时兜底） */
  async function readFamilyFields(famPath: string, source: Source): Promise<unknown> {
    const txt = await deps.read(`${famPath}/meta.yaml`, source)
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
    const node = deps.selected.value
    // 单版本折叠时 version 的 meta.yaml 就是族的 meta.yaml，不能覆盖族的 code/name/favicon
    const foldedVersion = node?.kind === 'version' && !node.data.versionDir
    if (s.base) {
      if (!foldedVersion && node) {
        patch.name = form.value.name.trim()
        patch.code = resolveMetaCode(dirNameOf(node), form.value.code)
      }
      if (s.favicon) patch.favicon = form.value.favicon.trim() || undefined
      patch.description = form.value.description.trim() || undefined
    }
    if (s.tags) patch.tags = form.value.tags.filter((t) => t.trim())
    if (s.typeField) patch.type = form.value.type.trim() || undefined
    if (s.policy) patch.policy = { blacklist: [...form.value.policyB], whitelist: [...form.value.policyW] }
    if (s.version) {
      // 版本号恒取目录名派生值：meta.yaml 里手填的 version 不会写回，避免与 vN 目录漂移
      patch.version = node ? versionOfDirName(dirNameOf(node)) : form.value.version
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
      fillForm(parsed, deps.selected.value)
    }
    metaMode.value = mode
  }

  async function saveMeta(): Promise<void> {
    const node = deps.selected.value
    if (!node?.data.metaPath) return
    // 第一层校验（前端）：四级元数据 code/name 必填，失败直接停留，不发 IPC
    // 单版本折叠时 meta.yaml 与族共用，identity 属于族，不在版本 tab 校验/覆盖
    const foldedVersion = node.kind === 'version' && !node.data.versionDir
    if (!foldedVersion) {
      const errors = metaMode.value === 'form'
        ? validateMetaIdentity({ code: form.value.code, name: form.value.name })
        : validateMetaIdentity(safeParseYaml(metaText.value))
      if (errors.length) {
        ElMessage.error(`元数据校验未通过：${errors.join('、')}`)
        return
      }
    }
    let out = ''
    try {
      if (metaMode.value === 'form') {
        out = yaml.dump(syncFormToRaw(), { lineWidth: -1 })
      } else {
        parseYamlObject(metaText.value) // 语法校验，非法即抛；空内容视为 {}
        out = metaText.value
      }
    } catch (err) {
      ElMessage.error(`元数据不是合法 YAML：${(err as Error).message}`)
      return
    }
    // 跨品牌硬规定（第二层）：数据模式手输的 policy 也必须只引用本品牌模板，防绕过下拉
    if (showForm.value.policy) {
      const rawOut = parseYamlObject(out) as { policy?: { whitelist?: unknown; blacklist?: unknown } }
      const foreign = foreignPolicyIds(
        { whitelist: toStringList(rawOut.policy?.whitelist), blacklist: toStringList(rawOut.policy?.blacklist) },
        node.data.brandCode ?? '',
      )
      if (foreign.length) {
        ElMessage.error(`黑白名单含跨品牌模板（${foreign.join('、')}），片段只能使用本品牌模板`)
        return
      }
    }
    try {
      await deps.write(node.data.metaPath, out, node.data.source)
      if (node.kind !== 'root') await deps.load(true) // 元数据名称/code 变更实时反馈到左树（#4）
      await deps.onAfterSave?.('meta') // 模板族 slots 声明变更同步到组合预览缓存
      ElMessage.success('元数据已保存')
      if (node.kind === 'version') await renderPreview(node)
    } catch (err) {
      ElMessage.error(`保存失败：${(err as Error).message}`)
    }
  }

  async function saveSource(): Promise<void> {
    const node = deps.selected.value
    if (!node?.data.sourcePath) return
    try {
      await deps.write(node.data.sourcePath, sourceText.value, node.data.source)
      await deps.onAfterSave?.('source') // njk 新增 {{ slot_x }} 后，布局配置/落点下拉立即刷新
      ElMessage.success('源码已保存')
      await renderPreview(node)
    } catch (err) {
      ElMessage.error(`保存失败：${(err as Error).message}`)
    }
  }

  /** 版本级内联样式：<verDir>/style.css，渲染时最后注入（优先级最高） */
  async function saveStyle(): Promise<void> {
    const node = deps.selected.value
    if (!node || node.kind !== 'version') return
    try {
      await deps.write(`${node.data.path}/style.css`, styleText.value, node.data.source)
      ElMessage.success('样式已保存')
      await renderPreview(node)
    } catch (err) {
      ElMessage.error(`保存失败：${(err as Error).message}`)
    }
  }

  async function saveSample(): Promise<void> {
    const node = deps.selected.value
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
      const uploaded = await uploadInlineImages(sampleText.value, deps.toolId.value)
      if (uploaded !== sampleText.value) {
        sampleText.value = uploaded
        if (sampleMode.value === 'form') {
          sampleObj.value = parseYamlObject(uploaded)
        }
      }
      await deps.write(node.data.samplePath, sampleText.value, node.data.source)
      ElMessage.success('示例数据已保存')
      await renderPreview(node)
    } catch (err) {
      ElMessage.error(`保存失败：${(err as Error).message}`)
    }
  }

  /** 字段设计器写回：把 fields 外科手术式替换进 meta.yaml（保留其余键与注释） */
  async function saveFields(): Promise<void> {
    const node = deps.selected.value
    if (!node?.data.metaPath) return
    const fields = normalizeFields(sampleSchema.value)
    if (fields.length !== sampleSchema.value.length) {
      ElMessage.warning(`已忽略 ${sampleSchema.value.length - fields.length} 个非法字段（缺 key 或未知类型）`)
      sampleSchema.value = fields
    }
    // 保存层第二层校验（体检 #5）：与设计器红字同源，schema 非法直接拦下、不发写盘 IPC。
    // 用 fields 下标定位错误（设计器选中项按 uid 映射，这里仅给序号提示）。
    const errors = validateSchema(fields)
    const first = Object.entries(errors)[0]
    if (first) {
      const idx = Number(first[0].split('.')[0])
      ElMessage.error(`第 ${idx + 1} 个字段定义有误：${first[1]}，请修正后再保存`)
      return
    }
    try {
      const raw = metaText.value || (await deps.read(node.data.metaPath, node.data.source))
      // 字段设计器写回不能因旧文件缺 code/name 被后端第二层校验挡下：补齐目录名默认值
      const foldedVersion = node.kind === 'version' && !node.data.versionDir
      const updated = foldedVersion
        ? replaceFieldsInMeta(raw, fields)
        : withMetaIdentity(replaceFieldsInMeta(raw, fields), dirNameOf(node), form.value.name || dirNameOf(node))
      await deps.write(node.data.metaPath, updated, node.data.source)
      metaText.value = updated
      metaRaw.value = (yaml.load(updated) as Record<string, unknown>) ?? {}
      ElMessage.success('字段定义已保存（meta.yaml fields:）')
      await renderPreview(node)
    } catch (err) {
      ElMessage.error(`保存失败：${(err as Error).message}`)
    }
  }

  return {
    metaRaw, metaMode, metaText, sourceText, sampleText, styleText, previewHtml, previewing,
    sampleMode, sampleSchema, sampleObj, form, showForm, faviconHint, dirNameOf,
    loadNode, renderPreview,
    switchSampleMode, switchMetaMode,
    saveMeta, saveSource, saveStyle, saveSample, saveFields,
  }
}
