import { describe, it, expect, vi } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ToolDescriptor, ToolHostCapabilities } from '@sshk/shared'
import { loadToolPlugins, type PluginHost } from './plugins'

// MAIN_LOADERS 可控注入：默认空表（不影响既有用例），源码优先用例再登记
const { loaders, registered } = vi.hoisted(() => ({
  loaders: {} as Record<string, () => Promise<unknown>>,
  registered: [] as string[],
}))
vi.mock('./discovery', () => ({ MAIN_LOADERS: loaders, MANIFESTS: [] }))

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

  it('prefers the builtin loader over an installed runtime record (源码优先)', async () => {
    // 同 id 同时存在 tools/ 内建入口与安装副本：必须走内建入口，安装副本目录即使存在也绝不被执行
    const dir = mkdtempSync(join(tmpdir(), 'sshk-plugins-'))
    try {
      const pkgDir = join(dir, 'runtime-tools', 'packages', 'src-first', '1.0.0')
      mkdirSync(pkgDir, { recursive: true })
      writeFileSync(
        join(dir, 'runtime-tools', 'installed.json'),
        JSON.stringify({
          'src-first': {
            id: 'src-first', version: '1.0.0', sha256: 'x',
            trustLevel: 'unsigned', sandbox: 'main', installedAt: '2026-11-14T00:00:00+08:00',
          },
        }),
      )
      writeFileSync(join(pkgDir, 'main.js'), 'export default () => { throw new Error("安装副本被误加载") }')
      loaders['src-first'] = async () => ({
        default: () => { registered.push('src-first') },
      })
      const tool = {
        id: 'src-first',
        plugin: { source: 'external' as const, main: 'main.js' },
      } as unknown as ToolDescriptor
      const status = await loadToolPlugins(fakeHost(), [tool], { userDataDir: dir })
      expect(status['src-first']).toEqual({ loaded: true })
      expect(registered).toEqual(['src-first'])
    } finally {
      delete loaders['src-first']
      registered.length = 0
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
