/**
 * 组装弹框三级下拉的统一标签来源（#198 ④）：品牌 / 模板族 / 版本一律「目录名（meta.name）」。
 * 与左树 formatNodeLabel 同一口径，避免下拉显示 name（code）反序或只有裸目录名。
 *
 * 为什么需要它：repo 实体里品牌有 code+name，但模板族只有 name（meta.name，缺目录名）、
 * 版本只有 label（目录名，缺 meta.name）。两者都补齐不了「目录名（meta.name）」，
 * 故从内容树（system + custom 双根，真相源）按实体 ID 规则建映射，模块级单例缓存。
 */
import { ref } from 'vue'
import { api } from '../tool-api'
import { formatNodeLabel } from './node-label'

export interface ComposeLabels {
  brands: Map<string, string>
  templates: Map<string, string>
  versions: Map<string, string>
}

const labels = ref<ComposeLabels>({ brands: new Map(), templates: new Map(), versions: new Map() })
let loaded = false
let loading: Promise<void> | null = null

/** 与 edm-seed / template.ts 一致的实体 ID 规则 */
const brandId = (code: string): string => `brd_${code}`
const tplId = (source: string, brand: string, fam: string): string =>
  `${source === 'system' ? 'tpl_sys' : 'cus_tpl'}_${brand}_${fam}`
const tplvId = (source: string, brand: string, fam: string, dir: string): string =>
  `${source === 'system' ? 'tplv_sys' : 'cus_tplv'}_${brand}_${fam}_${dir || 'default'}`

interface TreeVersion { dir?: string; meta?: { name?: string } }
interface TreeFamily { code: string; meta?: { name?: string }; versions?: TreeVersion[] }
interface TreeBrand { code: string; meta?: { name?: string }; templates?: TreeFamily[] }
interface TreeModel { brands?: TreeBrand[] }

async function doLoad(): Promise<void> {
  const next: ComposeLabels = { brands: new Map(), templates: new Map(), versions: new Map() }
  for (const source of ['system', 'custom'] as const) {
    let model: TreeModel | null = null
    try {
      model = (await api('content:load', { source })) as TreeModel
    } catch { continue }
    for (const b of model?.brands ?? []) {
      next.brands.set(brandId(b.code), formatNodeLabel(b.code, b.meta?.name))
      for (const fam of b.templates ?? []) {
        next.templates.set(tplId(source, b.code, fam.code), formatNodeLabel(fam.code, fam.meta?.name))
        for (const v of fam.versions ?? []) {
          next.versions.set(tplvId(source, b.code, fam.code, v.dir ?? ''), formatNodeLabel(v.dir || 'default', v.meta?.name))
        }
      }
    }
  }
  labels.value = next
  loaded = true
}

/** 首次调用加载双根内容树建映射；并发复用同一个 Promise，失败允许下次重试 */
export async function ensureComposeLabels(): Promise<void> {
  if (loaded) return
  if (!loading) loading = doLoad().finally(() => { loading = null })
  await loading
}

/** 取实体显示名；未命中时回落到传入兜底（实体自身的 name / label） */
export function composeLabel(kind: 'brands' | 'templates' | 'versions', id: string, fallback: string): string {
  return labels.value[kind].get(id) ?? (fallback || id)
}
