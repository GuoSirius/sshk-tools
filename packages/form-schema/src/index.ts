/**
 * @sshk/form-schema 纯入口（plans/13 B0）：表单 schema 唯一真相源。
 * 零 .vue、零 Node 专有模块——main/preload 可安全引用；组件走 `./ui` 子入口。
 * 重组自 edm-studio sample-schema.ts（2026-11-23，D53 铁律：≥2 消费方必须抽包）。
 */
export type {
  FieldDef,
  FieldOption,
  FieldType,
  TableColumn,
} from './schema'
export { CONTAINER_TYPES, FIELD_TYPES } from './schema'

export {
  FIELD_CATALOG,
  FIELD_GROUP_LABEL,
  FIELD_TYPE_LABEL,
  retypeField,
  type FieldCatalogGroup,
  type FieldTypeInfo,
} from './catalog'

export { KEY_RE, KEY_RESERVED, validateModel, validateSchema } from './validate'
export { applyDefaults, normalizeFields } from './normalize'
export { parseYamlObject } from './yaml'
export {
  DEFAULT_COMPOSITE_DEPTH,
  UNLIMITED_DEPTH,
  collectControlKeys,
  compositeDepth,
  expandFields,
  normalizeCompositeDepth,
  type ControlResolver,
  type ExpandOptions,
} from './expand'
