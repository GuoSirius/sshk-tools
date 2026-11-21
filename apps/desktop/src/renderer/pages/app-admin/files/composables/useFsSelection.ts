import { osApi } from './fsHost'
import { computed, ref } from 'vue'
import { ElMessage } from 'element-plus'
import type { FsEntry } from '@sshk/shared'

/**
 * 选择状态（P4-4 自 FileExplorerPage 拆出）：单击/Ctrl/Shift/全选/勾选框，§十一 派生启用态。
 * 行为契约（与原页面逐字一致）：
 * - selection 只存 path；selectedEntries 从「当前可见（过滤+排序后）列表」派生。
 * - shift 区间选择以 filteredEntries 的可见顺序为准（anchor=上次点击索引）。
 */
export function useFsSelection(visible: () => FsEntry[]) {
  const selection = ref(new Set<string>())
  const shiftAnchor = ref(-1)

  function reset(): void {
    selection.value = new Set()
    shiftAnchor.value = -1
  }
  /** 直接覆盖选中集合（收藏定位/行操作先选中再弹框等场景） */
  function selectOnly(paths: string[]): void {
    selection.value = new Set(paths)
  }

  const selectedEntries = computed(() => visible().filter((e) => selection.value.has(e.path)))
  /** 选中态派生（§十一 动态启用：按所选数量/类型/通道实时判定，避免误操作） */
  const selSingle = computed(() => (selectedEntries.value.length === 1 ? selectedEntries.value[0]! : null))
  const selSingleFile = computed(() => (selSingle.value?.kind === 'file' ? selSingle.value : null))
  const selSingleDir = computed(() => (selSingle.value?.kind === 'dir' ? selSingle.value : null))

  function rowClick(entry: FsEntry, event: MouseEvent): void {
    const index = visible().findIndex((e) => e.path === entry.path)
    if (event.shiftKey && shiftAnchor.value >= 0) {
      const [a, b] = [Math.min(shiftAnchor.value, index), Math.max(shiftAnchor.value, index)]
      const next = new Set(selection.value)
      for (let i = a; i <= b; i++) next.add(visible()[i]!.path)
      selection.value = next
      return
    }
    if (event.ctrlKey || event.metaKey) {
      const next = new Set(selection.value)
      if (next.has(entry.path)) next.delete(entry.path)
      else next.add(entry.path)
      selection.value = next
    } else {
      selection.value = new Set([entry.path])
    }
    shiftAnchor.value = index
  }
  function toggleCheck(entry: FsEntry): void {
    const next = new Set(selection.value)
    if (next.has(entry.path)) next.delete(entry.path)
    else next.add(entry.path)
    selection.value = next
    shiftAnchor.value = visible().findIndex((e) => e.path === entry.path)
  }
  function selectAll(): void {
    selection.value = selection.value.size === visible().length ? new Set() : new Set(visible().map((e) => e.path))
  }

  async function copySelectedPaths(): Promise<void> {
    const list0 = selectedEntries.value
    if (!list0.length) return
    await osApi.clipboardWrite(list0.map((e) => e.path).join('\n'))
    ElMessage.success(`已复制 ${list0.length} 条路径`)
  }

  return {
    selection, shiftAnchor, selectedEntries, selSingle, selSingleFile, selSingleDir,
    reset, selectOnly, rowClick, toggleCheck, selectAll, copySelectedPaths,
  }
}

export type FsSelectionApi = ReturnType<typeof useFsSelection>
