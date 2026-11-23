import { osApi, shareHubApi, uploadApi } from './fsHost'
import { ref } from 'vue'
import { ElMessage } from 'element-plus'
import {
  type FsChannelInfo,
  type FsEntry,
  type ShareRouteInfo,
} from '@sshk/shared'
import {
  normalizeUploadConfig,
} from '@sshk/upload-core/types'
import { buildDirectUrl, findShareTicketById, isTicketAlive, shareFileDirectUrl } from '@sshk/share-core/ui'
import { isExpiresAlive, SHARE_PERMANENT_EXPIRES_AT } from '@sshk/shared'

/**
 * ShareHub 分享状态标记（用户 2026-11-19，P4-4 自 FileExplorerPage 拆出）：
 * 名称列内小图标区分「自己分享 / 随父级 / 未分享」；本地通道文件/目录统一走 ShareDialog（有 TTL、可撤销）。
 * 行为契约（与原页面逐字一致）：
 * - 数据源：本工具的有效分享路由（内核 list 自带 entry/allowIndex/expiresAt），无需读 localStorage 判定。
 * - 路径归一：FsEntry.path 带前导 /，route.entry 已去前导 /，统一去前导/尾斜杠后比较。
 * - 三态：own（自身路由）/ inherited（祖先路由覆盖，取最长匹配）/ none；allowIndex=false 的父路由
 *   对目录条目不覆盖（目录条目不可浏览），文件条目仍算 inherited（内核文件直达不受 allowIndex 限制）。
 * - 分享方案 C（用户 2026-11-19 定版）：每个条目各自生成独立分享（独立 TTL/撤销）。
 */

type ShareMark = 'none' | 'own' | 'inherited'
export interface ShareMarkInfo { kind: ShareMark; route?: ShareRouteInfo; parent?: ShareRouteInfo }

export function useFsShareMarks(deps: {
  toolId: () => string
  profileId: () => string
  activeChannel: () => FsChannelInfo | null
}) {
  const shareRoutes = ref<ShareRouteInfo[]>([])
  async function loadShareRoutes(): Promise<void> {
    try {
      shareRoutes.value = await shareHubApi.list(deps.toolId())
    }
    catch { shareRoutes.value = [] }
  }

  /** 路径归一：FsEntry.path 带前导 /，route.entry 已去前导 /，统一去前导/尾斜杠后比较 */
  function normSharePath(p: string): string {
    return String(p ?? '').replaceAll('\\', '/').replace(/^\/+/, '').replace(/\/+$/, '')
  }
  /** 三态：自身有路由=own；否则祖先路由覆盖=inherited（取最长匹配=最近父级）；否则 none */
  function shareMarkOf(entry: FsEntry): ShareMarkInfo {
    if (!shareRoutes.value.length || deps.activeChannel()?.type !== 'local') return { kind: 'none' }
    const rel = normSharePath(entry.path)
    const own = shareRoutes.value.find((r) => normSharePath(r.entry) === rel)
    if (own) return { kind: 'own', route: own }
    let best: ShareRouteInfo | undefined
    for (const r of shareRoutes.value) {
      // 目录条目 + 父未开目录浏览 → 该父路由不覆盖（子目录/孙目录不显示链接）
      if (r.allowIndex === false && entry.kind === 'dir') continue
      const dir = normSharePath(r.entry)
      if (dir && rel.startsWith(dir + '/')) {
        if (!best || dir.length > normSharePath(best.entry).length) best = r
      }
    }
    return best ? { kind: 'inherited', parent: best } : { kind: 'none' }
  }
  /** 悬浮说明文案（图标统一 Connection，靠文案区分三态来源） */
  function shareMarkTip(entry: FsEntry): string {
    const m = shareMarkOf(entry)
    if (m.kind === 'own') {
      const r = m.route!
      const life = !isExpiresAlive(r.expiresAt) ? '已过期' : r.expiresAt === SHARE_PERMANENT_EXPIRES_AT ? '永久' : `剩余 ${Math.max(0, Math.round((r.expiresAt - Date.now()) / 3600000))} 小时`
      return `自己的分享（${life}${r.allowIndex !== false && entry.kind === 'dir' ? '，目录树' : ''}）· 点击复制自己的链接`
    }
    if (m.kind === 'inherited') {
      return `无自己的分享，随父目录「${m.parent!.label}」的分享可访问 · 点击复制本项链接（父级链接 + 本项路径）`
    }
    return '未分享 · 点行操作「分享链接」创建'
  }
  /** 点击分享图标：own=自己的链接；inherited=父级 token 链接 + 本项相对 root 路径（直达本项，文件/目录统一）。均按 route.id 反查 ticket。 */
  async function copyShareLink(entry: FsEntry): Promise<void> {
    const m = shareMarkOf(entry)
    const route = m.kind === 'own' ? m.route : m.parent
    if (!route) return
    const ticket = findShareTicketById(route.id)
    const base = ticket?.urls?.[0]
    if (!base) { ElMessage.warning('分享凭证读取失败，请重新打开分享弹框刷新链接'); return }
    // 继承项统一：base(父级 token 链接) + 本项相对 root 路径 → 直达本项（内层文件/子目录）
    const url = m.kind === 'inherited' ? shareFileDirectUrl(base, entry.path) : base
    await osApi.clipboardWrite(url)
    ElMessage.success(m.kind === 'own' ? '已复制自己的分享链接' : '已复制本项分享链接（父级链接+本项路径）')
  }

  // ── ShareHub 安全分享弹框（plans/09 S15）：本地通道文件的 TTL/可撤销分享 ──
  const shareDialog = ref({
    open: false, root: '', entry: '', label: '',
  })
  /** 本地通道的文件/目录都可分享（allowIndex 由 ShareDialog 内勾选，不再全局门控） */
  function canShareEntry(): boolean {
    return deps.activeChannel()?.type === 'local'
  }
  function rowShare(entry: FsEntry): void {
    if (deps.activeChannel()?.type !== 'local') {
      ElMessage.warning('ShareHub 安全分享仅支持本地通道；远程/云通道请使用「链接」（裸外链）')
      return
    }
    void loadConfigForShare(entry)
  }
  async function loadConfigForShare(entry: FsEntry): Promise<void> {
    const cfg = normalizeUploadConfig(await uploadApi.getConfig())
    const root = cfg.local.defaultDir?.trim()
    if (!root) { ElMessage.warning('本地通道未配置默认目录，请到「上传配置」填写'); return }
    Object.assign(shareDialog.value, {
      root,
      entry: entry.path,
      label: `${entry.kind === 'dir' ? '目录' : '文件'}：${entry.name}`,
      open: true,
    })
  }

  /** 媒体预览直链（用户 2026-11-19）：
   *  本地 = 有效分享 ticket（own 直用 base / inherited 拼本项路径）；
   *  远端/云 = baseUrl + 文件路径，若配了签名模板则用 {url} 占位符套签名。
   *  返回空串表示无可用直链 → openPlayer 回退到边下边播。 */
  async function mediaDirectUrl(entry: FsEntry): Promise<string> {
    const chType = deps.activeChannel()?.type
    if (chType === 'local') {
      const m = shareMarkOf(entry)
      const route = m.kind === 'own' ? m.route : m.parent
      if (!route) return ''
      const ticket = findShareTicketById(route.id)
      if (!isTicketAlive(ticket)) return ''
      const base = ticket?.urls?.[0]
      if (!base) return ''
      return m.kind === 'inherited' ? shareFileDirectUrl(base, entry.path) : base
    }
    // 远端 / 云：读 profile 的 baseUrl + 签名模板
    try {
      const cfg = normalizeUploadConfig(await uploadApi.getConfig())
      const p = [...cfg.remote.profiles, ...cfg.cloud.profiles].find((x) => x.id === deps.profileId())
      return buildDirectUrl(p?.baseUrl ?? '', entry.path, p?.signUrlTemplate)
    } catch { return '' }
  }

  return {
    shareRoutes, loadShareRoutes, shareMarkOf, shareMarkTip, copyShareLink,
    shareDialog, canShareEntry, rowShare, mediaDirectUrl,
  }
}

export type FsShareMarksApi = ReturnType<typeof useFsShareMarks>
