import { onBeforeUnmount, onMounted, ref } from 'vue'
import type { FsEntry } from '@sshk/shared'

/**
 * 网格视图右键菜单（用户 2026-11-18：卡片展示同所有行操作，P4-4 自 FileExplorerPage 拆出）。
 * 行为契约（与原页面逐字一致）：
 * - 简单钳制：避免菜单溢出视口右/下边缘。
 * - 事件委托：原生菜单从 li 的 data-command 读取命令（不走 el-dropdown 的 command 分发）。
 * - window click/contextmenu 关闭：右键另一个卡片时由其自身 handler 重新开菜单，不先关。
 */
export function useFsContextMenu(runCommand: (cmd: string, entry: FsEntry) => void) {
  const ctxMenu = ref<{ x: number; y: number; entry: FsEntry } | null>(null)
  function openCtxMenu(entry: FsEntry, e: MouseEvent): void {
    // 简单钳制：避免菜单溢出视口右/下边缘
    ctxMenu.value = {
      x: Math.min(e.clientX, window.innerWidth - 200),
      y: Math.min(e.clientY, window.innerHeight - 360),
      entry,
    }
  }
  function ctxRun(cmd: string): void {
    const entry = ctxMenu.value?.entry
    ctxMenu.value = null
    if (entry) runCommand(cmd, entry)
  }
  /** 事件委托：原生菜单从 li 的 data-command 读取命令（不走 el-dropdown 的 command 分发） */
  function ctxClick(e: MouseEvent): void {
    const item = (e.target as HTMLElement | null)?.closest?.('.fs-ctx-menu li')
    if (!item || item.classList.contains('is-disabled')) return
    const cmd = item.getAttribute('data-command')
    if (cmd) ctxRun(cmd)
  }
  function onWindowCtxMaybeClose(e: Event): void {
    // 右键另一个卡片时由其自身 handler 重新开菜单，不先关
    if (e.type === 'contextmenu' && (e.target as HTMLElement | null)?.closest?.('.fs-cell')) return
    ctxMenu.value = null
  }
  /** Escape 关闭（页面键盘处理调用） */
  function closeCtxMenu(): void {
    ctxMenu.value = null
  }

  // 网格右键菜单：点击任意处 / 在非卡片处右键 / Escape 关闭
  onMounted(() => {
    window.addEventListener('click', onWindowCtxMaybeClose)
    window.addEventListener('contextmenu', onWindowCtxMaybeClose)
  })
  onBeforeUnmount(() => {
    window.removeEventListener('click', onWindowCtxMaybeClose)
    window.removeEventListener('contextmenu', onWindowCtxMaybeClose)
  })

  return { ctxMenu, openCtxMenu, ctxClick, closeCtxMenu }
}

export type FsContextMenuApi = ReturnType<typeof useFsContextMenu>
