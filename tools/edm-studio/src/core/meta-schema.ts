/**
 * EDM 元数据 JSON Schema（R2）：供 monaco-yaml 实时校验 + 解析期/保存前校验。
 * 黑白名单仅片段侧持有（FragmentPolicy），模板/品牌侧不再有 policy（见 §四 用户裁定）。
 */
import Ajv from 'ajv'
import type { EntityKind } from './edm-types.js'

/** 各实体 meta.yaml 的 JSON Schema（渲染层可直接喂给 monaco-yaml 的 schemas） */
export const META_JSON_SCHEMAS: Record<EntityKind, object> = {
  brand: {
    type: 'object',
    required: ['code', 'name'],
    properties: {
      code: { type: 'string' },
      name: { type: 'string' },
      description: { type: 'string' },
      logo: { type: 'string' },
      defaultTemplateFamily: { type: 'string' },
      tags: { type: 'array', items: { type: 'string' } },
    },
    additionalProperties: true,
  },
  fragmentFamily: {
    type: 'object',
    required: ['code', 'name'],
    properties: {
      code: { type: 'string' },
      name: { type: 'string' },
      description: { type: 'string' },
      type: { type: 'string' },
      policy: {
        type: 'object',
        description: '片段黑白名单：指示本片段适用于哪些模板',
        properties: {
          whitelist: { type: 'array', items: { type: 'string' }, description: '可服务模板族/版本 ID；空=本品牌全部模板可用' },
          blacklist: { type: 'array', items: { type: 'string' }, description: '排除的模板族/版本 ID，优先于白名单' },
        },
        additionalProperties: false,
      },
      dataSchema: { type: 'object' },
      tags: { type: 'array', items: { type: 'string' } },
    },
    additionalProperties: true,
  },
  fragmentVersion: {
    type: 'object',
    required: ['version'],
    properties: {
      version: { type: 'integer', minimum: 1 },
      changelog: { type: 'string' },
      policy: {
        type: 'object',
        properties: {
          whitelist: { type: 'array', items: { type: 'string' } },
          blacklist: { type: 'array', items: { type: 'string' } },
        },
        additionalProperties: false,
      },
    },
    additionalProperties: true,
  },
  templateFamily: {
    type: 'object',
    required: ['code', 'name'],
    properties: {
      code: { type: 'string' },
      name: { type: 'string' },
      description: { type: 'string' },
      slots: {
        type: 'array',
        items: {
          type: 'object',
          required: ['key', 'type'],
          properties: { key: { type: 'string' }, type: { type: 'string' } },
          additionalProperties: false,
        },
      },
      dataSchema: { type: 'object' },
      tags: { type: 'array', items: { type: 'string' } },
    },
    additionalProperties: true,
  },
  templateVersion: {
    type: 'object',
    required: ['version'],
    properties: {
      version: { type: 'integer', minimum: 1 },
      changelog: { type: 'string' },
    },
    additionalProperties: true,
  },
}

const ajv = new Ajv({ allErrors: true, strict: false })
const validators = new Map<EntityKind, ReturnType<typeof ajv.compile>>()
for (const [k, schema] of Object.entries(META_JSON_SCHEMAS)) {
  validators.set(k as EntityKind, ajv.compile(schema as object))
}

export interface ValidationResult {
  valid: boolean
  errors: string[]
}

/** 解析期 / 编辑器保存前校验 meta.yaml（R2）。 */
export function validateMeta(kind: EntityKind, data: unknown): ValidationResult {
  const validate = validators.get(kind)
  if (!validate) return { valid: false, errors: [`未知实体类型: ${kind}`] }
  const valid = validate(data)
  if (valid) return { valid: true, errors: [] }
  return {
    valid: false,
    errors: (validate.errors ?? []).map((e) => `${e.instancePath || '/'} ${e.message ?? ''}`),
  }
}
