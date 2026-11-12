import { computed, ref } from 'vue'

/**
 * 跨页选择（需求 8）：全局 Set<id>。
 * - 翻页与过滤不清空；失效 ID 由 prune 清理
 * - 全选当前页 / 全选筛选结果 / 清空 三个动作统一入口
 */
export function useSelection() {
  const selected = ref(new Set<string>())

  const count = computed(() => selected.value.size)
  const has = (id: string): boolean => selected.value.has(id)

  function toggle(id: string): void {
    const next = new Set(selected.value)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    selected.value = next
  }

  /** 勾选一批（当前页全选 / 筛选结果全选共用） */
  function selectMany(ids: string[]): void {
    const next = new Set(selected.value)
    for (const id of ids) next.add(id)
    selected.value = next
  }

  /** 取消勾选一批 */
  function unselectMany(ids: string[]): void {
    const next = new Set(selected.value)
    for (const id of ids) next.delete(id)
    selected.value = next
  }

  /** 当前页是否全选（用于表头 checkbox 状态） */
  function isPageAllSelected(ids: string[]): boolean {
    return ids.length > 0 && ids.every((id) => selected.value.has(id))
  }

  /** 翻页表头半选态 */
  function isPageIndeterminate(ids: string[]): boolean {
    const hit = ids.filter((id) => selected.value.has(id)).length
    return hit > 0 && hit < ids.length
  }

  /** 清理已不存在的 ID（删除 / 导入覆盖后调用） */
  function prune(validIds: Set<string>): number {
    let removed = 0
    for (const id of selected.value) {
      if (!validIds.has(id)) {
        selected.value.delete(id)
        removed += 1
      }
    }
    selected.value = new Set(selected.value)
    return removed
  }

  function clear(): void {
    selected.value = new Set()
  }

  return {
    selected,
    count,
    has,
    toggle,
    selectMany,
    unselectMany,
    isPageAllSelected,
    isPageIndeterminate,
    prune,
    clear,
  }
}

export type Selection = ReturnType<typeof useSelection>
