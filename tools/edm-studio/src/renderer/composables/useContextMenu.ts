import { computed, ref, type ComputedRef, type Ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import * as yaml from 'js-yaml'
import { api } from '../tool-api'
import type { Cat, Source, TreeNode } from './useContentTree'

/**
 * 右键菜单域（P6-4 自 ContentManagePage 拆出，搬代码不改行为）：
 * v5 分层右键菜单（复制/粘贴/删除/重命名/另存为/新建）——原生 ul/div 自管右键菜单（el-dropdown 裸用禁忌），
 * R24 统一顺序：复制 → 粘贴 → 删除 → 重命名 → 另存为 → 新建；编辑项仅在节点可编辑时出现。
 */
export type Clipboard = {
  type: 'cssDir'
  dirPath: string
  files: string[]
  source: Source
} | {
  type: 'cssFile'
  file: string
  source: Source
} | null

export type MenuItem = { key: string; label: string; danger?: boolean }

export interface ContextMenuDeps {
  selected: Ref<TreeNode | null>
  canEditSystem: Ref<boolean>
  load(silent?: boolean): Promise<void>
  existsIn(file: string, source?: Source): Promise<boolean>
  read(file: string, source?: Source): Promise<string>
  write(file: string, content: string, source?: Source): Promise<void>
  basename(p: string): string
  validCode(code: string): boolean
  promptCodeAndName(title: string, codeHint: string, nameDefault: string): Promise<{ code: string; name: string } | null>
  nextVersionOf(famPath: string, source: Source): number
  parseVersion(dir: string): number
  resolveConflict(dir: string, name: string): Promise<string | null>
  pasteFileInto(dir: string, name: string, src: string, dest: Source, srcSource: Source): Promise<void>
  /** 删除节点后清理其子路径下的已开 css tab */
  dropTabsUnder(pathPrefix: string): void
  /** 另存为（useSaveAs 提供） */
  openSaveAs(node: TreeNode): void
}

export interface ContextMenu {
  menu: Ref<{ x: number; y: number; node: TreeNode } | null>
  menuItems: ComputedRef<MenuItem[]>
  /** R24：节点可编辑 ⟺ source==='custom'（恒可写）或系统门控通过 */
  nodeCanEdit(node: TreeNode): boolean
  onContextMenu(event: MouseEvent, node: TreeNode): void
  closeMenu(): void
  onDocMouseDown(e: MouseEvent): void
  onMenu(key: string): Promise<void>
}

/** 版本目录名 → 版本号（vN / 纯数字；否则 1；与树域同实现） */
function parseVersion(dir: string): number {
  const m = /v?(\d+)/.exec(dir)
  return m ? Number(m[1]) : 1
}

export function useContextMenu(deps: ContextMenuDeps): ContextMenu {
  const menu = ref<{ x: number; y: number; node: TreeNode } | null>(null)
  const clipboard = ref<Clipboard>(null)

  /**
   * R24 右键菜单——统一顺序：复制 → 粘贴 → 删除 → 重命名 → 另存为 → 新建。
   * 复制/粘贴仅 css 支持；新建按节点类型挂对应项；编辑项仅在节点可编辑时出现（onContextMenu 已门控）。
   */
  const menuItems = computed<MenuItem[]>(() => {
    if (!menu.value) return []
    const node = menu.value.node
    const k = node.kind
    const items: MenuItem[] = []
    // 复制 / 粘贴（仅 css 目录、css 文件）
    if (k === 'cssDir' || k === 'cssFile') items.push({ key: 'copy', label: '复制' })
    if (k === 'cssDir') items.push({ key: 'paste', label: '粘贴' })
    // 删除 / 重命名（除根外均可）
    if (k !== 'root') items.push({ key: 'remove', label: '删除', danger: true })
    if (k !== 'root') items.push({ key: 'rename', label: '重命名' })
    // 另存为（实体 / css）
    if (k === 'brand' || k === 'family' || k === 'version' || k === 'cssDir' || k === 'cssFile')
      items.push({ key: 'saveAs', label: '另存为' })
    // 新建（逐个对应：品牌→新建品牌、片段→新建片段族、模板→新建模板族；族额外加新建版本）
    if (k === 'root') items.push({ key: 'newBrand', label: '新建品牌' })
    if (k === 'brand') {
      items.push({ key: 'newBrand', label: '新建品牌' })
      items.push({ key: 'newFragmentFamily', label: '新建片段族' })
      items.push({ key: 'newTemplateFamily', label: '新建模板族' })
    }
    if (k === 'category') {
      items.push(node.data.cat === 'fragment' ? { key: 'newFragmentFamily', label: '新建片段族' } : { key: 'newTemplateFamily', label: '新建模板族' })
    }
    if (k === 'family') {
      items.push({ key: 'newVersion', label: '新建版本' })
      items.push(node.data.cat === 'fragment' ? { key: 'newFragmentFamily', label: '新建片段族（同级）' } : { key: 'newTemplateFamily', label: '新建模板族（同级）' })
    }
    if (k === 'version') items.push({ key: 'newVersion', label: '新建版本（同级）' })
    if (k === 'cssDir') items.push({ key: 'newFile', label: '新建样式' })
    return items
  })

  /** R24：节点可编辑 ⟺ source==='custom'（恒可写）或系统门控通过 */
  function nodeCanEdit(node: TreeNode): boolean {
    return node.data.source === 'custom' || deps.canEditSystem.value
  }
  function onContextMenu(event: MouseEvent, node: TreeNode): void {
    event.preventDefault()
    if (!nodeCanEdit(node)) return
    menu.value = { x: event.clientX, y: event.clientY, node }
  }
  function closeMenu(): void {
    menu.value = null
  }
  function onDocMouseDown(e: MouseEvent): void {
    if (!menu.value) return
    const el = document.querySelector('.ctx-menu')
    if (el && !el.contains(e.target as Node)) closeMenu()
  }

  async function onMenu(key: string): Promise<void> {
    const node = menu.value?.node
    closeMenu()
    if (!node) return
    try {
      if (key === 'copy') {
        clipboard.value =
          node.kind === 'cssDir'
            ? { type: 'cssDir', dirPath: node.data.path, files: node.data.cssFiles ?? [], source: node.data.source }
            : { type: 'cssFile', file: node.data.path, source: node.data.source }
        ElMessage.success('已复制')
        return
      }
      if (key === 'paste') {
        if (!clipboard.value) {
          ElMessage.warning('剪贴板为空，请先复制 css 目录或文件')
          return
        }
        const baseDir = node.kind === 'cssDir' ? node.data.path : node.data.path ? `${node.data.path}/css` : 'css'
        const dest = node.data.source
        if (clipboard.value.type === 'cssFile') {
          await deps.pasteFileInto(baseDir, deps.basename(clipboard.value.file), clipboard.value.file, dest, clipboard.value.source)
        } else {
          for (const f of clipboard.value.files) await deps.pasteFileInto(baseDir, f, `${clipboard.value.dirPath}/${f}`, dest, clipboard.value.source)
        }
        ElMessage.success('已粘贴')
        await deps.load(true)
        return
      }
      if (key === 'newFile') {
        let name = String((await ElMessageBox.prompt('css 文件名（可省略 .css 后缀）', '新建样式', { inputValue: '' })).value ?? '').trim()
        if (!name) return
        if (!name.endsWith('.css')) name += '.css'
        let finalName = name
        if (await deps.existsIn(`${node.data.path}/${name}`, node.data.source)) {
          const resolved = await deps.resolveConflict(node.data.path, name)
          if (!resolved) return
          finalName = resolved
        }
        await deps.write(`${node.data.path}/${finalName}`, '', node.data.source)
        ElMessage.success('已创建')
        await deps.load(true)
        return
      }
      if (key === 'rename') {
        const tip = node.kind === 'cssDir' || node.kind === 'cssFile' ? '' : '（目录 meta.yaml 内的 code 不会自动修改，请随后自行同步）'
        const newName = String(
          (await ElMessageBox.prompt(`新名称${tip}`, '重命名', { inputValue: deps.basename(node.data.path) })).value ?? '',
        ).trim()
        if (!newName || newName === deps.basename(node.data.path)) return
        await api('content:rename', { source: node.data.source, file: node.data.path, newName })
        ElMessage.success('已重命名')
        if (deps.selected.value?.data.path === node.data.path) deps.selected.value = null
        await deps.load(true)
        return
      }
      if (key === 'remove') {
        await ElMessageBox.confirm(`确定删除「${node.label}」？此操作不可恢复。`, '危险操作', { type: 'error', confirmButtonText: '删除', cancelButtonText: '取消', closeOnClickModal: false, closeOnPressEscape: false })
        await api('content:remove', { source: node.data.source, file: node.data.path })
        ElMessage.success('已删除')
        if (deps.selected.value?.data.path.startsWith(node.data.path)) deps.selected.value = null
        deps.dropTabsUnder(node.data.path)
        await deps.load(true)
        return
      }
      /* ── R24 新建动作（写入节点所属 source 根） ── */
      if (key === 'newBrand') {
        const src = node.data.source
        const got = await deps.promptCodeAndName('新建品牌', '品牌代码（目录名，英文）', '')
        if (!got) return
        if (await deps.existsIn(`${got.code}/meta.yaml`, src)) { ElMessage.error(`品牌「${got.code}」已存在`); return }
        await deps.write(`${got.code}/meta.yaml`, yaml.dump({ code: got.code, name: got.name }, { lineWidth: -1 }), src)
        ElMessage.success('已创建品牌'); await deps.load(true); return
      }
      if (key === 'newFragmentFamily' || key === 'newTemplateFamily') {
        const src = node.data.source
        const cat: Cat = key === 'newFragmentFamily' ? 'fragment' : 'template'
        const brandCode = node.data.brandCode ?? ''
        if (!brandCode) { ElMessage.error('无法确定所属品牌'); return }
        const got = await deps.promptCodeAndName('新建族', '族代码（目录名，英文）', '')
        if (!got) return
        const parent = `${brandCode}/${cat}`
        if (await deps.existsIn(`${parent}/${got.code}/meta.yaml`, src)) { ElMessage.error(`族「${got.code}」已存在`); return }
        const meta: Record<string, unknown> = { code: got.code, name: got.name }
        if (cat === 'fragment') meta.type = 'product'
        else meta.slots = []
        await deps.write(`${parent}/${got.code}/meta.yaml`, yaml.dump(meta, { lineWidth: -1 }), src)
        ElMessage.success('已创建族'); await deps.load(true); return
      }
      if (key === 'newVersion') {
        const src = node.data.source
        const { brandCode, cat, familyCode } = node.data
        if (!brandCode || !cat || !familyCode) { ElMessage.error('无法确定所属族'); return }
        const famPath = `${brandCode}/${cat}/${familyCode}`
        const dirInput = String((await ElMessageBox.prompt('版本目录名（如 v2，留空自动递增）', '新建版本', { inputValue: '' })).value ?? '').trim()
        const finalDir = dirInput || `v${deps.nextVersionOf(famPath, src)}`
        if (!deps.validCode(finalDir)) { ElMessage.error('版本目录名仅限字母 / 数字 / 下划线 / 连字符'); return }
        if (await deps.existsIn(`${famPath}/${finalDir}/meta.yaml`, src)) { ElMessage.error(`版本「${finalDir}」已存在`); return }
        await deps.write(`${famPath}/${finalDir}/meta.yaml`, yaml.dump({ version: parseVersion(finalDir) }, { lineWidth: -1 }), src)
        await deps.write(`${famPath}/${finalDir}/source.njk`, '', src)
        await deps.write(`${famPath}/${finalDir}/sample.yaml`, '', src)
        ElMessage.success('已创建版本'); await deps.load(true); return
      }
      if (key === 'saveAs') deps.openSaveAs(node)
    } catch (err) {
      if (err === 'cancel' || err === 'close') return // 取消/关闭不视为错误（#3）
      ElMessage.error((err as Error).message)
    }
  }

  return { menu, menuItems, nodeCanEdit, onContextMenu, closeMenu, onDocMouseDown, onMenu }
}
