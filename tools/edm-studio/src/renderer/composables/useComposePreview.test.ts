/**
 * 组合预览的片段选项（2026-11-26 用户：片段配置预览要能选其他片段看出效果）：
 * 片段预览=本品牌全部片段版本（自身置顶，不受模板 policy 约束）；模板预览=按模板 ID 做 policy 过滤。
 */
import { computed, ref } from 'vue'
import { describe, expect, it } from 'vitest'
import { useComposePreview } from './useComposePreview'
import type { TreeNode } from './useContentTree'

function verNode(brand: string, fam: string, dir: string): TreeNode {
  return {
    id: `ver:${brand}:${fam}:${dir}`, label: `${fam}/${dir}`, kind: 'version',
    data: { kind: 'version', source: 'system', path: `${brand}/fragment/${fam}/${dir}`, brandCode: brand, cat: 'fragment', familyCode: fam, versionDir: dir, sourcePath: `${brand}/fragment/${fam}/${dir}/fragment.njk` },
  }
}
function fragTree(): TreeNode[] {
  const root: TreeNode = {
    id: 'root:system', label: '系统', kind: 'root', data: { kind: 'root', source: 'system', path: '' },
    children: [{
      id: 'brand:procell', label: '普诺赛', kind: 'brand', data: { kind: 'brand', source: 'system', path: 'procell', brandCode: 'procell' },
      children: [{
        id: 'cat:fragment', label: '片段', kind: 'category', data: { kind: 'category', source: 'system', path: 'procell/fragment', brandCode: 'procell', cat: 'fragment' },
        children: [
          { id: 'fam:header', label: '页头', kind: 'family', data: { kind: 'family', source: 'system', path: 'procell/fragment/header', brandCode: 'procell', cat: 'fragment', familyCode: 'header', metaPath: 'procell/fragment/header/meta.yaml' }, children: [verNode('procell', 'header', 'v1')] },
          { id: 'fam:footer', label: '页脚', kind: 'family', data: { kind: 'family', source: 'system', path: 'procell/fragment/footer', brandCode: 'procell', cat: 'fragment', familyCode: 'footer', metaPath: 'procell/fragment/footer/meta.yaml' }, children: [verNode('procell', 'footer', 'v1')] },
        ],
      }],
    }],
  }
  return [root]
}

function makePreview(selected: TreeNode) {
  return useComposePreview({
    selected: ref(selected),
    tree: computed(() => fragTree()),
    metaRaw: ref(null),
    read: async () => '',
    previewHtml: ref(''),
    previewing: ref(false),
  })
}

describe('组合预览 · 片段选项', () => {
  it('片段预览：自身置顶 + 本品牌其它片段可选（看出组合效果）', async () => {
    const self = verNode('procell', 'footer', 'v1')
    const preview = makePreview(self)
    await preview.prefetchFamilyMetas()
    const options = preview.composeFragmentOptions.value
    expect(options.length).toBe(2)
    expect(options[0]).toEqual({ id: JSON.stringify({ brandCode: 'procell', kind: 'fragment', familyCode: 'footer', versionDir: 'v1' }), label: 'footer/v1' })
    expect(options[1]?.label).toBe('页头 / header/v1')
    // 自身不重复出现
    expect(options.filter((o) => o.id === options[0]!.id).length).toBe(1)
  })

  it('模板预览：自身不在列表，仅列本品牌片段（policy 缺省时全部允许）', async () => {
    const tpl: TreeNode = {
      id: 'ver:tpl', label: '标准/默认', kind: 'version',
      data: { kind: 'version', source: 'system', path: 'procell/template/standard/default', brandCode: 'procell', cat: 'template', familyCode: 'standard', versionDir: 'default', sourcePath: 'procell/template/standard/default/template.njk' },
    }
    const preview = makePreview(tpl)
    await preview.prefetchFamilyMetas()
    const options = preview.composeFragmentOptions.value
    expect(options.map((o) => o.label).sort()).toEqual(['页头 / header/v1', '页脚 / footer/v1'])
  })
})
