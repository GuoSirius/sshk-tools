import { computed, ref, type ComputedRef, type Ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { Source, TreeNode } from './useContentTree'

/**
 * css 多 tab 编辑域（P6-4 自 ContentManagePage 拆出，搬代码不改行为）：
 * 外置 css 多文件互相参照编辑（tab 条只做切换，编辑器单实例常驻——隐藏 pane 内挂载 Monaco 会失效）。
 */
export interface CssTab {
  file: string
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
  openCssTab(file: string): Promise<void>
  /** 删除节点后清理其子路径下的已开 tab */
  dropTabsUnder(pathPrefix: string): void
  onCssEdit(file: string, v: string): void
  saveCss(tab: CssTab): Promise<void>
  saveAllCss(): Promise<void>
  closeCssTab(file: string): Promise<void>
}

export function useCssTabs(deps: CssTabsDeps): CssTabs {
  const cssTabs = ref<CssTab[]>([])
  const activeCss = ref('')
  const activeTab = computed(() => cssTabs.value.find((t) => t.file === activeCss.value) ?? null)

  async function openCssTab(file: string): Promise<void> {
    if (!cssTabs.value.some((t) => t.file === file)) {
      cssTabs.value.push({ file, content: await deps.read(file), dirty: false })
    }
    activeCss.value = file
  }
  function dropTabsUnder(pathPrefix: string): void {
    cssTabs.value = cssTabs.value.filter((t) => !t.file.startsWith(`${pathPrefix}/`))
    if (!cssTabs.value.some((t) => t.file === activeCss.value)) activeCss.value = cssTabs.value[0]?.file ?? ''
  }
  function onCssEdit(file: string, v: string): void {
    const tab = cssTabs.value.find((t) => t.file === file)
    if (tab) {
      tab.content = v
      tab.dirty = true
    }
  }
  async function saveCss(tab: CssTab): Promise<void> {
    try {
      await deps.write(tab.file, tab.content)
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
  async function closeCssTab(file: string): Promise<void> {
    const tab = cssTabs.value.find((t) => t.file === file)
    if (tab?.dirty) {
      try {
        await ElMessageBox.confirm(`「${basename(file)}」有未保存修改，关闭将丢弃`, '提示', { type: 'warning', confirmButtonText: '丢弃并关闭', cancelButtonText: '取消', closeOnClickModal: false, closeOnPressEscape: false })
      } catch {
        return
      }
    }
    cssTabs.value = cssTabs.value.filter((t) => t.file !== file)
    if (activeCss.value === file) activeCss.value = cssTabs.value[0]?.file ?? ''
  }

  return { cssTabs, activeCss, activeTab, openCssTab, dropTabsUnder, onCssEdit, saveCss, saveAllCss, closeCssTab }
}

/** 路径末段（本地 helper：与 useContentTree.basename 同实现） */
function basename(p: string): string {
  return p.split(/[/\\]/).pop() ?? p
}
