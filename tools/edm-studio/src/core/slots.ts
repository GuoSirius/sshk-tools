/**
 * 模板 slot 契约的源码侧补充（2026-11-23）：
 * 族 meta.yaml 的 slots: 仍是声明真相（带 type / label），但用户在 njk 源码里
 * 直接新增 `{{ slot_<key> | safe }}` 时，布局配置也应当立刻出现该区块，
 * 否则「源码加了 slot → 落点区块下拉没有这一项」。
 *
 * 本模块只做纯文本提取与合并，不读写文件、不依赖 Vue / renderer 类型。
 */
export interface SourceSlotDef {
  key: string
  label?: string
  type?: string
}

/** 按出现顺序提取 njk 中的 `{{ slot_<key> }}` / `{{ slot_<key> | safe }}`，去重 */
export function extractSlotKeysFromSource(html: string): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  const re = /\{\{\s*slot_([A-Za-z_][\w-]*)\s*(?:\||\}\})/g
  for (const m of html.matchAll(re)) {
    const key = m[1]
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(key)
  }
  return out
}

/** 已声明 slots 优先保留，源码新增的 key 以自身 key 为 label 补到末尾 */
export function mergeSourceSlots(declared: SourceSlotDef[], sourceKeys: string[]): SourceSlotDef[] {
  const out = declared.map((s) => ({ ...s }))
  const seen = new Set(out.map((s) => s.key))
  for (const key of sourceKeys) {
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ key, label: key, type: '' })
  }
  return out
}
