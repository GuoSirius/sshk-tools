import { computed, ref, type ComputedRef, type Ref } from 'vue'
import { ElMessage } from 'element-plus'
import * as yaml from 'js-yaml'
import type { FieldDef } from '../sample-schema'
import { applyDefaults, normalizeFields, parseYamlObject, validateModel } from '../sample-schema'
import { replaceFieldsInMeta } from '../meta-fields'
import { api } from '../shared'
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
  form: Ref<{ name: string; code: string; description: string; logo: string; type: string; version: number; changelog: string; policyB: string; policyW: string }>
  showForm: ComputedRef<{ catBase: boolean; brandBase: boolean; policy: boolean; version: boolean }>
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

/** 名单文本（顿号/逗号分隔）→ 数组（原文 syncFormToRaw 用） */
function splitList(s: string | undefined): string[] {
  return (s ?? '').split(/[,，、]+/).map((x) => x.trim()).filter(Boolean)
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
    name: '', code: '', description: '', logo: '', type: '',
    version: 1, changelog: '', policyB: '', policyW: '',
  })

  const showForm = computed(() => ({
    catBase: deps.selected.value?.kind === 'category',
    brandBase: deps.selected.value?.kind === 'brand' || deps.selected.value?.kind === 'family',
    policy: deps.selected.value?.kind === 'family' && deps.selected.value?.data.cat === 'fragment',
    version: deps.selected.value?.kind === 'version',
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
        metaRaw.value = (yaml.load(metaText.value) as Record<string, unknown>) ?? {}
        fillForm(metaRaw.value)
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
    const node = deps.selected.value
    if (!node?.data.metaPath) return
    try {
      let out = ''
      if (metaMode.value === 'form') {
        out = yaml.dump(syncFormToRaw(), { lineWidth: -1 })
      } else {
        parseYamlObject(metaText.value) // 语法校验，非法即抛；空内容视为 {}
        out = metaText.value
      }
      await deps.write(node.data.metaPath, out)
      if (node.kind !== 'root') await deps.load(true) // 元数据名称/code 变更实时反馈到左树（#4）
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
      await deps.write(node.data.sourcePath, sourceText.value)
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
      await deps.write(`${node.data.path}/style.css`, styleText.value)
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
      await deps.write(node.data.samplePath, sampleText.value)
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
    try {
      const raw = metaText.value || (await deps.read(node.data.metaPath))
      const updated = replaceFieldsInMeta(raw, fields)
      await deps.write(node.data.metaPath, updated)
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
    sampleMode, sampleSchema, sampleObj, form, showForm,
    loadNode, renderPreview,
    switchSampleMode, switchMetaMode,
    saveMeta, saveSource, saveStyle, saveSample, saveFields,
  }
}
