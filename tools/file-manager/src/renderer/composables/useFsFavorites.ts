import { fsApi } from './fsHost'
import { ref, type Ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { FsEntry, FsFavorite } from '@sshk/shared'
import { friendlyError } from './useFsListing'

/**
 * 收藏夹（§十一，P4-4 自 FileExplorerPage 拆出）：跨通道收藏/直达抽屉。
 * 行为契约（与原页面逐字一致）：
 * - 收藏跳转：跨通道先切通道（watch 会清路径重列），再消费 pendingNavPath 进入目标目录；
 *   文件条目进入其父目录（用户 2026-11-19：当目录进入会报错），到达后选中该文件便于定位。
 * - 取消收藏/移除收藏一律二次确认（用户 2026-11-18：危险操作一律确认，禁遮罩禁 ESC）。
 * - 单次最多批量收藏 20 项。
 */
export interface FsFavoritesDeps {
  profileId: Ref<string>
  path: Ref<string>
  /** 收藏定位「下次进入目录」契约（useFsListing 持有，list() 消费） */
  pendingNavPath: Ref<string | null>
  pendingNavSelect: Ref<string | null>
  list: (resetCursor?: boolean) => Promise<void>
}

export function useFsFavorites(deps: FsFavoritesDeps) {
  const favorites = ref<FsFavorite[]>([])
  const favDrawerOpen = ref(false)
  async function loadFavorites(): Promise<void> {
    try { favorites.value = await fsApi.favoriteList() } catch { favorites.value = [] }
  }
  function isFavorited(path: string): boolean { return favorites.value.some((f) => f.profileId === deps.profileId.value && f.path === path) }

  function gotoFavorite(f: FsFavorite): void {
    if (f.kind === 'file') {
      deps.pendingNavPath.value = f.path.slice(0, Math.max(1, f.path.lastIndexOf('/'))) || '/'
      deps.pendingNavSelect.value = f.path
    } else {
      deps.pendingNavPath.value = f.path
      deps.pendingNavSelect.value = null
    }
    if (f.profileId !== deps.profileId.value) deps.profileId.value = f.profileId
    else { deps.path.value = deps.pendingNavPath.value ?? '/'; void deps.list() }
    favDrawerOpen.value = false
  }

  async function addFavorites(targets: FsEntry[]): Promise<void> {
    if (!deps.profileId.value || !targets.length) return
    try {
      let added = 0
      for (const t of targets.slice(0, 20)) {
        if (isFavorited(t.path)) continue
        await fsApi.favoriteAdd({ profileId: deps.profileId.value, path: t.path, kind: t.kind, name: t.name })
        added++
      }
      await loadFavorites()
      ElMessage.success(added ? `已收藏 ${added} 项` : '所选项目均已在收藏夹')
    } catch (err) {
      ElMessage.error(friendlyError(err))
    }
  }
  async function removeFavorite(entry: FsEntry): Promise<void> {
    const hit = favorites.value.find((f) => f.profileId === deps.profileId.value && f.path === entry.path)
    if (!hit) return
    // 取消收藏需二次确认（用户 2026-11-18：危险操作一律确认，禁遮罩禁 ESC）
    try {
      await ElMessageBox.confirm(`确定取消收藏「${hit.name}」吗？`, '取消收藏', { type: 'warning', showClose: false, closeOnClickModal: false, closeOnPressEscape: false, confirmButtonText: '取消收藏', cancelButtonText: '保留' })
    } catch { return }
    try {
      await fsApi.favoriteRemove(hit._id)
      await loadFavorites()
      ElMessage.success('已取消收藏')
    } catch (err) {
      ElMessage.error(friendlyError(err))
    }
  }
  /** 行末星标快捷收藏：已收藏=取消，未收藏=添加；复用同一状态与提示 */
  function toggleFav(entry: FsEntry): void {
    if (isFavorited(entry.path)) void removeFavorite(entry)
    else void addFavorites([entry])
  }
  async function removeFavoriteById(f: FsFavorite): Promise<void> {
    // 收藏夹内单项移除同样二次确认（禁遮罩禁 ESC）
    try {
      await ElMessageBox.confirm(`确定移除收藏「${f.name}」吗？`, '移除收藏', { type: 'warning', showClose: false, closeOnClickModal: false, closeOnPressEscape: false, confirmButtonText: '移除', cancelButtonText: '保留' })
    } catch { return }
    try {
      await fsApi.favoriteRemove(f._id)
      await loadFavorites()
    } catch (err) {
      ElMessage.error(friendlyError(err))
    }
  }

  return {
    favorites, favDrawerOpen,
    loadFavorites, isFavorited, gotoFavorite, addFavorites, removeFavorite, removeFavoriteById, toggleFav,
  }
}

export type FsFavoritesApi = ReturnType<typeof useFsFavorites>
