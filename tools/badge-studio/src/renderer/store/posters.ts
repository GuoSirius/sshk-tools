import { computed, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import type { ShareRouteInfo } from '@sshk/shared'
import { IPC_CHANNELS, isExpiresAlive, toFileName } from '@sshk/shared'
import { callHostApi, type HostApiSpec } from '@sshk/ui-kit'
import { readShareTicket } from '@sshk/share-core/ui'
import { host } from '../host'
import { configKey, toolId } from './base'

/**
 * 海报列表域 store（P6-5 自 state.ts 三分拆出，模块级单例语义不变）：
 * 海报集合 + N5 源更新检测 + 列表级导出/删除 + 分享链接组（列表分享/行级复制链接/链接状态）。
 * 当前海报 id（currentPosterId）与门控（currentGenerated）随本域——workspace 生成/编辑回填与
 * openShare 门控都读它，依赖方向恒为 workspace → posters，无环。
 */

// ── 海报集合 + N5 源更新检测 ──
export const posters = ref<PosterRecord[]>([])
export const listLoading = ref(false)
// P6-1：分页游标与批量勾选改由 PostersPage 的 useTablePage/useSelection 页内承载（§七单一真相），
// state 只持有数据集合与加载态；批量导出/删除改为显式接收勾选行集合（页面从 selection 反查）。

export async function loadPosters(): Promise<void> {
  listLoading.value = true
  try {
    posters.value = ((await host.badge.listPosters()) as PosterRecord[]).filter((p) => !p.archived)
    // N5 源更新检测：mail 型海报对比源邮件当前 sourceHash
    try {
      const res = (await host.badge.sourceState({})) as { rows: { posterId: string; stale: boolean; sourceRel: string | null }[] }
      const map: Record<string, { stale: boolean; sourceRel: string | null }> = {}
      for (const row of res.rows) map[row.posterId] = { stale: row.stale, sourceRel: row.sourceRel }
      sourceStates.value = map
    } catch {
      sourceStates.value = {}
    }
  } finally {
    listLoading.value = false
  }
}

/** N5 行级源状态（stale=源邮件已重新生成）与一键重新打标 */
export const sourceStates = ref<Record<string, { stale: boolean; sourceRel: string | null }>>({})
export const staleCount = computed(() => Object.values(sourceStates.value).filter((s) => s.stale).length)

// ── 当前海报（工作区正编辑的海报；生成/编辑回填由 workspace 域写入）──
export const currentPosterId = ref('')
/** 用户 2026-11-19 流程门控：当前工作区海报是否「已生成」（存在 badge 副本产物）。
 *  只填海报名点保存创建的草稿记录没有 outputs.badged → 截图/下载/分享保持禁用；
 *  生成成功（或编辑已生成海报回显）后置真。 */
export const currentGenerated = computed(() => {
  const row = posters.value.find((p) => p._id === currentPosterId.value)
  return Boolean(row?.outputs?.badged)
})

// ── 海报列表管理：导出 / 批量删除导出（交互范本，EDM 复用）──

export async function exportPosterHtml(row: PosterRecord): Promise<void> {
  if (!row.outputs.badged) return
  const posterDir = (await host.config.get(configKey('posterDir'))) as string | null
  const save = await host.os.pickSave({
    fileName: (row.name || 'poster') + '.zip',
    extensions: ['zip'],
    defaultPath: posterDir || undefined,
  })
  if (!save) return
  const { outPath, posters: count } = (await host.badge.exportFiles({ posterIds: [row._id], outPath: save })) as { outPath: string; posters: number }
  ElMessage.success('已导出 ' + count + ' 个海报（HTML + 长图）：' + outPath)
}

export async function batchExportHtml(selected: PosterRecord[]): Promise<void> {
  const rows = selected.filter((row) => row.outputs.badged)
  if (rows.length === 0) { ElMessage.warning('请先勾选要导出的海报')
    return }
  const date = toFileName()
  const posterDir = (await host.config.get(configKey('posterDir'))) as string | null
  const save = await host.os.pickSave({
    fileName: 'sshk-posters-' + date + '.zip',
    extensions: ['zip'],
    defaultPath: posterDir || undefined,
  })
  if (!save) return
  const { outPath, posters: count } = (await host.badge.exportFiles({ posterIds: rows.map((row) => row._id), outPath: save })) as { outPath: string; posters: number }
  ElMessage.success('已批量导出 ' + count + ' 个海报（HTML + 长图，按名称分目录）：' + outPath)
}

export async function batchDeletePosters(rows: PosterRecord[]): Promise<void> {
  if (rows.length === 0) { ElMessage.warning('请先勾选要删除的海报')
    return }
  for (const row of rows) await host.badge.deletePoster(row._id)
  ElMessage.success('已删除 ' + rows.length + ' 个')
  await loadPosters()
}

export async function copyCode(row: PosterRecord): Promise<void> {
  if (!row.outputs.badged) return
  const { html } = await host.badge.readHtml(row.outputs.badged)
  await host.os.clipboardWrite(html)
  ElMessage.success('badged.html 代码已复制')
}

export const deleteOpen = ref(false)
export const deleteTarget = ref<PosterRecord | null>(null)

export async function confirmDelete(): Promise<void> {
  if (deleteTarget.value) {
    await host.badge.deletePoster(deleteTarget.value._id)
    await loadPosters()
    ElMessage.success('已删除（产物文件保留）')
  }
  deleteOpen.value = false
}

/** 表格行下载：导出已截图的 poster.png（条件显示 = outputs.poster 存在） */
export async function downloadPosterPng(row: PosterRecord): Promise<void> {
  if (!row.outputs.poster) { ElMessage.warning('该海报尚未截图保存 PNG'); return }
  const save = await host.os.pickSave({ fileName: (row.name || 'poster') + '.png', extensions: ['png'] })
  if (!save) return
  const { outPath } = await host.badge.downloadPng({ posterId: row._id, outPath: save })
  ElMessage.success('已下载：' + outPath)
}

// ── 海报分享（plans/09 ShareHub）：工具只解析产物绝对路径，分享本体交给宿主 ShareHub + ui-kit ShareDialog ──
/** ShareDialog 参数状态：open 控制显隐，其余为当前海报解析出的绝对路径/标签。 */
export const shareDialog = reactive({
  open: false,
  root: '',
  entry: '',
  label: '',
  loading: false,
})

/** 打开分享对话框：先经 badge main 把 posterId 解析为产物绝对路径（工具最清楚 outputRoot 布局）。
 *  门控（用户 2026-11-19）：生成后才可分享。 */
export async function openShare(poster: Pick<PosterRecord, '_id' | 'name'>): Promise<void> {
  if (!currentGenerated.value) {
    ElMessage.warning('请先生成海报（分享的是 badge 副本产物）')
    return
  }
  shareDialog.loading = true
  try {
    const resolved = await host.badge.shareResolve({ posterId: poster._id }) as { root: string; entry: string; label: string }
    Object.assign(shareDialog, {
      open: true,
      root: resolved.root,
      entry: resolved.entry,
      label: resolved.label || `海报：${poster.name}`,
    })
  } catch (err) {
    ElMessage.error((err as Error).message)
  } finally {
    shareDialog.loading = false
  }
}

// ── 列表级分享 + 行级复制链接（用户 2026-11-18）──────────────────────────
// 顶部「分享列表」= root 为产物根、entry 为空的目录分享（顶部长时效/永久为主）；
// 行「复制链接」优先取该行自己的分享（更多 → 分享页面创建），否则用列表前缀 + 行产物相对路径。

/** shareHub.list 通道 spec：复制前校验路由仍在（撤销/过期不复制死链） */
const SHARE_LIST_SPEC: HostApiSpec = { group: 'shareHub', method: 'list', channel: IPC_CHANNELS.shareHubList, label: '分享路由列表' }
const LIST_SHARE_LABEL = '海报列表'

/** 打开列表分享对话框（右上角「分享列表」）：root=产物根（一份公用票），其 URL 即「短链前缀」；
 *  前缀本身单独打开是目录列表页，但行级「复制链接」永远复制 前缀+本行路径 的直达链接，不是目录。TTL 弹框内自调（0=永久） */
export async function openListShare(): Promise<void> {
  shareDialog.loading = true
  try {
    const resolved = await host.badge.shareResolve({ posterId: '' }) as { root: string; entry: string; label: string }
    Object.assign(shareDialog, { open: true, root: resolved.root, entry: resolved.entry, label: resolved.label })
  } catch (err) {
    ElMessage.error((err as Error).message)
  } finally {
    shareDialog.loading = false
  }
}

/** 校验路由存活并返回路由信息（撤销/过期判死；list 失败时信任本地未过期记录，password 未知按无口令拼） */
async function findAliveRoute(toolIdValue: string, ticket: { id: string; token: string; expiresAt: number }): Promise<ShareRouteInfo | null> {
  if (!isExpiresAlive(ticket.expiresAt)) return null
  try {
    const routes = await callHostApi<ShareRouteInfo[]>(SHARE_LIST_SPEC, toolIdValue)
    const hit = routes.find((r) => r.id === ticket.id)
    if (!hit) return null
    if (!isExpiresAlive(hit.expiresAt)) return null
    return hit
  } catch {
    // list 不可用（如宿主桥接旧）时退化为信任本地票：只保「能复制」，不保口令拼接
    return { id: ticket.id, token: ticket.token, urls: [], expiresAt: ticket.expiresAt, password: '' } as unknown as ShareRouteInfo
  }
}

/** 拼「前缀+相对路径」直达链接：路径逐段编码（中文/空格），带口令的路由补 ?ak=（否则 403）。
 *  2026-11-19 修正：内核访问密钥查询参数已由 ?key= 改名 ?ak=（plans/09），此处同步——旧 ?key= 会被内核忽略导致 403。 */
function buildShareUrl(prefix: string, relPath: string, route: ShareRouteInfo | null): string {
  const base = prefix.replace(/\/+$/, '') + '/' + relPath.split('/').map(encodeURIComponent).join('/')
  const key = route && typeof route.password === 'string' && route.password ? `?ak=${encodeURIComponent(route.password)}` : ''
  return base + key
}

/** 行级「复制链接」（用户 2026-11-18 定版）：
 *  ① 本行自己的分享页面（更多→分享页面创建，TTL 自定）存活 → 复制它；
 *  ② 否则用顶部「分享列表」生成的公用前缀 + 本行产物相对路径 → 直达本行的短链；
 *  ③ 都没有 → 引导去生成。绝不复制裸前缀（目录页）链接。 */
export async function copyPosterLink(row: PosterRecord): Promise<void> {
  const resolved = await host.badge.shareResolve({ posterId: row._id }) as { root: string; entry: string; label: string }
  // ① 本行自己的分享
  const own = readShareTicket(toolId.value, resolved.label, resolved.root, resolved.entry)
  const ownRoute = own && await findAliveRoute(toolId.value, own)
  if (own && ownRoute && own.urls[0]) {
    await host.os.clipboardWrite(buildShareUrl(own.urls[0], '', ownRoute))
    ElMessage.success('已复制本海报的专属分享链接')
    return
  }
  // ② 列表分享前缀 + 本行产物相对路径
  const list = readShareTicket(toolId.value, LIST_SHARE_LABEL, resolved.root, '')
  const listRoute = list && await findAliveRoute(toolId.value, list)
  if (list && listRoute && list.urls[0] && resolved.entry) {
    await host.os.clipboardWrite(buildShareUrl(list.urls[0], resolved.entry, listRoute))
    ElMessage.success('已复制分享链接（列表前缀 + 本海报）')
    return
  }
  ElMessage.warning('还没有可用分享：点右上角「分享列表」生成链接前缀，或在「更多 → 分享页面」为本海报单独分享')
}

// ── 列表「链接」列（用户 2026-11-18：产物列取消，改为 可访问性 tag + 链接类型 tag）──
// 链接类型 = 复制链接将使用的来源（自身票优先 → 顶部列表前缀）；可访问性 = 该票是否存活。

const shareRoot = ref('')
const shareRouteRows = ref<ShareRouteInfo[]>([])

/** 刷新分享路由快照（进页面 / 分享弹框关闭后调用） */
export async function refreshShareLinks(): Promise<void> {
  try {
    const resolved = await host.badge.shareResolve({ posterId: '' }) as { root: string }
    shareRoot.value = resolved.root
    shareRouteRows.value = await callHostApi<ShareRouteInfo[]>(SHARE_LIST_SPEC, toolId.value)
  } catch {
    shareRoot.value = ''
    shareRouteRows.value = []
  }
}

function routeAlive(id: string): boolean {
  return shareRouteRows.value.some((r) => r.id === id && isExpiresAlive(r.expiresAt))
}

/** 行链接状态：类型（自身/顶部/未分享）+ 可访问性（可访问/已失效）。语义与 copyPosterLink 的取链优先级一致 */
export function posterLinkState(row: PosterRecord): { type: '自身' | '顶部' | null; alive: boolean } {
  // 显式建立对路由快照的响应式依赖：refreshShareLinks 每次替换新数组必须触发行内重算——
  // 否则 localStorage 票（非响应式）+ shareRoot 值不变时，新建分享后表格不重渲染、复制链接不出现（2026-11-18 实测根因）
  void shareRouteRows.value
  if (!shareRoot.value) return { type: null, alive: false }
  const entry = (row.outputs.badged ?? '').replaceAll('\\', '/').replace(/^\/+/, '')
  if (!entry) return { type: null, alive: false }
  const own = readShareTicket(toolId.value, `海报：${row.name}`, shareRoot.value, entry)
  const list = readShareTicket(toolId.value, LIST_SHARE_LABEL, shareRoot.value, '')
  const ownAlive = Boolean(own && routeAlive(own.id))
  const listAlive = Boolean(list && routeAlive(list.id))
  if (ownAlive) return { type: '自身', alive: true }
  if (listAlive) return { type: '顶部', alive: true }
  if (own) return { type: '自身', alive: false }
  if (list) return { type: '顶部', alive: false }
  return { type: null, alive: false }
}
