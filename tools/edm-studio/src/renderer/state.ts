import { ref } from 'vue'
import type { BrandRow, MailRow, Named, VersionRow } from './shared'
import { api } from './shared'

/**
 * EDM 共享集合状态（模块级单例）：跨页面依赖（模板版本 → 邮件、品牌 → 模板/片段）
 * 全部收口在此，页面各自 import 所需集合；shell 挂载时 ensureLoaded 一次。
 */
export const brands = ref<BrandRow[]>([])
export const templates = ref<Named[]>([])
export const tplVersions = ref<VersionRow[]>([])
export const currentTpl = ref<Named | null>(null)
export const fragments = ref<Named[]>([])
export const mails = ref<MailRow[]>([])

export async function loadBrands(): Promise<void> {
  brands.value = (await api('brand:list')) as BrandRow[]
}
export async function loadTemplates(): Promise<void> {
  templates.value = (await api('tpl:list')) as Named[]
}
export async function selectTemplate(row: Named): Promise<void> {
  currentTpl.value = row
  // 模板版本列表：取该模板族最新版本（简化：单版本回显）
  tplVersions.value = ((await api('tplv:get', { _id: row.latestVersionId ?? '' })) ? [await api('tplv:get', { _id: row.latestVersionId })] : []) as VersionRow[]
}
export async function loadFragments(): Promise<void> {
  fragments.value = (await api('frg:list')) as Named[]
}
export async function loadMails(): Promise<void> {
  mails.value = (await api('mail:list')) as MailRow[]
}

let loaded = false
export async function ensureLoaded(): Promise<void> {
  if (loaded) return
  loaded = true
  await loadBrands()
  await loadTemplates()
  await loadFragments()
  await loadMails()
}
