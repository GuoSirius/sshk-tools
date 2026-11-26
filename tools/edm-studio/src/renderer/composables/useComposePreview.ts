import { computed, ref, watch, type ComputedRef, type Ref } from 'vue'
import { ElMessage } from 'element-plus'
import * as yaml from 'js-yaml'
import type { PlacementItem, SlotDef } from '../compose-types'
import { normalizeFields, type FieldDef } from '../sample-schema'
import { api } from '../tool-api'
import { mergeFragmentPolicy, policyAllows, type FragmentPolicy } from '../../core/fragment-policy'
import { extractSlotKeysFromSource } from '../../core/slots'
import type { Source, TreeNode } from './useContentTree'

/**
 * 组合预览域（P6-4 自 ContentManagePage 拆出，搬代码不改行为）：
 * R19 组合预览（片段/模板统一入口）：宿主模板 + 片段摆放 → content:render placements；
 * R22 布局配置收进弹框（预览页只留预览）；placement 独立数据编辑（Q12：有 fields schema 用表单，否则 YAML）。
 */
export interface SysSelector { brandCode: string; kind: string; familyCode: string; versionDir: string }
interface FamilyMetaLite { policy?: FragmentPolicy; fields?: unknown[] }

export interface ComposePreviewDeps {
  selected: Ref<TreeNode | null>
  /** 双顶层树（树域持有）：按 source 定位品牌节点构造宿主模板/片段选项 */
  tree: ComputedRef<TreeNode[]>
  /** 版本 meta 原始对象（宿主模板选项按版本/族 policy 过滤） */
  metaRaw: Ref<Record<string, unknown> | null>
  read(file: string, source?: Source): Promise<string>
  previewHtml: Ref<string>
  previewing: Ref<boolean>
}

export interface ComposePreview {
  composeTemplate: Ref<string>
  composeSlots: Ref<SlotDef[]>
  composePlacements: Ref<PlacementItem[]>
  composeOpen: Ref<boolean>
  composeHostLabel: ComputedRef<string>
  hostTemplateOptions: ComputedRef<{ id: string; label: string; slots: SlotDef[] }[]>
  composeFragmentOptions: ComputedRef<{ id: string; label: string }[]>
  composeSlotDefs: ComputedRef<SlotDef[]>
  /** R19 组合预览初始化（原 onNode version 分支尾段）：片段=预置自身 placement（待选宿主模板）；模板=空布局 */
  resetForNode(node: TreeNode): void
  onHostTemplateChange(id: string): void
  renderComposePreview(): Promise<void>
  /** 完成布局配置：关弹框并刷新组合预览 */
  closeComposeDialog(): void
  placementData: Ref<{ open: boolean; uid: string; fields: FieldDef[]; data: Record<string, unknown> }>
  openPlacementData(item: PlacementItem): Promise<void>
  savePlacementData(data: Record<string, unknown>): void
  /** 预读全部族 meta（policy / slots / fields），组合预览选项构造用（后台不阻塞 load） */
  prefetchFamilyMetas(): Promise<void>
}

/** 模板族/版本播种 ID：统一品牌身份后双根同 code 属同品牌，policy 可配任一根 ID */
function templateIds(brand: string, fam: string, dir: string): string[] {
  const d = dir || 'default'
  return [
    `tpl_sys_${brand}_${fam}`, `tplv_sys_${brand}_${fam}_${d}`,
    `cus_tpl_${brand}_${fam}`, `cus_tplv_${brand}_${fam}_${d}`,
  ]
}

export function useComposePreview(deps: ComposePreviewDeps): ComposePreview {
  const composeTemplate = ref('') // 片段预览：宿主模板（id = JSON selector）
  const composeSlots = ref<SlotDef[]>([])
  const composePlacements = ref<PlacementItem[]>([])
  const familyMetaCache = ref<Record<string, FamilyMetaLite>>({})
  /** 版本级 policy 缓存：key = <族路径>/<版本目录>，与族 policy 叠加后参与过滤 */
  const versionPolicyCache = ref<Record<string, FragmentPolicy>>({})
  /** 模板 njk 源码里的 slot_* 缓存：key = <source>:<sourcePath>，源码保存后由 prefetch 刷新 */
  const templateSourceSlotCache = ref<Record<string, string[]>>({})
  /* R22：布局配置收进弹框（预览页只留预览，避免 header 过多挤占 iframe） */
  const composeOpen = ref(false)

  const composeHostLabel = computed(() => {
    const node = deps.selected.value
    if (!node) return ''
    if (node.data.cat !== 'fragment') return node.label
    return hostTemplateOptions.value.find((t) => t.id === composeTemplate.value)?.label ?? '未选（单渲本片段）'
  })

  /** 预读全部族 meta（policy / slots / fields），组合预览选项构造用（后台不阻塞 load） */
  async function prefetchFamilyMetas(): Promise<void> {
    const out: Record<string, FamilyMetaLite> = {}
    const vpol: Record<string, FragmentPolicy> = {}
    const tslots: Record<string, string[]> = {}
    const walk = async (nodes: TreeNode[]): Promise<void> => {
      for (const n of nodes) {
        if (n.kind === 'family' && n.data.metaPath) {
          try {
            out[n.data.path] = ((yaml.load(await deps.read(n.data.metaPath, n.data.source)) as Record<string, unknown>) ?? {}) as FamilyMetaLite
            // 片段族下每个版本的 policy 也预读，供「族 + 版本」叠加过滤
            // 模板族下每个版本预读 njk 里的 slot_*，让源码新增 slot 立即出现在布局配置/落点下拉
            for (const ver of n.children ?? []) {
              if (ver.kind !== 'version' || !ver.data.sourcePath) continue
              if (n.data.cat === 'fragment' && ver.data.metaPath) {
                try {
                  const vm = ((yaml.load(await deps.read(ver.data.metaPath, ver.data.source)) as Record<string, unknown>) ?? {}) as { policy?: FragmentPolicy }
                  vpol[`${n.data.path}/${ver.data.versionDir || 'default'}`] = vm.policy ?? {}
                } catch { /* 忽略单版本解析失败 */ }
              }
              if (n.data.cat === 'template') {
                try {
                  tslots[slotCacheKey(ver)] = extractSlotKeysFromSource(await deps.read(ver.data.sourcePath, ver.data.source))
                } catch { /* 忽略单版本源码读取失败 */ }
              }
            }
          } catch { /* 忽略单族解析失败 */ }
        }
        if (n.children) await walk(n.children)
      }
    }
    await walk(deps.tree.value)
    familyMetaCache.value = out
    versionPolicyCache.value = vpol
    templateSourceSlotCache.value = tslots
  }

  /** R24：按 source 定位品牌节点（双顶层树，根不再恒为 tree.value[0]） */
  function brandNodeOf(brandCode: string, source: Source): TreeNode | undefined {
    const root = deps.tree.value.find((r) => r.data.source === source)
    return root?.children?.find((n) => n.kind === 'brand' && n.data.brandCode === brandCode)
  }

  function versionSelector(node: TreeNode): SysSelector {
    return {
      brandCode: node.data.brandCode ?? '',
      kind: node.data.cat ?? '',
      familyCode: node.data.familyCode ?? '',
      versionDir: node.data.versionDir ?? '',
    }
  }

  /** 双根同路径需带 source 区分缓存键 */
  const slotCacheKey = (node: TreeNode): string => `${node.data.source}:${node.data.sourcePath ?? node.data.path}`

  /** #213：插槽唯一真相源 = njk 源码（按出现顺序），meta 声明与 type 已取消 */
  function slotDefsOf(versionNode: TreeNode | null): SlotDef[] {
    const keys = versionNode ? templateSourceSlotCache.value[slotCacheKey(versionNode)] ?? [] : []
    return keys.map((key) => ({ key, label: key }))
  }

  /** 片段预览：宿主模板选项（本品牌模板族×版本，按当前片段黑白名单过滤） */
  const hostTemplateOptions = computed<{ id: string; label: string; slots: SlotDef[] }[]>(() => {
    const node = deps.selected.value
    if (node?.kind !== 'version' || node.data.cat !== 'fragment') return []
    const brand = node.data.brandCode ?? ''
    const famPolicy = familyMetaCache.value[`${brand}/fragment/${node.data.familyCode}`]?.policy
    const policy = mergeFragmentPolicy(famPolicy, deps.metaRaw.value?.policy as FragmentPolicy | undefined)
    const out: { id: string; label: string; slots: SlotDef[] }[] = []
    const bNode = brandNodeOf(brand, node.data.source)
    const tplCat = bNode?.children?.find((n) => n.kind === 'category' && n.data.cat === 'template')
    for (const fam of tplCat?.children?.filter((n) => n.kind === 'family') ?? []) {
      const famCode = fam.data.familyCode ?? ''
      for (const ver of fam.children?.filter((n) => n.kind === 'version') ?? []) {
        const dir = ver.data.versionDir ?? ''
        if (!policyAllows(policy, templateIds(brand, famCode, dir))) continue
        out.push({
          id: JSON.stringify({ brandCode: brand, kind: 'template', familyCode: famCode, versionDir: dir }),
          label: `${fam.label} / ${ver.label}`,
          slots: slotDefsOf(ver),
        })
      }
    }
    return out
  })

  /** 组合编辑器的片段选项：片段预览=当前片段；模板预览=本品牌片段版本（族级 policy 过滤） */
  const composeFragmentOptions = computed<{ id: string; label: string }[]>(() => {
    const node = deps.selected.value
    if (node?.kind !== 'version') return []
    if (node.data.cat === 'fragment') return [{ id: JSON.stringify(versionSelector(node)), label: node.label }]
    const brand = node.data.brandCode ?? ''
    const famCode = node.data.familyCode ?? ''
    const dir = node.data.versionDir ?? ''
    const tplIds = templateIds(brand, famCode, dir)
    const out: { id: string; label: string }[] = []
    const bNode = brandNodeOf(brand, node.data.source)
    const fragCat = bNode?.children?.find((n) => n.kind === 'category' && n.data.cat === 'fragment')
    for (const fam of fragCat?.children?.filter((n) => n.kind === 'family') ?? []) {
      const famPolicy = familyMetaCache.value[fam.data.path]?.policy
      for (const ver of fam.children?.filter((n) => n.kind === 'version') ?? []) {
        const dir = ver.data.versionDir || 'default'
        const policy = mergeFragmentPolicy(famPolicy, versionPolicyCache.value[`${fam.data.path}/${dir}`])
        if (!policyAllows(policy, tplIds)) continue
        out.push({ id: JSON.stringify(versionSelector(ver)), label: `${fam.label} / ${ver.label}` })
      }
    }
    return out
  })

  /** 区块清单：片段预览=宿主模板 slots（选定后填充）；模板预览=本族 slots */
  const composeSlotDefs = computed<SlotDef[]>(() => {
    if (composeSlots.value.length) return composeSlots.value
    const node = deps.selected.value
    if (node?.kind === 'version' && node.data.cat === 'template') {
      return slotDefsOf(node)
    }
    return []
  })

  /** 宿主模板源码保存后 hostTemplateOptions 的 slots 变了，已选模板的落点下拉同步刷新（不清空选择） */
  watch(hostTemplateOptions, (options) => {
    if (!composeTemplate.value) return
    composeSlots.value = options.find((t) => t.id === composeTemplate.value)?.slots ?? []
  })

  /** R19 组合预览初始化（原 onNode version 分支尾段）：片段=预置自身 placement（待选宿主模板）；模板=空布局 */
  function resetForNode(node: TreeNode): void {
    composeSlots.value = []
    composeTemplate.value = ''
    composePlacements.value = node.data.cat === 'fragment'
      ? [{ uid: `p_${Date.now()}_0`, fragmentId: JSON.stringify(versionSelector(node)), label: node.label, slot: '', order: 0 }]
      : []
  }

  function onHostTemplateChange(id: string): void {
    composeSlots.value = hostTemplateOptions.value.find((t) => t.id === id)?.slots ?? []
    const first = composeSlots.value[0]?.key ?? ''
    composePlacements.value = composePlacements.value.map((p, i) => ({
      ...p,
      slot: composeSlots.value.some((s) => s.key === p.slot) ? p.slot : first,
      order: i,
    }))
    void renderComposePreview()
  }

  async function renderComposePreview(): Promise<void> {
    const node = deps.selected.value
    if (node?.kind !== 'version') return
    deps.previewing.value = true
    try {
      const templateSel = node.data.cat === 'fragment'
        ? (JSON.parse(composeTemplate.value || 'null') as SysSelector | null)
        : versionSelector(node)
      if (!templateSel?.familyCode) {
        ElMessage.warning('请先选择宿主模板')
        return
      }
      const placements = composePlacements.value.map((p) => ({
        selector: JSON.parse(p.fragmentId) as SysSelector,
        slot: p.slot,
        order: p.order,
        data: p.data,
      }))
      const res = (await api('content:render', { source: deps.selected.value?.data.source ?? 'system', selector: templateSel, placements })) as { html: string }
      deps.previewHtml.value = res.html
    } catch (err) {
      ElMessage.warning(`组合预览失败：${(err as Error).message}`)
    } finally {
      deps.previewing.value = false
    }
  }

  /** 完成布局配置：关弹框并刷新组合预览 */
  function closeComposeDialog(): void {
    composeOpen.value = false
    void renderComposePreview()
  }

  /* placement 独立数据编辑（Q12；#200 双 tab：表单/JSON 编辑统一在 PlacementDataDialog 内部） */
  const placementData = ref<{ open: boolean; uid: string; fields: FieldDef[]; data: Record<string, unknown> }>({
    open: false, uid: '', fields: [], data: {},
  })
  async function openPlacementData(item: PlacementItem): Promise<void> {
    let fields: FieldDef[] = []
    try {
      const sel = JSON.parse(item.fragmentId) as SysSelector
      const famPath = `${sel.brandCode}/${sel.kind}/${sel.familyCode}`
      const verPath = sel.versionDir ? `${famPath}/${sel.versionDir}` : famPath
      const verMeta = ((yaml.load(await deps.read(`${verPath}/meta.yaml`, deps.selected.value?.data.source ?? 'system')) as Record<string, unknown>) ?? {})
      fields = normalizeFields((verMeta['fields'] as unknown) ?? familyMetaCache.value[famPath]?.fields ?? [])
    } catch { /* 无 schema 走 JSON */ }
    placementData.value = { open: true, uid: item.uid, fields, data: { ...(item.data ?? {}) } }
  }
  function savePlacementData(data: Record<string, unknown>): void {
    const st = placementData.value
    composePlacements.value = composePlacements.value.map((p) => (p.uid === st.uid ? { ...p, data } : p))
    st.open = false
    void renderComposePreview()
  }

  return {
    composeTemplate, composeSlots, composePlacements, composeOpen, composeHostLabel,
    hostTemplateOptions, composeFragmentOptions, composeSlotDefs,
    resetForNode, onHostTemplateChange, renderComposePreview, closeComposeDialog,
    placementData, openPlacementData, savePlacementData,
    prefetchFamilyMetas,
  }
}
