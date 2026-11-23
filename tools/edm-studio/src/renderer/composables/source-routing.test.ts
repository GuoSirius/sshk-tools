import { describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { useCssTabs } from './useCssTabs'
import { useNodeDetail } from './useNodeDetail'
import type { TreeNode } from './useContentTree'

const messages = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn() }))
vi.mock('element-plus', () => ({ ElMessage: messages, ElMessageBox: { confirm: vi.fn() } }))
vi.mock('../tool-api', () => ({ api: vi.fn() }))
vi.mock('../upload.js', () => ({ uploadInlineImages: (s: string) => Promise.resolve(s) }))

function brandNode(): TreeNode {
  return {
    id: 'brand:custom:demo', label: 'demo', kind: 'brand',
    data: { kind: 'brand', source: 'custom', path: 'demo', brandCode: 'demo', metaPath: 'demo/meta.yaml' },
  }
}

describe('详情编辑写入自定义根', () => {
  it('保存元数据写到选中节点的 source，而不是默认 system', async () => {
    const read = vi.fn().mockResolvedValue('code: demo\nname: demo\n')
    const write = vi.fn().mockResolvedValue(undefined)
    const load = vi.fn().mockResolvedValue(undefined)
    const node = brandNode()
    const detail = useNodeDetail({ selected: ref(node), read, write, load, toolId: ref('edm-studio') })
    await detail.loadNode(node)
    detail.form.value.name = 'Demo 自定义'
    await detail.saveMeta()
    expect(write).toHaveBeenCalledWith('demo/meta.yaml', expect.stringContaining('Demo 自定义'), 'custom')
    expect(load).toHaveBeenCalledWith(true)
  })

  it('name 必填校验失败时停留，不发 IPC', async () => {
    const read = vi.fn().mockResolvedValue('code: demo\nname: demo\n')
    const write = vi.fn().mockResolvedValue(undefined)
    const node = brandNode()
    const detail = useNodeDetail({ selected: ref(node), read, write, load: vi.fn(), toolId: ref('edm-studio') })
    await detail.loadNode(node)
    detail.form.value.name = '   '
    await detail.saveMeta()
    expect(write).not.toHaveBeenCalled()
  })

  it('字段定义读取/写回也带 source', async () => {
    const read = vi.fn().mockResolvedValue('code: demo\nname: demo\n')
    const write = vi.fn().mockResolvedValue(undefined)
    const node = brandNode()
    const detail = useNodeDetail({ selected: ref(node), read, write, load: vi.fn(), toolId: ref('edm-studio') })
    await detail.loadNode(node)
    await detail.saveFields()
    expect(read).toHaveBeenCalledWith('demo/meta.yaml', 'custom')
    expect(write).toHaveBeenCalledWith('demo/meta.yaml', expect.any(String), 'custom')
  })
})

describe('css 多 tab 读写自定义根', () => {
  it('打开/保存 tab 均按节点来源路由，且同名路径不串根', async () => {
    const read = vi.fn().mockResolvedValue('body{}')
    const write = vi.fn().mockResolvedValue(undefined)
    const node: TreeNode = {
      id: 'cssFile:custom:demo/css/a.css', label: 'a.css', kind: 'cssFile',
      data: { kind: 'cssFile', source: 'custom', path: 'demo/css/a.css' },
    }
    const tabs = useCssTabs({ read, write, selected: ref(node), renderPreview: vi.fn() })
    await tabs.openCssTab('demo/css/a.css', 'custom')
    expect(read).toHaveBeenCalledWith('demo/css/a.css', 'custom')
    expect(tabs.activeCss.value).toBe('custom:demo/css/a.css')
    tabs.onCssEdit(tabs.activeCss.value, 'body{color:red}')
    const active = tabs.activeTab.value
    expect(active).not.toBeNull()
    await tabs.saveCss(active!)
    expect(messages.error).not.toHaveBeenCalled()
    expect(write).toHaveBeenCalledWith('demo/css/a.css', 'body{color:red}', 'custom')
  })

  it('目录重命名后已开 tab 迁移路径与 id，选中态不丢', async () => {
    const read = vi.fn().mockResolvedValue('body{}')
    const tabs = useCssTabs({ read, write: vi.fn(), selected: ref(null), renderPreview: vi.fn() })
    await tabs.openCssTab('demo/css/a.css', 'custom')
    tabs.renameTabsUnder('demo', 'demo-v2')
    expect(tabs.cssTabs.value[0]?.file).toBe('demo-v2/css/a.css')
    expect(tabs.activeCss.value).toBe('custom:demo-v2/css/a.css')
  })
})
