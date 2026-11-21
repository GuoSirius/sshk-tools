import { fsApi } from './fsHost'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { FsEntry } from '@sshk/shared'

/**
 * 目标目录级联/校验工具（P4-4 自 FileExplorerPage 拆出）：移动/复制与解压到 弹框共用。
 * 行为契约（与原页面逐字一致）：
 * - dirLazyProps 用工厂生成（各弹框目标通道来源不同）；通道切换靠模板 :key 重挂载刷新。
 * - 坑（同 file-picker）：不写 leaf 字段——EP 对「已加载且无子」自动推断叶子，显式 leaf 会钉死非叶子。
 * - 层级（用户 2026-11-19 定版）：首列 = 根目录「/」独立节点（点圈直接选根），展开子级列一级目录；
 *   根 label 置空 + 级联 separator="/" → 回显 /a/b/c（若根 label 为 '/' 会拼出 //a/b 双斜杠），
 *   面板首列根节点的 "/" 由全局 CSS（fs-dir-cascader-popper）伪元素补显示。
 */
export function useFsDirPicker(deps: {
  profileId: () => string
}) {
  function dirLazyProps(getPid: () => string) {
    return {
      lazy: true,
      checkStrictly: true,
      emitPath: false,
      lazyLoad: async (node: { level: number; value?: string | number | null }, resolve: (nodes: unknown[]) => void) => {
        const pid = getPid()
        if (!pid) { resolve([]); return }
        // 根 label 置空 + 级联 separator="/" → 回显 /a/b/c（若根 label 为 '/' 会拼出 //a/b 双斜杠）；
        // 面板首列根节点的 "/" 由 CSS 伪元素补显示
        if (node.level === 0) { resolve([{ value: '/', label: '' }]); return } // 根目录独立首级
        const parent = String(node.value ?? '/')
        try {
          const page = await fsApi.list({ profileId: pid, path: parent })
          resolve(page.entries.filter((e) => e.kind === 'dir').map((e) => ({ value: e.path, label: e.name })))
        } catch { resolve([]) }
      },
    }
  }

  /** 目标目录输入 → 内部规范（`/a/b`；空串与 `/` = 根）。返回 null 表示非法 */
  function normalizeDestInput(raw: string): string | null {
    const s = String(raw ?? '').trim().replace(/\\/g, '/')
    const segs = s.split('/').map((p) => p.trim()).filter(Boolean)
    if (segs.some((p) => p === '.' || p === '..')) return null
    return `/${segs.join('/')}`
  }

  /** 目标路径是否已存在（用于同目录复制/移动的重名检查） */
  async function destExists(destPath: string): Promise<boolean> {
    try {
      const parent = destPath.lastIndexOf('/') <= 0 ? '/' : destPath.slice(0, destPath.lastIndexOf('/'))
      const page = await fsApi.list({ profileId: deps.profileId(), path: parent })
      return page.entries.some((e) => e.path === destPath)
    } catch { return false }
  }

  /** 同源同目录的重命名循环（用户 2026-11-18）：确认后仍重名就继续弹，取消才终止 */
  async function askRenameForConflict(src: Pick<FsEntry, 'name'>, destDir: string): Promise<string | null> {
    while (true) {
      let value: string | null = null
      try {
        const r = await ElMessageBox.prompt(
          `「${src.name}」在目标目录中已存在（同源同目录不允许直接覆盖）。请输入新名称后确认；若仍重名会再次提示。`,
          '重命名以避免覆盖',
          {
            inputValue: src.name, confirmButtonText: '确认', cancelButtonText: '取消',
            inputPattern: /^[^\\/:]+$/, inputErrorMessage: '名称不能含斜杠',
            closeOnClickModal: false, closeOnPressEscape: false,
          },
        )
        value = r.value?.trim() ?? ''
      } catch { return null } // 用户取消 → 整个操作终止
      if (!value || value === src.name) continue
      const destPath = destDir === '/' ? `/${value}` : `${destDir}/${value}`
      if (!(await destExists(destPath))) return value
      ElMessage.warning('该名称已存在，请换一个')
    }
  }

  return { dirLazyProps, normalizeDestInput, destExists, askRenameForConflict }
}

export type FsDirPickerApi = ReturnType<typeof useFsDirPicker>
