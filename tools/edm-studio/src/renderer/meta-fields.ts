import * as yaml from 'js-yaml'
import type { FieldDef } from './sample-schema'

/**
 * meta.yaml 的 fields 块序列化 / 替换（R15 字段设计器写回用）。
 * 采用「外科手术式」文本替换：只动顶层 `fields:` 块，保留其余键与手写注释，
 * 避免整文件 yaml.dump 把注释和既有结构全冲掉。
 */

/** 序列化为顶层 `fields:` 块（2 空格缩进） */
export function fieldsBlock(fields: FieldDef[]): string {
  if (fields.length === 0) return 'fields: []'
  const body = yaml
    .dump(fields, { indent: 2, lineWidth: -1, noRefs: true })
    .split('\n')
    .filter((l) => l !== '')
    .map((l) => `  ${l}`)
    .join('\n')
  return `fields:\n${body}`
}

/**
 * 外科手术式替换 meta.yaml 顶层标量字段（重命名时同步 code 用）：保留注释与其余键。
 * 值统一 JSON 引号写出，避免特殊字符破坏 YAML；缺失则追加到文末。
 */
export function replaceTopLevelField(raw: string, key: string, value: string): string {
  const lines = raw.replace(/\r\n/g, '\n').split('\n')
  const idx = lines.findIndex((l) => new RegExp(`^${key}:(\\s|$)`).test(l))
  const line = `${key}: ${JSON.stringify(value)}`
  if (idx === -1) return `${raw.replace(/\s+$/, '')}\n${line}\n`
  lines[idx] = line
  return `${lines.join('\n')}\n`
}

/** 补齐 meta.yaml 缺失的 code/name（保留注释与其余键），供后端必填校验前的兜底 */
export function withMetaIdentity(raw: string, code: string, name: string): string {
  let out = raw
  let parsed: Record<string, unknown> = {}
  try {
    parsed = (yaml.load(out) as Record<string, unknown>) ?? {}
  } catch {
    /* 非法 YAML 交给后续正规流程报错，这里不覆盖原文 */
    return out
  }
  if (typeof parsed['code'] !== 'string' || !parsed['code'].trim()) out = replaceTopLevelField(out, 'code', code)
  if (typeof parsed['name'] !== 'string' || !parsed['name'].trim()) out = replaceTopLevelField(out, 'name', name)
  return out
}

/** 在 meta.yaml 原文中替换顶层 `fields:` 块；不存在则追加到文末 */
export function replaceFieldsInMeta(raw: string, fields: FieldDef[]): string {
  const lines = raw.replace(/\r\n/g, '\n').split('\n')
  let start = -1
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i]
    if (ln !== undefined && /^fields:(\s.*)?$/.test(ln)) {
      start = i
      break
    }
  }
  const replacement = fieldsBlock(fields)
  if (start === -1) {
    const trimmed = raw.replace(/\s+$/, '')
    return `${trimmed}\n\n${replacement}\n`
  }
  // 找到块尾：下一个顶层（缩进为 0）行或文件结束
  let end = start + 1
  while (end < lines.length) {
    const ln = lines[end]
    if (ln === undefined || !/^ {1,}\S/.test(ln)) break
    end++
  }
  lines.splice(start, end - start, replacement)
  return `${lines.join('\n')}\n`
}
