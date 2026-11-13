import { describe, it, expect } from 'vitest'
import type { ToolDescriptor, ToolHostCapabilities } from '@sshk/shared'
import { loadToolPlugins, type PluginHost } from './plugins'

function fakeHost(): PluginHost {
  const ipcMain = {
    handle: () => {},
    removeHandler: () => {},
  } as unknown as PluginHost['ipcMain']
  const host: ToolHostCapabilities = {
    getToolSecret: () => '',
    setToolSecret: () => {},
    chat: async () => '',
    listProviders: () => [],
    chatByProvider: async () => '',
    listModelsByProvider: async () => [],
    runLocalOcr: async () => '',
  }
  return {
    ipcMain,
    repository: {} as PluginHost['repository'],
    outputRoot: '',
    host,
    isActive: () => true,
  }
}

describe('loadToolPlugins', () => {
  it('returns empty status when no tools are given', async () => {
    const status = await loadToolPlugins(fakeHost(), [])
    expect(status).toEqual({})
  })

  it('marks a tool without plugin.main as loaded', async () => {
    const tool = { id: 'no-main', plugin: {} } as unknown as ToolDescriptor
    const status = await loadToolPlugins(fakeHost(), [tool])
    expect(status['no-main']).toEqual({ loaded: true })
  })

  it('skips a runtime tool without an installed record gracefully', async () => {
    const tool = {
      id: 'ghost-runtime',
      plugin: { source: 'external' as const, main: 'dist/main.js' },
    } as unknown as ToolDescriptor
    // userDataDir 指向不存在的目录 → readInstalled 返回 {}，无 record、无 MAIN_LOADER → 跳过
    const status = await loadToolPlugins(fakeHost(), [tool], { userDataDir: '/nonexistent-path-xyz' })
    expect(status['ghost-runtime']).toEqual({ loaded: true })
  })

  it('does not throw on a tool with no main entry', async () => {
    const tool = { id: 'plain', plugin: { renderer: 'dist/page.js' } } as unknown as ToolDescriptor
    await expect(loadToolPlugins(fakeHost(), [tool])).resolves.toEqual({ plain: { loaded: true } })
  })
})
