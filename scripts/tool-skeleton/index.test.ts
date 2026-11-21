import { describe, expect, it } from 'vitest'
import { IPC_CHANNELS } from '@sshk/shared'
import { assertCreateRequest, buildSkeletonFiles } from './index'
import type { CreateToolRequest } from './index'

function baseRequest(): CreateToolRequest {
  return {
    id: 'demo-tool',
    name: '演示工具',
    description: '用于骨架生成的演示',
    category: '开发',
    menus: [
      { id: 'home', label: '首页' },
      { id: 'settings-view', label: '设置视图' },
    ],
    configLayout: 'single',
    configGroups: [
      {
        id: 'config-basic',
        label: '基础',
        fields: [
          { key: 'greeting', label: '问候语', type: 'string' },
          { key: 'llm.enabled', label: '启用', type: 'boolean' },
          { key: 'llm.limit', label: '上限', type: 'number', min: 5 },
          { key: 'llm.format', label: '格式', type: 'select', options: [{ label: 'A', value: 'a' }] },
        ],
      },
    ],
  }
}

describe('dev-skeleton 创建工具骨架', () => {
  it('生成全套骨架文件：manifest / package / tsconfig / icon / main / state / 壳 / 每菜单一页', () => {
    const files = buildSkeletonFiles(baseRequest())
    const paths = files.map((f) => f.path)
    expect(paths).toContain('tools/demo-tool/tool.manifest.json')
    expect(paths).toContain('tools/demo-tool/package.json')
    expect(paths).toContain('tools/demo-tool/tsconfig.json')
    expect(paths).toContain('tools/demo-tool/assets/icon.svg')
    expect(paths).toContain('tools/demo-tool/src/main/index.ts')
    expect(paths).toContain('tools/demo-tool/src/renderer/state.ts')
    expect(paths).toContain('tools/demo-tool/src/renderer/DemoToolPage.vue')
    expect(paths).toContain('tools/demo-tool/src/renderer/pages/HomePage.vue')
    expect(paths).toContain('tools/demo-tool/src/renderer/pages/SettingsViewPage.vue')
    expect(files.every((f) => f.content.length > 0)).toBe(true)
  })

  it('manifest 契约自洽：id=目录名、入口=首菜单、通道登记、defaults 按字段类型生成', () => {
    const manifest = JSON.parse(
      buildSkeletonFiles(baseRequest()).find((f) => f.path.endsWith('tool.manifest.json'))!.content,
    ) as Record<string, unknown>
    expect(manifest.id).toBe('demo-tool')
    expect(manifest.entryRoute).toBe('home')
    expect((manifest.plugin as Record<string, unknown>).channels).toEqual(['demo-tool:ping'])
    expect(manifest.defaults).toEqual({
      greeting: '',
      llm: { enabled: false, limit: 5, format: 'a' },
    })
    // IPC 通道必须在 shared 常量之外可校验：manifest 使用 builtin 源 + 工具自身通道前缀
    expect(String((manifest.plugin as Record<string, unknown>).renderer)).toContain('DemoToolPage.vue')
  })

  it('多菜单壳：每个菜单 import 一个页面组件，未知 menu 回退首菜单', () => {
    const shell = buildSkeletonFiles(baseRequest()).find((f) => f.path.endsWith('DemoToolPage.vue'))!.content
    expect(shell).toContain("import HomePage from './pages/HomePage.vue'")
    expect(shell).toContain("import SettingsViewPage from './pages/SettingsViewPage.vue'")
    expect(shell).toContain("'home': HomePage,")
    expect(shell).toContain("'settings-view': SettingsViewPage,")
  })

  it('menu 形态：configPages 透传进 manifest；引用不存在的分组被拒绝', () => {
    const req = baseRequest()
    req.configLayout = 'menu'
    req.configPages = [{ id: 'config-basic-page', label: '基础页', groups: ['config-basic'] }]
    const manifest = JSON.parse(
      buildSkeletonFiles(req).find((f) => f.path.endsWith('tool.manifest.json'))!.content,
    ) as Record<string, unknown>
    expect(manifest.configLayout).toBe('menu')
    expect(manifest.configPages).toEqual(req.configPages)

    req.configPages = [{ id: 'config-x', label: '坏页', groups: ['no-such-group'] }]
    expect(() => buildSkeletonFiles(req)).toThrow(/不存在的分组/)
  })

  it('非法请求被拒绝：id / 空菜单 / 重复菜单 id / 非法配置页 id', () => {
    expect(() => assertCreateRequest({ ...baseRequest(), id: 'Bad_ID' })).toThrow(/id 非法/)
    expect(() => assertCreateRequest({ ...baseRequest(), menus: [] })).toThrow(/至少需要一个菜单/)
    const dup = baseRequest()
    dup.menus = [{ id: 'home', label: 'A' }, { id: 'home', label: 'B' }]
    expect(() => assertCreateRequest(dup)).toThrow(/菜单 id 重复/)
    const badPage = baseRequest()
    badPage.configLayout = 'menu'
    badPage.configPages = [{ id: 'basic', label: '页', groups: ['config-basic'] }]
    expect(() => assertCreateRequest(badPage)).toThrow(/config- 开头/)
  })

  it('通道 dev:toolCreate 已登记于 IPC 常量表', () => {
    expect(IPC_CHANNELS.devToolCreate).toBe('dev:toolCreate')
  })
})
