import { computed, ref, type ComputedRef, type Ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { Source, TreeNode } from './useContentTree'

/**
 * css 多 tab 编辑域（P6-4 自 ContentManagePage 拆出，搬代码不改行为）：
 * 外置 css 多文件互相参照编辑（tab 条只做切换，编辑器单实例常驻——隐藏 pane 内挂载 Monaco 会失效）。
 */
export interface CssTab {
  /** tab 唯一键 = <root>:<path>，避免自定义/系统同相对路径串到同一 tab */
  id: string
  file: string
  /** 内容根：决定读写去向（修复自定义 css 被读写到系统根） */
  source: Source
  content: string
  dirty: boolean
}

export interface CssTabsDeps {
  read(file: string, source?: Source): Promise<string>
  write(file: string, content: string, source?: Source): Promise<void>
  selected: Ref<TreeNode | null>
  /** 保存后刷新版本预览（若当前选中的是版本） */
  renderPreview(node: TreeNode): Promise<void>
}

export interface CssTabs {
  cssTabs: Ref<CssTab[]>
  activeCss: Ref<string>
  activeTab: ComputedRef<CssTab | null>
  openCssTab(file: string, source?: Source): Promise<void>
  /** 删除节点后清理其子路径下的已开 tab */
  dropTabsUnder(pathPrefix: string): void
  /** 重命名目录后迁移已开 tab 的 file/id（tab 不丢，未保存内容保留） */
  renameTabsUnder(oldPath: string, newPath: string): void
  onCssEdit(file: string, v: string): void
  saveCss(tab: CssTab): Promise<void>
  saveAllCss(): Promise<void>
  closeCssTab(id: string): Promise<void>
}

export function useCssTabs(deps: CssTabsDeps): CssTabs {
  const cssTabs = ref<CssTab[]>([])
  const activeCss = ref('')
  const activeTab = computed(() => cssTabs.value.find((t) => t.id === activeCss.value) ?? null)

  function tabId(source: Source, file: string): string {
    return `${source}:${file}`
  }
  async function openCssTab(file: string, source: Source = 'system'): Promise<void> {
    const id = tabId(source, file)
    if (!cssTabs.value.some((t) => t.id === id)) {
      cssTabs.value.push({ id, file, source, content: await deps.read(file, source), dirty: false })
    }
    activeCss.value = id
  }
  function dropTabsUnder(pathPrefix: string): void {
    cssTabs.value = cssTabs.value.filter((t) => !t.file.startsWith(`${pathPrefix}/`))
    if (!cssTabs.value.some((t) => t.id === activeCss.value)) activeCss.value = cssTabs.value[0]?.id ?? ''
  }
  function renameTabsUnder(oldPath: string, newPath: string): void {
    for (const tab of cssTabs.value) {
      if (tab.file === oldPath || tab.file.startsWith(`${oldPath}/`)) {
        tab.file = `${newPath}${tab.file.slice(oldPath.length)}`
        tab.id = tabId(tab.source, tab.file)
      }
    }
    const active = cssTabs.value.find((t) => t.file.startsWith(newPath))
    if (active) activeCss.value = active.id
  }
  function onCssEdit(id: string, v: string): void {
    const tab = cssTabs.value.find((t) => t.id === id)
    if (tab) {
      tab.content = v
      tab.dirty = true
    }
  }
  async function saveCss(tab: CssTab): Promise<void> {
    try {
      await deps.write(tab.file, tab.content, tab.source)
      tab.dirty = false
      ElMessage.success('样式已保存')
      if (deps.selected.value?.kind === 'version') await deps.renderPreview(deps.selected.value)
    } catch (err) {
      ElMessage.error(`保存失败：${(err as Error).message}`)
    }
  }
  async function saveAllCss(): Promise<void> {
    for (const t of cssTabs.value.filter((x) => x.dirty)) await saveCss(t)
  }
  async function closeCssTab(id: string): Promise<void> {
    const tab = cssTabs.value.find((t) => t.id === id)
    if (tab?.dirty) {
      try {
        await ElMessageBox.confirm(`「${basename(tab.file)}」有未保存修改，关闭将丢弃`, '提示', { type: 'warning', confirmButtonText: '丢弃并关闭', cancelButtonText: '取消', closeOnClickModal: false, closeOnPressEscape: false })
      } catch {
        return
      }
    }
    cssTabs.value = cssTabs.value.filter((t) => t.id !== id)
    if (activeCss.value === id) activeCss.value = cssTabs.value[0]?.id ?? ''
  }

  return { cssTabs, activeCss, activeTab, openCssTab, dropTabsUnder, renameTabsUnder, onCssEdit, saveCss, saveAllCss, closeCssTab }
}

/** 路径末段（本地 helper：与 useContentTree.basename 同实现） */
function basename(p: string): string {
  return p.split(/[/\\]/).pop() ?? p
}
