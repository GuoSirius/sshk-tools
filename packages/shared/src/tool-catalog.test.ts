import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { ACCESS_GRANT } from './constants'
import { mergeToolDefaults, resolveToolCatalog, toolGroups, type ResolveCatalogInput } from './tool-catalog'
import type { ToolDescriptor } from './types'

// 直接拿三个真实工具包的清单做夹具：清单格式不合法这里就会失败。
// 用文件读取而非 import，避免测试夹具被分层规则当成「packages 反向依赖 tools」的代码引用。
function readManifest(id: string): ToolDescriptor {
  const file = fileURLToPath(new URL(`../../../tools/${id}/tool.manifest.json`, import.meta.url))
  return JSON.parse(readFileSync(file, 'utf8')) as ToolDescriptor
}
const edmManifest = readManifest('edm-studio')
const badgeManifest = readManifest('badge-studio')
const modelManifest = readManifest('model-console')
const MANIFESTS = [edmManifest, badgeManifest, modelManifest]

function baseInput(patch: Partial<ResolveCatalogInput> = {}): ResolveCatalogInput {
  return {
    enabled: {},
    grants: {},
    dependsOn: {},
    overrides: {},
    includeTools: null,
    heldGrants: [],
    settingsToolIds: MANIFESTS.map((tool) => tool.id),
    pluginStatus: {},
    hasAccessKey: false,
    ...patch,
  }
}

describe('工具插件清单（自包含 manifest）', () => {
  it('三个工具包清单结构完整且默认零依赖', () => {
    expect(MANIFESTS).toHaveLength(3)
    for (const tool of MANIFESTS) {
      expect(tool.id).toBeTruthy()
      expect(tool.icon).toBe('auto')
      expect(tool.plugin?.renderer).toBeTruthy()
      expect(tool.dependsOn ?? []).toEqual([])
      expect(tool.configDeps ?? []).toEqual([])
      expect(tool.defaults).toBeTruthy()
    }
    expect(toolGroups(MANIFESTS)).toContain('邮件营销')
    expect(toolGroups(MANIFESTS)).toContain('OCR 识别')
  })

  it('一个工具可跨属多个分类 / 标签，且能从应用设置覆盖', () => {
    const result = resolveToolCatalog(MANIFESTS, baseInput())
    const badge = result.tools.find((tool) => tool.id === 'badge-studio')!
    expect(badge.categories).toEqual(['邮件营销', '数据分析', 'OCR 识别', '海报生成'])
    expect(badge.category).toBe('邮件营销')
    expect(badge.configLayout).toBe('single')
    const overridden = resolveToolCatalog(MANIFESTS, baseInput({
      overrides: { 'badge-studio': { category: '增长、投放' } },
    })).tools.find((tool) => tool.id === 'badge-studio')!
    expect(overridden.categories).toEqual(['增长', '投放'])
  })

  it('默认全部可见，分类标签来自清单', () => {
    const result = resolveToolCatalog(MANIFESTS, baseInput())
    expect(result.tools).toHaveLength(MANIFESTS.length)
    expect(result.tools.every((tool) => tool.visible)).toBe(true)
    expect(result.orphans).toEqual([])
  })

  it('禁用一个工具后其它工具仍完全可用（不报错、不隐藏、无警告）', () => {
    const result = resolveToolCatalog(MANIFESTS, baseInput({ enabled: { 'edm-studio': false } }))
    const edm = result.tools.find((tool) => tool.id === 'edm-studio')!
    const others = result.tools.filter((tool) => tool.id !== 'edm-studio')
    expect(edm.visible).toBe(false)
    expect(edm.reason).toBe('已禁用')
    expect(others.every((tool) => tool.visible)).toBe(true)
    expect(others.every((tool) => tool.warnings.length === 0)).toBe(true)
  })

  it('插件加载失败只影响该工具', () => {
    const result = resolveToolCatalog(MANIFESTS, baseInput({
      pluginStatus: { 'edm-studio': { loaded: false, error: '缺少模块' } },
    }))
    expect(result.tools.find((t) => t.id === 'edm-studio')?.reason).toContain('插件加载失败')
    expect(result.tools.filter((t) => t.id !== 'edm-studio').every((t) => t.visible)).toBe(true)
  })

  it('访问密钥权限：未持有 grant 时隐藏，持有后可见', () => {
    const grants = { 'model-console': ACCESS_GRANT }
    expect(resolveToolCatalog(MANIFESTS, baseInput({ grants }))
      .tools.find((t) => t.id === 'model-console')?.reason).toBe('需要访问密钥')
    expect(resolveToolCatalog(MANIFESTS, baseInput({ grants, heldGrants: [ACCESS_GRANT], hasAccessKey: true }))
      .tools.find((t) => t.id === 'model-console')?.visible).toBe(true)
  })

  it('分发白名单只放行指定工具', () => {
    const result = resolveToolCatalog(MANIFESTS, baseInput({ includeTools: ['edm-studio'] }))
    expect(result.tools.filter((t) => t.visible).map((t) => t.id)).toEqual(['edm-studio'])
  })

  it('元数据覆盖生效，空白值回退清单默认', () => {
    const result = resolveToolCatalog(MANIFESTS, baseInput({
      overrides: { 'edm-studio': { name: '邮件工厂', icon: 'https://x/logo.svg', description: '  ' } },
    }))
    const edm = result.tools.find((tool) => tool.id === 'edm-studio')!
    expect(edm.name).toBe('邮件工厂')
    expect(edm.icon).toBe('https://x/logo.svg')
    expect(edm.description).toBe(edmManifest.description)
  })

  it('可配置依赖：设置后依赖链传播；清空即恢复零依赖', () => {
    const linked = resolveToolCatalog(MANIFESTS, baseInput({
      dependsOn: { 'badge-studio': ['edm-studio'] },
      enabled: { 'edm-studio': false },
    }))
    expect(linked.tools.find((t) => t.id === 'badge-studio')?.reason).toContain('依赖不可用')
    const clean = resolveToolCatalog(MANIFESTS, baseInput({ enabled: { 'edm-studio': false } }))
    expect(clean.tools.find((t) => t.id === 'badge-studio')?.visible).toBe(true)
  })

  it('识别已删除工具留下的孤儿配置', () => {
    const result = resolveToolCatalog(MANIFESTS, baseInput({
      settingsToolIds: [...MANIFESTS.map((t) => t.id), 'removed-tool'],
    }))
    expect(result.orphans).toEqual(['removed-tool'])
  })

  it('工具配置布局可用 single / tabs / menu，菜单布局由宿主生成二级项', () => {
    const withMenu = MANIFESTS.map((tool) => tool.id === 'edm-studio'
      ? { ...tool, configLayout: 'menu' as const }
      : tool)
    const result = resolveToolCatalog(withMenu, baseInput())
    expect(result.tools.find((t) => t.id === 'edm-studio')?.configLayout).toBe('menu')
    expect(result.tools.find((t) => t.id === 'badge-studio')?.configLayout).toBe('single')
  })

  it('工具菜单只声明工具自有配置分组', () => {
    const result = resolveToolCatalog(MANIFESTS, baseInput())
    for (const tool of result.tools) {
      const configMenu = tool.menus.find((menu) => menu.id === 'config')
      expect(configMenu?.label).toBe('工具配置')
      for (const child of configMenu?.children ?? []) {
        expect(tool.configGroups.some((group) => group.id === child.id)).toBe(true)
      }
    }
  })

  it('新工具包零改动接入：加进清单即出现在目录并自动合并默认配置', () => {
    const extra = {
      id: 'third-party-tool',
      name: '第三方工具',
      description: '外部开发者提供',
      category: '扩展',
      icon: 'auto',
      entryRoute: 'home',
      enabled: true,
      plugin: { source: 'external', renderer: 'src/renderer/Page.vue' },
      menus: [{ id: 'home', label: '首页' }],
      defaults: { apiUrl: 'https://example.com', enabled: true },
    } as unknown as ToolDescriptor
    const all = [...MANIFESTS, extra]
    const result = resolveToolCatalog(all, baseInput())
    expect(result.tools.find((t) => t.id === extra.id)?.visible).toBe(true)
    const settings = mergeToolDefaults({ app: { themeMode: 'dark' }, tools: {} }, all)
    expect(settings.tools?.[extra.id]).toMatchObject({ apiUrl: 'https://example.com', enabled: true })
    expect(settings.app?.themeMode).toBe('dark')
  })
})
