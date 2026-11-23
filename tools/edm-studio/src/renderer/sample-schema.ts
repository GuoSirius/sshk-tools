/**
 * EDM 侧兼容 shim（plans/13 B0，2026-11-23）：表单 schema 真相源已重组抽离到 @sshk/form-schema
 * （按职责分层：schema/catalog/validate/normalize/yaml/expand）。本文件仅做旧名 re-export，
 * EDM 内部 import 零破坏；新代码一律直接从 @sshk/form-schema 引入。
 */
export * from '@sshk/form-schema'
export type { FieldDef, FieldOption, FieldType, TableColumn } from '@sshk/form-schema'
