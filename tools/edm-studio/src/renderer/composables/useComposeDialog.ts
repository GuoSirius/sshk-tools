/**
 * 统一组装弹框逻辑（2026-11-25 需求 3.9-3.13 / 修订 7/14）：
 * 一处实现三场景（mail 邮件组装 / template 模板预览 / fragment 片段预览）的联动选择、
 * 插槽编辑、预览与底部场景差异操作。本 composable 承载 mail 场景主干；
 * template/fragment 场景的树选择器由 ContentManagePage 侧适配后以 props 传入 ComposeDialog。
 *
 * 底部语义（修订 14）：
 * - mail：确认=保存数据；生成=先保存再生成；导出=依赖生成（未生成提示引导）；复制=final
 * - template/fragment：确认=保存并刷新预览（#189，不关弹框）；无生成；导出/复制当前预览
 */
import { computed, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { api } from '../tool-api'
import type { MailRow, VersionRow } from '../tool-api'
import { brands, fragments, frgvVersions, templates, tplVersionsAll } from '../store'
import type { FragmentOption, PlacementItem, SlotDef } from '../compose-types'
import { normalizeFields, type FieldDef } from '../sample-schema'
import { composeLabel, ensureComposeLabels } from './useComposeLabels'
import { formatNodeLabel } from './node-label'

export type ComposeScene = 'mail' | 'template' | 'fragment'

export interface ComposeDialogDeps {
  visible: () => boolean
  mail: () => MailRow | null
  onSaved: (id: string) => void
}

function policyAllows(policy: { blacklist?: string[]; whitelist?: string[] } | undefined, ids: string[]): boolean {
  if (!policy) return true
  if ((policy.blacklist ?? []).some((x) => ids.includes(x))) return false
  const wl = policy.whitelist ?? []
  if (wl.length === 0) return true
  return wl.some((x) => ids.includes(x))
}

/** 顶部级联：来源(自定义/系统)→品牌→模板→版本；来源按实体 origin 过滤 */
export function useComposeDialog(deps: ComposeDialogDeps) {
  const draft = ref<{
    _id: string
    name: string
    origin: 'system' | 'custom'
    brandId: string
    templateId: string
    templateVersionId: string
  }>({ _id: '', name: '', origin: 'custom', brandId: '', templateId: '', templateVersionId: '' })
  const placements = ref<PlacementItem[]>([])
  const mailDataText = ref('{}')
  const previewHtml = ref('')
  const previewing = ref(false)
  const saving = ref(false)
  const activeTab = ref<'slots' | 'preview'>('slots')
  let uidSeed = 0

  /** 来源切换：品牌选项按 origin 过滤；清空品牌/模板/布局/预览（联动铁律：上级变清空下级） */
  const originOptions = [
    { value: 'custom', label: '自定义' },
    { value: 'system', label: '系统自带' },
  ] as const

  const brandOptions = computed(() =>
    brands.value
      .filter((b) => (b as { origin?: string }).origin === draft.value.origin)
      .map((b) => ({ value: b._id, label: composeLabel('brands', b._id, formatNodeLabel(b.code, b.name)) })),
  )
  const allBrands = computed(() =>
    brands.value.map((b) => ({ value: b._id, label: composeLabel('brands', b._id, formatNodeLabel(b.code, b.name)) })),
  )

  /** 模板族下拉（#198 ④）：目录名（meta.name），按来源+品牌过滤 */
  const templateOptions = computed(() =>
    templates.value
      .filter((t) => (t as { origin?: string }).origin === draft.value.origin)
      .filter((t) => (t as { brandId?: string }).brandId === draft.value.brandId)
      .map((t) => ({ value: t._id, label: composeLabel('templates', t._id, t.name) })),
  )

  /** 版本下拉（#198 ④）：与模板拆开，目录名（meta.name），按所选模板族过滤 */
  const versionOptions = computed(() =>
    tplVersionsAll.value
      .filter((v) => v.templateId === draft.value.templateId && v.brandId === draft.value.brandId)
      .map((v) => ({ value: v._id, label: composeLabel('versions', v._id, formatNodeLabel(v.label || `v${v.version}`, v.name)) })),
  )

  const currentTv = computed<VersionRow | undefined>(() => tplVersionsAll.value.find((v) => v._id === draft.value.templateVersionId))
  const templateSlots = computed<SlotDef[]>(() =>
    (currentTv.value?.slots ?? []).map((s) => ({ key: s.key, label: s.type || s.key, type: s.type })),
  )
  const fragmentOptions = computed<FragmentOption[]>(() => {
    const tv = currentTv.value
    if (!tv) return []
    const ids = [tv._id, tv.templateId ?? '']
    const fragName = (fid: string): string => fragments.value.find((f) => f._id === fid)?.name ?? fid.slice(0, 10)
    return frgvVersions.value
      .filter((v) => v.brandId === draft.value.brandId)
      .filter((v) => policyAllows(v.policy, ids))
      .map((v) => ({ id: v._id, label: `${fragName(v.fragmentId ?? '')} / ${v.label ?? `v${v.version}`}`, type: v.type }))
  })

  function toPlacements(bindings: MailRow['bindings']): PlacementItem[] {
    return (bindings ?? []).map((b, i) => {
      const fv = frgvVersions.value.find((v) => v._id === b.fragmentVersionId)
      const fragName = fragments.value.find((f) => f._id === fv?.fragmentId)?.name ?? b.fragmentVersionId.slice(0, 10)
      return {
        uid: `p_${Date.now()}_${uidSeed++}`,
        fragmentId: b.fragmentVersionId,
        label: `${fragName} / ${fv?.label ?? ''}`,
        slot: b.slot,
        order: b.order ?? i,
        alias: b.alias,
        data: b.data,
      }
    })
  }

  watch(
    () => deps.visible(),
    (open) => {
      if (!open) return
      void ensureComposeLabels() // 异步补全三级下拉的「目录名（meta.name）」，首开加载一次
      const m = deps.mail()
      const tv = m ? tplVersionsAll.value.find((v) => v._id === m.templateVersionId) : undefined
      // 来源回显按模板版本 ID 前缀推导（tplv_sys_/cus_），修正历史数据 origin 与模板根不一致
      // 导致的二次打开下拉显示原始 ID（品牌/模板下拉按 origin 过滤后不含当前值）
      const origin = m?.templateVersionId
        ? m.templateVersionId.startsWith('cus_') ? 'custom' : 'system'
        : (m?.origin ?? 'custom')
      draft.value = m
        ? { _id: m._id, name: String(m.name ?? ''), origin, brandId: m.brandId ?? '', templateId: tv?.templateId ?? '', templateVersionId: m.templateVersionId ?? '' }
        : { _id: '', name: '', origin: 'custom', brandId: '', templateId: '', templateVersionId: '' }
      placements.value = m ? toPlacements(m.bindings) : []
      aliasTouched.value = false
      mailDataText.value = m?.data ? JSON.stringify(m.data, null, 2) : '{}'
      previewHtml.value = ''
      activeTab.value = 'slots'
    },
  )

  function onOriginChange(): void {
    draft.value.brandId = ''
    draft.value.templateId = ''
    draft.value.templateVersionId = ''
    placements.value = []
    previewHtml.value = ''
  }
  /** 跨品牌硬规定：切品牌清空模板族/版本与片段布局 */
  function onBrandChange(): void {
    draft.value.templateId = ''
    draft.value.templateVersionId = ''
    placements.value = []
    previewHtml.value = ''
  }
  /** 切模板族：清空版本（上级变清空下级），保留布局待版本定了再按 slot 校正 */
  function onTemplateFamilyChange(): void {
    draft.value.templateVersionId = ''
    previewHtml.value = ''
  }
  function onTemplateChange(): void {
    const first = templateSlots.value[0]?.key ?? ''
    placements.value = placements.value.map((p, i) => ({
      ...p,
      slot: templateSlots.value.some((s) => s.key === p.slot) ? p.slot : first,
      order: i,
    }))
    if (activeTab.value === 'preview') void refreshPreview()
  }

  function parseMailData(): Record<string, unknown> {
    try {
      return (JSON.parse(mailDataText.value) as Record<string, unknown>) ?? {}
    } catch {
      return {}
    }
  }

  async function refreshPreview(): Promise<void> {
    if (!draft.value.templateVersionId) return
    previewing.value = true
    try {
      const res = (await api('mail:preview', {
        templateVersionId: draft.value.templateVersionId,
        placements: placements.value.map((p) => ({
          fragmentVersionId: p.fragmentId, slot: p.slot, order: p.order, data: p.data,
        })),
        mailData: parseMailData(),
      })) as { html: string }
      previewHtml.value = res.html
    } catch (err) {
      ElMessage.warning(`预览失败：${(err as Error).message}`)
    } finally {
      previewing.value = false
    }
  }

  function buildPayload(): Record<string, unknown> {
    return {
      _id: draft.value._id,
      name: draft.value.name.trim(),
      origin: draft.value.origin,
      brandId: draft.value.brandId,
      templateVersionId: draft.value.templateVersionId,
      bindings: placements.value.map((p) => ({
        slot: p.slot, fragmentVersionId: p.fragmentId, order: p.order, alias: p.alias, data: p.data,
      })),
      data: parseMailData(),
    }
  }

  async function persist(): Promise<string> {
    await api('mail:save', buildPayload())
    return draft.value._id
  }

  /** 备注名校验（2026-11-25 用户反馈）：每个 placement 必填别名，保存尝试后未填的标红；
   *  前端校验失败直接停留、不发 IPC（双层校验铁律） */
  const aliasTouched = ref(false)
  const aliasErrors = computed<Set<string>>(() => {
    if (!aliasTouched.value) return new Set()
    return new Set(placements.value.filter((p) => !p.alias?.trim()).map((p) => p.uid))
  })
  function checkAlias(): boolean {
    aliasTouched.value = true
    const missing = placements.value.filter((p) => !p.alias?.trim()).length
    if (missing) {
      ElMessage.warning(`${missing} 个片段未填备注名，无法区分同片段的多次使用`)
      return false
    }
    return true
  }

  /** 确认（修订 14）：mail 场景=保存数据（不刷新预览、不关弹框由调用方决定） */
  async function doConfirm(): Promise<void> {
    if (!draft.value.name.trim() || !draft.value.brandId || !draft.value.templateVersionId) {
      ElMessage.warning('名称、品牌、模板版本必填')
      return
    }
    if (!checkAlias()) return
    saving.value = true
    try {
      const id = await persist()
      ElMessage.success('邮件数据已保存')
      deps.onSaved(id)
    } catch (err) {
      ElMessage.error(`保存失败：${(err as Error).message}`)
    } finally {
      saving.value = false
    }
  }

  /** 生成（修订 14）：先保存再生成 */
  async function doGenerate(): Promise<void> {
    if (!draft.value.name.trim() || !draft.value.brandId || !draft.value.templateVersionId) {
      ElMessage.warning('名称、品牌、模板版本必填'); return
    }
    if (!checkAlias()) return
    saving.value = true
    try {
      const id = await persist()
      await api('mail:generate', { _id: id })
      ElMessage.success('已保存并生成四阶段产物')
      deps.onSaved(id)
    } catch (err) {
      ElMessage.error(`生成失败：${(err as Error).message}`)
    } finally {
      saving.value = false
    }
  }

  /** 导出（修订 14）：依赖生成——未生成提示引导，已生成走 osApi 选路径导出四形态 */
  async function doExport(row: MailRow | null): Promise<void> {
    const id = row?._id || draft.value._id
    if (!id) { ElMessage.warning('请先保存邮件'); return }
    const { osApi } = await import('../tool-api')
    const save = await osApi().pickSave({ fileName: `${draft.value.name || 'mail'}.zip`, extensions: ['zip'] })
    if (!save) return
    try {
      const res = (await api('mail:export', { ids: [id], outPath: save })) as { count: number; outPath: string }
      ElMessage.success(`已导出 ${res.count} 封：${res.outPath}`)
    } catch (err) {
      ElMessage.warning(`导出失败（请先生成产物）：${(err as Error).message}`)
    }
  }

  /** 复制（修订 7）：固定复制最终压缩产物 final */
  async function doCopy(row: MailRow | null): Promise<void> {
    const id = row?._id || draft.value._id
    if (!id) { ElMessage.warning('请先保存邮件'); return }
    const { osApi } = await import('../tool-api')
    try {
      const html = await api<string>('mail:readOutput', { _id: id, form: 'final' })
      await osApi().clipboardWrite(html)
      ElMessage.success(`已复制最终代码（${html.length} 字符）`)
    } catch (err) {
      ElMessage.warning(`复制失败（请先生成产物）：${(err as Error).message}`)
    }
  }

  /** 切到预览 tab 时即时渲染（模板数据 CodeEditor 的 Ctrl+S 也走此） */
  function switchTab(tab: 'slots' | 'preview'): void {
    activeTab.value = tab
    if (tab === 'preview') void refreshPreview()
  }
  function onDataEditorSave(): void {
    void refreshPreview()
  }

  /* placement 独立数据编辑（Q12；#200 双 tab：表单/JSON 编辑统一在 PlacementDataDialog 内部） */
  const placementData = ref<{ open: boolean; uid: string; fields: FieldDef[]; data: Record<string, unknown> }>({
    open: false, uid: '', fields: [], data: {},
  })
  function openPlacementData(item: PlacementItem): void {
    const fv = frgvVersions.value.find((v) => v._id === item.fragmentId)
    const fields = normalizeFields((fv?.fields as unknown) ?? [])
    placementData.value = { open: true, uid: item.uid, fields, data: { ...(item.data ?? fv?.sampleData ?? {}) } }
  }
  function savePlacementData(data: Record<string, unknown>): void {
    const st = placementData.value
    placements.value = placements.value.map((p) => (p.uid === st.uid ? { ...p, data } : p))
    st.open = false
    void refreshPreview()
  }

  return {
    scene: 'mail' as ComposeScene,
    draft, placements, mailDataText, previewHtml, previewing, saving, activeTab,
    originOptions, brandOptions, allBrands, templateOptions, versionOptions, templateSlots, fragmentOptions, currentTv, aliasErrors,
    onOriginChange, onBrandChange, onTemplateFamilyChange, onTemplateChange, switchTab, onDataEditorSave,
    refreshPreview, buildPayload, doConfirm, doGenerate, doExport, doCopy,
    placementData, openPlacementData, savePlacementData,
    /**
     * 供 MailsPage 查询当前邮件是否有产物（导出依赖生成的前置提示用）；
     * 这里不直接访问 store，由调用方传入 mail 行判断。
     */
    hasOutput: (row: MailRow | null) => Boolean(row?.outputs?.final),
  }
}
