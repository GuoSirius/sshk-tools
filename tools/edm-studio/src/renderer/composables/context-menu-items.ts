import type { TreeNode } from './useContentTree'

export type MenuItem = { key: string; label: string; danger?: boolean }

/**
 * 右键菜单项构造（纯函数，便于回归）。
 * editable=false（只读系统节点）：只保留不写源根的「复制 / 另存为」——
 * 用户可以把只读系统 css 另存到可写目标根，旧实现整节点禁用右键，拦住了这个合法场景。
 * editable=true：功能与顺序不变（复制 → 粘贴 → 删除 → 重命名 → 另存为 → 新建）。
 */
export function contextMenuItems(node: TreeNode, editable: boolean): MenuItem[] {
  const k = node.kind
  const items: MenuItem[] = []
  // 复制 / 粘贴（仅 css 目录、css 文件）
  if (k === 'cssDir' || k === 'cssFile') items.push({ key: 'copy', label: '复制' })
  if (editable) {
    if (k === 'cssDir') items.push({ key: 'paste', label: '粘贴' })
    // 删除 / 重命名（除根外均可）
    if (k !== 'root') items.push({ key: 'remove', label: '删除', danger: true })
    if (k !== 'root') items.push({ key: 'rename', label: '重命名' })
  }
  // 另存为（实体 / css；只读源也可另存到可写目标）
  if (isSaveAsKind(k)) items.push({ key: 'saveAs', label: '另存为' })
  if (!editable) return items
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
}

function isSaveAsKind(k: TreeNode['kind']): boolean {
  return k === 'brand' || k === 'family' || k === 'version' || k === 'cssDir' || k === 'cssFile'
}
