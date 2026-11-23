import { describe, expect, it } from 'vitest'
import { contextMenuItems } from './context-menu-items'
import type { NodeKind, Source, TreeNode } from './useContentTree'

function node(kind: NodeKind, source: Source = 'system', cat?: 'fragment' | 'template'): TreeNode {
  return {
    id: `${source}:${kind}`, label: kind, kind,
    data: { kind, source, path: kind, ...(cat ? { cat } : {}) },
  }
}

describe('右键菜单可见性', () => {
  it('只读系统 css 文件仍可复制 / 另存为，不出现写操作', () => {
    const keys = contextMenuItems(node('cssFile'), false).map((x) => x.key)
    expect(keys).toEqual(['copy', 'saveAs'])
  })

  it('只读系统品牌只给另存为（可存到自定义根）', () => {
    expect(contextMenuItems(node('brand'), false).map((x) => x.key)).toEqual(['saveAs'])
  })

  it('只读类目/根无可用项', () => {
    expect(contextMenuItems(node('category'), false)).toEqual([])
    expect(contextMenuItems(node('root'), false)).toEqual([])
  })

  it('可编辑节点保持原功能与顺序（类型 / css 目录禁止重命名）', () => {
    expect(contextMenuItems(node('cssDir', 'custom'), true).map((x) => x.key)).toEqual([
      'copy', 'paste', 'remove', 'saveAs', 'newFile',
    ])
    expect(contextMenuItems(node('category', 'custom', 'fragment'), true).map((x) => x.key)).toEqual([
      'remove', 'newFragmentFamily',
    ])
    expect(contextMenuItems(node('brand', 'custom'), true).map((x) => x.key)).toEqual([
      'remove', 'rename', 'saveAs', 'newBrand', 'newFragmentFamily', 'newTemplateFamily',
    ])
    expect(contextMenuItems(node('brand', 'custom'), true).find((x) => x.key === 'newBrand')?.label).toBe('新建品牌（同级）')
  })
})
