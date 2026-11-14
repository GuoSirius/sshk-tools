import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { ACCESS_GRANT } from './constants'
import {
  collectDefaultProviders,
  mergeToolDefaults,
  resolveToolCatalog,
  shouldSeedDefaultProviders,
  toolCategories,
  toolGroups,
  type ResolveCatalogInput,
} from './tool-catalog'
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
// edm 的 visibility:hidden 是发布策略，裁决单测保持 desktop 基准
const MANIFESTS = [edmManifest, badgeManifest, modelManifest]
delete (edmManifest as { visibility?: string }).visibility

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
  it('全部工具包清单结构完整且默认零依赖', () => {
    expect(MANIFESTS.length).toBeGreaterThanOrEqual(3)
    for (const tool of MANIFESTS) {
      expect(tool.id).toBeTruthy()
      expect(tool.icon).toBeTruthy()
      expect(tool.plugin?.renderer).toBeTruthy()
      expect(tool.dependsOn ?? []).toEqual([])
      expect(tool.configDeps ?? []).toEqual([])
      expect(tool.defaults).toBeTruthy()
    }
    // 分组自洽：清单声明的每个分类/标签都应出现在目录分组里。
    // 断言只校验「派生与清单一致」，不硬编码任何文案——开发者随意改分类/标签不被门禁误杀（台账 #22）。
    const groups = toolGroups(MANIFESTS)
    expect(groups.length).toBeGreaterThan(0)
    for (const tool of MANIFESTS) {
      for (const category of toolCategories(tool)) expect(groups).toContain(category)
    }
  })

  it('一个工具可跨属多个分类 / 标签（含空格），且能从应用设置覆盖', () => {
    // 逻辑测试用内联夹具，不耦合真实清单内容（台账 #22）
    const fixture = {
      id: 'fixture-multi', name: '多分类工具', description: '内容随意',
      category: ['分类 甲', '分类乙'], tags: ['标签 丙', '标签丁'],
      icon: 'auto', entryRoute: 'home', enabled: true,
      menus: [], plugin: { source: 'builtin', renderer: 'x.vue' }, defaults: {},
    } as unknown as ToolDescriptor
    const derived = resolveToolCatalog([fixture], baseInput({ settingsToolIds: ['fixture-multi'] }))
      .tools.find((tool) => tool.id === 'fixture-multi')!
    // category + tags 去重串联；空格是标签合法字符（#21）
    expect(derived.categories).toEqual(['分类 甲', '分类乙', '标签 丙', '标签丁'])
    expect(derived.category).toBe('分类 甲')
    const overridden = resolveToolCatalog([fixture], baseInput({
      settingsToolIds: ['fixture-multi'],
      overrides: { 'fixture-multi': { category: '增长、投放' } },
    })).tools.find((tool) => tool.id === 'fixture-multi')!
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
    expect(result.tools.find((t) => t.id === 'badge-studio')?.configLayout).toBe(badgeManifest.configLayout ?? 'single')
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

  it('模型预设由工具包自带：含常用端点与可选模型，且不含任何密钥字段', () => {
    type Preset = { id: string; name: string; baseURL: string; models: string[]; defaultModel: string }
    const presets = ((modelManifest as unknown as { defaults?: { modelPresets?: Preset[] } })
      .defaults?.modelPresets ?? [])
    expect(presets.length).toBeGreaterThanOrEqual(4)
    const agnes = presets.find((preset) => preset.id === 'agnes')
    expect(agnes?.baseURL).toBe('https://apihub.agnes-ai.com/v1')
    expect(agnes?.models).toContain('agnes-3.0-flash')
    expect(agnes?.models).toContain('agnes-3.0-pro')
    for (const preset of presets) {
      expect(preset.baseURL).toMatch(/^https?:\/\//)
      for (const field of Object.keys(preset)) {
        expect(['apiKey', 'token', 'secret', 'password']).not.toContain(field)
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

describe('默认 Provider 播种（应用级共享）', () => {
  it('从工具包 manifest 收集公开端点，默认就是 Agnes AI 且不含任何密钥', () => {
    const seeds = collectDefaultProviders(MANIFESTS)
    expect(seeds[0]).toMatchObject({
      _id: 'prv_agnesai',
      baseURL: 'https://apihub.agnes-ai.com/v1',
      model: 'agnes-3.0-flash',
      enabled: true,
    })
    expect(seeds[0]!._id).toMatch(/^prv_[0-9a-z]+$/)
    for (const seed of seeds) {
      for (const field of Object.keys(seed)) {
        expect(['apiKey', 'token', 'secret', 'password']).not.toContain(field)
      }
    }
  })

  it('只在「从未播种过且当前无 Provider」时播种；用户删空后重启不复活', () => {
    expect(shouldSeedDefaultProviders(false, [])).toBe(true)
    expect(shouldSeedDefaultProviders(undefined, undefined)).toBe(true)
    expect(shouldSeedDefaultProviders(true, [])).toBe(false)
    expect(shouldSeedDefaultProviders(false, [{ _id: 'prv_custom' }])).toBe(false)
  })

  it('拒绝非法 id、非 http(s) 端点与重复 id，宿主不硬编码厂商信息', () => {
    const tool = (id: string, baseURL: string) => ({
      id: 'fake',
      defaults: { defaultProviders: [{ _id: id, name: 'X', baseURL, model: 'm' }] },
    }) as unknown as ToolDescriptor
    expect(collectDefaultProviders([tool('prv_bad_ID', 'https://a.com/v1')])).toHaveLength(0)
    expect(collectDefaultProviders([tool('prv_ok', 'file:///etc/passwd')])).toHaveLength(0)
    const dup = {
      id: 'fake',
      defaults: {
        defaultProviders: [
          { _id: 'prv_same', baseURL: 'https://a.com/v1', model: 'm' },
          { _id: 'prv_same', baseURL: 'https://b.com/v1', model: 'n' },
        ],
      },
    } as unknown as ToolDescriptor
    expect(collectDefaultProviders([dup])).toHaveLength(1)
  })
})

describe('工具两类四态（隐式基座 / 显式可见性分级）', () => {
  function fake(id: string, visibility: 'implicit' | 'hidden' | 'managed' | 'desktop', enabled = true) {
    return {
      id, name: id, description: id, category: '测试', icon: 'auto', entryRoute: 'home',
      enabled, visibility,
      menus: [{ id: 'home', label: '首页' }],
      plugin: { source: 'builtin', renderer: 'src/renderer/Page.vue' },
    } as unknown as ToolDescriptor
  }

  it('隐式基座：恒不上桌面、不进权限列表，但能力可被依赖', () => {
    const base = fake('render-base', 'implicit')
    const app = fake('edm-app', 'desktop')
    ;(app as { dependsOn?: string[] }).dependsOn = ['render-base']
    const result = resolveToolCatalog([base, app], baseInput({
      enabled: { 'render-base': true, 'edm-app': true },
      dependsOn: { 'edm-app': ['render-base'] },
    }))
    const state = (id: string) => result.tools.find((t) => t.id === id)!
    expect(state('render-base')).toMatchObject({ visible: false, manageable: false, serviceable: true })
    // 依赖链按 serviceable 传播：基座桌面不可见，但依赖它的显式工具正常上桌面
    expect(state('edm-app').visible).toBe(true)
  })

  it('显式三态：hidden 双隐藏、managed 权限列表可控、desktop 默认上桌面', () => {
    const tools = [
      fake('a-hidden', 'hidden'),
      fake('b-managed', 'managed', false),
      fake('c-desktop', 'desktop'),
    ]
    const result = resolveToolCatalog(tools, baseInput({
      enabled: { 'a-hidden': true, 'b-managed': false, 'c-desktop': true },
    }))
    const state = (id: string) => result.tools.find((t) => t.id === id)!
    expect(state('a-hidden')).toMatchObject({ visible: false, manageable: false })
    expect(state('b-managed')).toMatchObject({ visible: false, manageable: true, reason: '已禁用' })
    expect(state('c-desktop')).toMatchObject({ visible: true, manageable: true })
    // managed 在权限列表开启后即上桌面
    const on = resolveToolCatalog(tools, baseInput({
      enabled: { 'b-managed': true, 'a-hidden': true, 'c-desktop': true },
    }))
    expect(on.tools.find((t) => t.id === 'b-managed')!.visible).toBe(true)
  })

  it('基座被禁用时，依赖它的显式工具随之隐藏', () => {
    const base = fake('render-base', 'implicit', false)
    const app = fake('edm-app', 'desktop')
    const result = resolveToolCatalog([base, app], baseInput({
      enabled: { 'render-base': false, 'edm-app': true },
      dependsOn: { 'edm-app': ['render-base'] },
    }))
    const appState = result.tools.find((t) => t.id === 'edm-app')!
    expect(appState.visible).toBe(false)
    expect(appState.reason).toContain('依赖不可用')
  })
})
