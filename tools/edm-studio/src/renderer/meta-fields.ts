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
