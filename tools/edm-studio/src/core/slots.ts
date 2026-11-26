/**
 * 模板 slot 契约的源码侧提取（#213 定稿：njk 源码为唯一真相源）。
 *
 * 族 meta.yaml 不再维护 slots（否则 njk 增删改无法同步），插槽清单与顺序
 * 完全由 `{{ slot_<key> | safe }}` 在源码中的出现顺序决定。片段族也不再维护
 * type：片段不预先绑定插槽类型，可应用到任何位置。
 *
 * 本模块只做纯文本提取，不读写文件、不依赖 Vue / renderer 类型。
 */

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
