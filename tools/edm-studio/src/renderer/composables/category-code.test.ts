import { describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { useNodeDetail } from './useNodeDetail'
import type { TreeNode } from './useContentTree'

vi.mock('element-plus', () => ({ ElMessage: { success: vi.fn(), error: vi.fn(), warning: vi.fn() }, ElMessageBox: { confirm: vi.fn() } }))
vi.mock('../tool-api', () => ({ api: vi.fn() }))
vi.mock('../upload.js', () => ({ uploadInlineImages: (s: string) => Promise.resolve(s) }))

function categoryNode(): TreeNode {
  return {
    id: 'cat:custom:demo:template', label: '模板', kind: 'category',
    data: { kind: 'category', source: 'custom', path: 'demo/template', brandCode: 'demo', cat: 'template', metaPath: 'demo/template/meta.yaml' },
  }
}

describe('类型节点元数据编辑（meta.yaml 不存在）', () => {
  it('空文件不进数据模式，code 同步为目录名 template，填 name 后可保存', async () => {
    const node = categoryNode()
    const read = vi.fn().mockResolvedValue('')
    const write = vi.fn().mockResolvedValue(undefined)
    const d = useNodeDetail({ selected: ref(node), read, write, load: vi.fn().mockResolvedValue(undefined), toolId: ref('edm') })
    await d.loadNode(node)

    expect(d.metaMode.value).toBe('form') // 关键：js-yaml load('') 不再抛异常掉进数据模式
    expect(d.form.value.code).toBe('template')
    d.form.value.name = '模板'
    await d.saveMeta()
    expect(write).toHaveBeenCalledWith('demo/template/meta.yaml', expect.stringContaining('code: template'), 'custom')
  })
})

describe('版本元数据版本号只读派生', () => {
  function versionNode(): TreeNode {
    return {
      id: 'ver:custom:demo:fragment:hero:v1', label: 'v1', kind: 'version',
      data: {
        kind: 'version', source: 'custom', path: 'demo/fragment/hero/v1', brandCode: 'demo', cat: 'fragment',
        familyCode: 'hero', versionDir: 'v1', metaPath: 'demo/fragment/hero/v1/meta.yaml',
        sourcePath: 'demo/fragment/hero/v1/fragment.njk', samplePath: 'demo/fragment/hero/v1/sample.yaml',
      },
    }
  }

  it('meta.yaml 手填 version:3 但目录是 v1，表单显示 1、保存写回 1', async () => {
    const node = versionNode()
    const read = vi.fn().mockImplementation(async (f: string) => {
      if (f.endsWith('meta.yaml')) return 'code: v1\nname: V1\nversion: 3\n'
      return ''
    })
    const write = vi.fn().mockResolvedValue(undefined)
    const d = useNodeDetail({ selected: ref(node), read, write, load: vi.fn().mockResolvedValue(undefined), toolId: ref('edm') })
    await d.loadNode(node)

    expect(d.form.value.version).toBe(1)
    await d.saveMeta()
    const metaWrite = write.mock.calls.find((c) => String(c[0]).endsWith('meta.yaml'))
    expect(metaWrite?.[1]).toContain('version: 1')
    expect(metaWrite?.[1]).not.toContain('version: 3')
  })
})
