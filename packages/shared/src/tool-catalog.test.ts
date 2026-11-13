import { describe, expect, it } from 'vitest'
import { ACCESS_GRANT, TOOL_IDS } from './constants'
import { TOOLS, resolveToolCatalog, type ResolveCatalogInput } from './tool-catalog'

function baseInput(patch: Partial<ResolveCatalogInput> = {}): ResolveCatalogInput {
  return {
    enabled: {},
    grants: {},
    overrides: {},
    includeTools: null,
    heldGrants: [],
    settingsToolIds: TOOLS.map((tool) => tool.id),
    hasAccessKey: false,
    ...patch,
  }
}

describe('工具目录裁决（单一裁决方）', () => {
  it('默认全部工具可见', () => {
    const result = resolveToolCatalog(baseInput())
    expect(result.tools).toHaveLength(TOOLS.length)
    expect(result.tools.every((tool) => tool.visible)).toBe(true)
    expect(result.orphans).toEqual([])
  })

  it('禁用开关生效并给出原因', () => {
    const result = resolveToolCatalog(baseInput({ enabled: { [TOOL_IDS.edmStudio]: false } }))
    const edm = result.tools.find((tool) => tool.id === TOOL_IDS.edmStudio)!
    expect(edm.visible).toBe(false)
    expect(edm.reason).toBe('已禁用')
  })

  it('访问密钥权限：未持有 grant 时隐藏，持有后可见', () => {
    const grants = { [TOOL_IDS.modelConsole]: ACCESS_GRANT }
    const locked = resolveToolCatalog(baseInput({ grants }))
    expect(locked.tools.find((t) => t.id === TOOL_IDS.modelConsole)?.reason).toBe('需要访问密钥')
    const unlocked = resolveToolCatalog(baseInput({ grants, heldGrants: [ACCESS_GRANT], hasAccessKey: true }))
    expect(unlocked.tools.find((t) => t.id === TOOL_IDS.modelConsole)?.visible).toBe(true)
    expect(unlocked.hasAccessKey).toBe(true)
  })

  it('分发白名单只放行指定工具', () => {
    const result = resolveToolCatalog(baseInput({ includeTools: [TOOL_IDS.edmStudio] }))
    expect(result.tools.filter((t) => t.visible).map((t) => t.id)).toEqual([TOOL_IDS.edmStudio])
    expect(result.tools.find((t) => t.id === TOOL_IDS.badgeStudio)?.reason).toContain('分发')
  })

  it('元数据覆盖生效，空白值回退注册表默认', () => {
    const result = resolveToolCatalog(baseInput({
      overrides: { [TOOL_IDS.edmStudio]: { name: '邮件工厂', icon: 'https://x/logo.svg', description: '  ' } },
    }))
    const edm = result.tools.find((tool) => tool.id === TOOL_IDS.edmStudio)!
    const raw = TOOLS.find((tool) => tool.id === TOOL_IDS.edmStudio)!
    expect(edm.name).toBe('邮件工厂')
    expect(edm.icon).toBe('https://x/logo.svg')
    expect(edm.description).toBe(raw.description)
  })

  it('软依赖缺失只预警，不硬隐藏', () => {
    const result = resolveToolCatalog(baseInput({ enabled: { [TOOL_IDS.edmStudio]: false } }))
    const badge = result.tools.find((tool) => tool.id === TOOL_IDS.badgeStudio)!
    expect(badge.visible).toBe(true)
    expect(badge.warnings.join('')).toContain('软依赖不可用')
  })

  it('识别已删除工具留下的孤儿配置', () => {
    const result = resolveToolCatalog(baseInput({ settingsToolIds: [...TOOLS.map((t) => t.id), 'removed-tool'] }))
    expect(result.orphans).toEqual(['removed-tool'])
  })

  it('工具菜单只声明工具自有配置分组', () => {
    const result = resolveToolCatalog(baseInput())
    for (const tool of result.tools) {
      const configMenu = tool.menus.find((menu) => menu.id === 'config')
      expect(configMenu?.label).toBe('工具配置')
      for (const child of configMenu?.children ?? []) {
        expect(tool.configGroups.some((group) => group.id === child.id)).toBe(true)
      }
    }
  })
})
