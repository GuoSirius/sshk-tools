import { fsApi } from './fsHost'
import { ref } from 'vue'
import { ElMessage } from 'element-plus'
import type { FsEntry } from '@sshk/shared'
import { friendlyError } from './useFsListing'

/**
 * 目录/条目备注（§十一 fsAnnotations，P4-4 自 FileExplorerPage 拆出）。
 * 行为契约（与原页面逐字一致）：备注保存在本机应用数据，跨通道可用；
 * 多选批量同备注；留空=清除备注。备注数据跟随目录重载（onDirReload 回调触发 loadAnnotations）。
 */
export function useFsAnnotations(deps: { profileId: () => string }) {
  const annotations = ref(new Map<string, string>())
  async function loadAnnotations(): Promise<void> {
    if (!deps.profileId()) return
    try { annotations.value = new Map(Object.entries(await fsApi.annotationList(deps.profileId()))) }
    catch { annotations.value = new Map() }
  }

  // ── §十一：设置备注（确认后生效；多选批量同备注）──
  const noteOpen = ref(false)
  const noteTargets = ref<FsEntry[]>([])
  const noteInput = ref('')
  const noteSaving = ref(false)
  function openNote(targets: FsEntry[]): void {
    if (!targets.length) return
    noteTargets.value = targets
    noteInput.value = targets.length === 1 ? (annotations.value.get(targets[0]!.path) ?? '') : ''
    noteOpen.value = true
  }
  async function submitNote(): Promise<void> {
    if (!deps.profileId() || noteSaving.value) return
    noteSaving.value = true
    try {
      for (const t of noteTargets.value) {
        await fsApi.annotationSet({ profileId: deps.profileId(), path: t.path, note: noteInput.value })
      }
      noteOpen.value = false
      ElMessage.success(noteInput.value.trim() ? `已设置备注（${noteTargets.value.length} 项）` : '已清除备注')
      await loadAnnotations()
    } catch (err) {
      ElMessage.error(friendlyError(err))
    } finally { noteSaving.value = false }
  }

  return { annotations, loadAnnotations, noteOpen, noteTargets, noteInput, noteSaving, openNote, submitNote }
}

export type FsAnnotationsApi = ReturnType<typeof useFsAnnotations>
