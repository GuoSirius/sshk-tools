/**
 * 表单设计服务（plans/13 B1/C）：表单 CRUD + 复合控件 CRUD + 内置控件播种。
 * - 数据落 NeDB forms / formControls 集合（@sshk/repository），随备份 zip 导出
 * - 后端白名单收口：fields/root 一律 normalizeFields 过滤，再 validateSchema + expandFields
 *   （引用存在性 / 嵌套深度上限按工具配置 app.modules.formManager.maxCompositeDepth，默认 5、0=无限制）
 * - 删除拦截：控件被 forms.controlsUsed 反查命中 → validation 错；builtin 禁删禁改
 */
import type { Repository, ConfigService, FormDoc, ControlDoc } from '@sshk/repository'
import { AppError } from '@sshk/shared'
import type { FormRecord, FormSaveInput, ControlRecord, ControlSaveInput } from '@sshk/shared'
import {
  BUILTIN_CONTROLS,
  CONTAINER_TYPES,
  KEY_RE,
  KEY_RESERVED,
  collectControlKeys,
  expandFields,
  normalizeCompositeDepth,
  normalizeFields,
  validateSchema,
} from '@sshk/form-schema'
import type { FieldDef } from '@sshk/form-schema'

/** 复合控件嵌套深度配置键（表单设计 > 工具设置；默认 5，0 = 无限制） */
export const FORM_DEPTH_CONFIG_KEY = 'app.modules.formManager.maxCompositeDepth'

function depthLimit(config: ConfigService): number {
  return normalizeCompositeDepth(config.get(FORM_DEPTH_CONFIG_KEY))
}

/** 引用解析器工厂：key → 控件 root（FieldDef），不存在返回 undefined */
function makeResolver(controls: ControlDoc[]): (key: string) => FieldDef | undefined {
  const map = new Map(controls.map((c) => [c.key, c.root as FieldDef]))
  return (key) => map.get(key)
}

/** 展开失败统一转 validation（预期业务失败，warn 落盘不刷堆栈——#128 口径） */
function expandOrThrow(fields: FieldDef[], resolve: (key: string) => FieldDef | undefined, maxDepth: number): FieldDef[] {
  try {
    return expandFields(fields, resolve, { maxDepth })
  } catch (err) {
    throw new AppError(err instanceof Error ? err.message : String(err), 'validation')
  }
}

/** schema 红字取第一条转 validation（双层校验后端侧：入库前必须过） */
function assertSchemaOk(fields: FieldDef[], what: string): void {
  const errors = validateSchema(fields)
  const first = Object.entries(errors)[0]
  if (first) throw new AppError(`${what}校验未通过：${first[1]}`, 'validation')
}

function toFormRecord(doc: FormDoc): FormRecord {
  return {
    _id: doc._id,
    name: doc.name,
    description: doc.description,
    version: doc.version,
    fields: doc.fields,
    controlsUsed: doc.controlsUsed,
    sampleModel: doc.sampleModel,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    archived: doc.archived,
  }
}

function toControlRecord(doc: ControlDoc): ControlRecord {
  return {
    _id: doc._id,
    key: doc.key,
    label: doc.label,
    icon: doc.icon,
    description: doc.description,
    version: doc.version,
    builtin: doc.builtin,
    root: doc.root,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    archived: doc.archived,
  }
}

// ── 表单 CRUD ──

export async function formList(repo: Repository): Promise<FormRecord[]> {
  const rows = await repo.list<FormDoc>('forms', { archived: false })
  return rows.map(toFormRecord)
}

export async function formGet(repo: Repository, id: string): Promise<FormRecord | null> {
  const doc = await repo.get<FormDoc>('forms', String(id ?? ''))
  return doc && !doc.archived ? toFormRecord(doc) : null
}

/** 新建或更新：name 必填；fields 白名单收口 + schema 校验 + 引用展开校验；controlsUsed/version 主进程重算 */
export async function formSave(repo: Repository, config: ConfigService, input: FormSaveInput): Promise<FormRecord> {
  const name = String(input?.name ?? '').trim()
  if (!name) throw new AppError('表单名称不能为空', 'validation')
  const description = input?.description?.trim() || undefined
  const fields = normalizeFields(input?.fields)
  assertSchemaOk(fields, '表单字段')

  const controls = await repo.list<ControlDoc>('formControls', { archived: false })
  const resolve = makeResolver(controls)
  expandOrThrow(fields, resolve, depthLimit(config))
  const controlsUsed = collectControlKeys(fields)

  const sampleModel = input?.sampleModel && typeof input.sampleModel === 'object' && !Array.isArray(input.sampleModel)
    ? (input.sampleModel as Record<string, unknown>)
    : undefined

  const id = String(input?._id ?? '')
  if (id) {
    const existing = await repo.get<FormDoc>('forms', id)
    if (existing && !existing.archived) {
      const updated = await repo.update<FormDoc>('forms', id, {
        name,
        description,
        fields,
        controlsUsed,
        sampleModel,
        version: (existing.version ?? 0) + 1,
      })
      if (updated) return toFormRecord(updated)
    }
  }
  const inserted = await repo.insert<FormDoc>('forms', {
    name,
    description,
    fields,
    controlsUsed,
    sampleModel,
    version: 1,
  })
  return toFormRecord(inserted)
}

/** 删除：默认软删（archived），hard=true 硬删（调用方须二次确认） */
export async function formRemove(repo: Repository, id: string, hard = false): Promise<boolean> {
  const docId = String(id ?? '')
  if (!docId) return false
  if (hard) return (await repo.remove('forms', docId)) > 0
  return (await repo.archive('forms', docId)) !== null
}

// ── 复合控件 CRUD（阶段 C）──

export async function controlList(repo: Repository): Promise<ControlRecord[]> {
  const rows = await repo.list<ControlDoc>('formControls', { archived: false })
  return rows.map(toControlRecord)
}

export async function controlGet(repo: Repository, id: string): Promise<ControlRecord | null> {
  const doc = await repo.get<ControlDoc>('formControls', String(id ?? ''))
  return doc && !doc.archived ? toControlRecord(doc) : null
}

/** 新建或更新自定义控件：key 唯一 + root 必须容器型 + 引用展开校验；builtin 只读禁改 */
export async function controlSave(repo: Repository, config: ConfigService, input: ControlSaveInput): Promise<ControlRecord> {
  const id = String(input?._id ?? '')
  if (id) {
    const existing = await repo.get<ControlDoc>('formControls', id)
    if (existing?.builtin) throw new AppError('内置控件不可修改', 'validation')
  }

  const key = String(input?.key ?? '').trim()
  const label = String(input?.label ?? '').trim()
  if (!key) throw new AppError('控件 key 不能为空', 'validation')
  if (!KEY_RE.test(key) || KEY_RESERVED.has(key)) {
    throw new AppError('key 只能含字母/数字/下划线，且不以数字开头', 'validation')
  }
  if (!label) throw new AppError('控件名称不能为空', 'validation')

  // root 必须是单个容器型字段（list/repeater/table）
  const roots = normalizeFields(Array.isArray(input?.root) ? input.root : [input?.root])
  if (roots.length !== 1 || !CONTAINER_TYPES.includes(roots[0]!.type)) {
    throw new AppError('控件根节点必须是 list/repeater/table 容器', 'validation')
  }
  const root = roots[0]!
  assertSchemaOk([root], '控件字段')

  // key 跨集合唯一（排除自身）
  const all = await repo.list<ControlDoc>('formControls', { archived: false })
  if (all.some((c) => c.key === key && c._id !== id)) {
    throw new AppError(`控件 key 已存在：${key}`, 'validation')
  }

  // 引用展开校验（含循环引用/超深/悬空引用；自身已在集合中可被引用，路径集合会刹住自环）
  const resolve = makeResolver(all)
  expandOrThrow([root], resolve, depthLimit(config))

  const icon = input?.icon?.trim() || undefined
  const description = input?.description?.trim() || undefined

  if (id) {
    const existing = await repo.get<ControlDoc>('formControls', id)
    if (existing && !existing.archived) {
      const updated = await repo.update<ControlDoc>('formControls', id, {
        key,
        label,
        icon,
        description,
        root,
        version: (existing.version ?? 0) + 1,
      })
      if (updated) return toControlRecord(updated)
    }
  }
  const inserted = await repo.insert<ControlDoc>('formControls', {
    key,
    label,
    icon,
    description,
    root,
    version: 1,
    builtin: false,
  })
  return toControlRecord(inserted)
}

/** 删除：builtin 禁删；被表单引用（controlsUsed 反查）禁删 */
export async function controlRemove(repo: Repository, id: string, hard = false): Promise<boolean> {
  const docId = String(id ?? '')
  if (!docId) return false
  const doc = await repo.get<ControlDoc>('formControls', docId)
  if (!doc) return false
  if (doc.builtin) throw new AppError('内置控件不可删除', 'validation')
  const used = await repo.list<FormDoc>('forms', { archived: false, controlsUsed: doc.key })
  if (used.length) {
    throw new AppError(`控件「${doc.label}」被表单 ${used.map((f) => `「${f.name}」`).join('、')} 引用，请先解除引用`, 'validation')
  }
  if (hard) return (await repo.remove('formControls', docId)) > 0
  return (await repo.archive('formControls', docId)) !== null
}

// ── 内置控件播种（启动幂等：按 key 查缺补插，已存在不覆盖——用户改不了 builtin，也不存在漂移）──

export async function ensureSeedControls(repo: Repository): Promise<void> {
  const existing = new Set((await repo.list<ControlDoc>('formControls', { archived: false })).map((c) => c.key))
  for (const spec of BUILTIN_CONTROLS) {
    if (existing.has(spec.key)) continue
    await repo.insert<ControlDoc>('formControls', {
      key: spec.key,
      label: spec.label,
      description: spec.description,
      root: spec.root,
      version: 1,
      builtin: true,
    })
    console.log(`[form] 内置控件已播种：${spec.key}`)
  }
}
