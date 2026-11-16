import { describe, expect, it } from 'vitest'
import { collectToolHealth, lastToolError } from './health'
import type { ToolCatalogPayload, ToolRuntimeState } from '@sshk/shared'

/** 最小可用目录 payload：只填健康聚合用到的字段 */
function fakeCatalog(partial: {
  tools: Partial<ToolRuntimeState>[]
  pluginStatus?: Record<string, { loaded: boolean; error?: string }>
}): ToolCatalogPayload {
  return {
    tools: partial.tools.map((t) => ({
      id: t.id ?? '',
      name: t.name ?? '',
      description: '',
      category: '',
      categories: [],
      icon: '',
      menus: [],
      entryRoute: '',
      configLayout: 'single' as const,
      enabled: t.enabled ?? true,
      visible: t.visible ?? true,
      manageable: true,
      serviceable: true,
      visibility: 'desktop' as const,
      available: true,
      runtime: false,
      pluginError: t.pluginError,
      warnings: t.warnings ?? [],
      dependsOn: t.dependsOn ?? [],
      configGroups: [],
      configPages: [],
      configDeps: [],
    })),
    orphans: [],
    hasAccessKey: false,
    grants: [],
    includeTools: null,
    pluginStatus: partial.pluginStatus ?? {},
  }
}

describe('lastToolError（N2 日志检索）', () => {
  const lines = [
    '[10:00:00] [INFO ] [plugin] badge-studio 插件已加载',
    '[10:05:12] [ERROR] [plugin] badge-studio 插件加载失败：入口缺失 apiKey=***',
    '[10:06:00] [ERROR] [llm] chat failed',
    '[11:30:41] [ERROR] [upload] badge-studio 批量上传 2/5 失败',
  ]

  it('取最近的匹配 error 行（忽略 info 与无关工具）', () => {
    const hit = lastToolError(lines, 'badge-studio')
    expect(hit?.time).toBe('11:30:41')
    expect(hit?.text).toContain('批量上传 2/5 失败')
  })

  it('无匹配返回 null', () => {
    expect(lastToolError(lines, 'no-such-tool')).toBeNull()
    expect(lastToolError([], 'badge-studio')).toBeNull()
  })

  it('长错误行截断到 300 字符', () => {
    const long = '[12:00:00] [ERROR] [x] ' + 'badge-studio ' + 'y'.repeat(500)
    expect(lastToolError([long], 'badge-studio')?.text.length).toBe(300)
  })
})

describe('collectToolHealth（N2 聚合）', () => {
  it('五态判定：正常 / 告警 / 禁用 / 插件失败 / 依赖缺失，异常数正确', () => {
    const payload = collectToolHealth(
      fakeCatalog({
        tools: [
          { id: 'ok-tool', name: '正常' },
          { id: 'warn-tool', name: '告警', warnings: ['配置缺失已回退默认'] },
          { id: 'off-tool', name: '禁用', enabled: false, visible: false },
          { id: 'bad-plugin', name: '插件失败', pluginError: '入口缺失' },
          { id: 'dep-tool', name: '缺依赖', dependsOn: ['off-tool'] },
        ],
        pluginStatus: { 'ok-tool': { loaded: true }, 'bad-plugin': { loaded: false, error: '入口缺失' } },
      }),
      [{ id: 'ok-tool', plugin: { channels: ['tool:ping'] } }],
    )
    const byId = Object.fromEntries(payload.tools.map((t) => [t.id, t]))
    expect(byId['ok-tool']?.state).toBe('ok')
    expect(byId['ok-tool']?.channels).toBe(1)
    expect(byId['warn-tool']?.state).toBe('warn')
    expect(byId['off-tool']?.state).toBe('disabled')
    expect(byId['bad-plugin']?.state).toBe('plugin-failed')
    expect(byId['bad-plugin']?.plugin).toContain('入口缺失')
    expect(byId['dep-tool']?.state).toBe('dep-missing')
    expect(byId['dep-tool']?.missingDeps).toEqual(['off-tool'])
    expect(payload.ok).toBe(1)
    expect(payload.abnormal).toBe(4)
  })

  it('日志命中时回填 lastError；无日志目录环境不抛错', () => {
    const payload = collectToolHealth(
      fakeCatalog({ tools: [{ id: 'badge-studio', name: '角标工作台' }] }),
      [],
    )
    // 测试环境无 userData/logs，lastError 为 null 且整体正常返回（容错不抛）
    expect(payload.tools[0]?.lastError).toBeNull()
    expect(payload.tools[0]?.state).toBe('ok')
    expect(payload.generatedAt).toBeTruthy()
  })
})
