import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * baked-env 语义测试（getEnv 统一取值入口）。
 * 烤入表 __SSHK_BAKED_ENV__ 是构建期 define 注入的全局——测试用 stubGlobal 模拟注入，
 * 配合 resetModules 让每次用例拿到独立的模块实例（BAKED 在 import 时固化）。
 * 测试键均使用 .env.example 已声明的真实键（check-env 契约：读到的键必须有声明）。
 */
describe('getEnv：烤入 + 覆盖白名单', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  async function load(baked: Record<string, string>) {
    vi.resetModules()
    vi.stubGlobal('__SSHK_BAKED_ENV__', baked)
    return await import('./baked-env')
  }

  it('烤入键默认锁定：本机 env 无法覆盖', async () => {
    const { getEnv } = await load({ SSHK_APP_DEVTOOLS_KEY: 'from-env-file' })
    vi.stubEnv('SSHK_APP_DEVTOOLS_KEY', 'from-machine')
    expect(getEnv('SSHK_APP_DEVTOOLS_KEY')).toBe('from-env-file')
  })

  it('白名单键允许本机覆盖，未设置时回落烤入值', async () => {
    const { getEnv } = await load({
      SSHK_APP_AUTO_UPDATE: '1',
      SSHK_APP_OVERRIDABLE: 'SSHK_APP_AUTO_UPDATE',
    })
    expect(getEnv('SSHK_APP_AUTO_UPDATE')).toBe('1')
    vi.stubEnv('SSHK_APP_AUTO_UPDATE', '0')
    expect(getEnv('SSHK_APP_AUTO_UPDATE')).toBe('0')
  })

  it('白名单自身永远锁死：本机无法给自己授权', async () => {
    const { getEnv } = await load({ SSHK_APP_OVERRIDABLE: 'SSHK_APP_AUTO_UPDATE' })
    vi.stubEnv('SSHK_APP_OVERRIDABLE', 'SSHK_APP_DEVTOOLS_KEY,SSHK_APP_AUTO_UPDATE')
    expect(getEnv('SSHK_APP_OVERRIDABLE')).toBe('SSHK_APP_AUTO_UPDATE')
    // 白名单按烤入值生效；未烤入键不受白名单约束（本机 env 是其唯一来源，照常读取）
    vi.stubEnv('SSHK_APP_DEVTOOLS_KEY', 'from-machine')
    expect(getEnv('SSHK_APP_DEVTOOLS_KEY')).toBe('from-machine')
  })

  it('未烤入的键走运行时本机 env（可设可不设）', async () => {
    const { getEnv } = await load({})
    expect(getEnv('SSHK_DEV_UPDATE_TEST')).toBeUndefined()
    vi.stubEnv('SSHK_DEV_UPDATE_TEST', '1')
    expect(getEnv('SSHK_DEV_UPDATE_TEST')).toBe('1')
  })

  it('getEnvStr：trim、空白/未设置回落 fallback', async () => {
    const { getEnvStr } = await load({ SSHK_APP_DEVTOOLS_KEY: '  k1  ' })
    expect(getEnvStr('SSHK_APP_DEVTOOLS_KEY', 'sshk-tools@888')).toBe('k1')
    // 未烤入键走本机 env：空白 → fallback；未设置 → fallback('')
    vi.stubEnv('SSHK_DEV_UPDATE_FAKE_VERSION', '   ')
    expect(getEnvStr('SSHK_DEV_UPDATE_FAKE_VERSION', '1.0.0')).toBe('1.0.0')
    expect(getEnvStr('SSHK_DEV_UPDATE_FAKE_VERSION')).toBe('')
  })

  it('getEnvBool：1/true、0/false、其它值与未设置取 default', async () => {
    const { getEnvBool } = await load({})
    vi.stubEnv('SSHK_APP_AUTO_UPDATE', '0')
    expect(getEnvBool('SSHK_APP_AUTO_UPDATE', true)).toBe(false)
    vi.stubEnv('SSHK_APP_AUTO_UPDATE', 'abc')
    expect(getEnvBool('SSHK_APP_AUTO_UPDATE', true)).toBe(true)
    vi.unstubAllEnvs()
    expect(getEnvBool('SSHK_APP_AUTO_UPDATE', true)).toBe(true) // 未设置 → default
    vi.stubEnv('SSHK_DEV_UPDATE_TEST', 'TRUE')
    expect(getEnvBool('SSHK_DEV_UPDATE_TEST', false)).toBe(true)
  })

  it('getEnvHas：非空白值视为已设置', async () => {
    const { getEnvHas } = await load({})
    expect(getEnvHas('SSHK_APP_DEVTOOLS_KEY')).toBe(false)
    vi.stubEnv('SSHK_APP_DEVTOOLS_KEY', '  ')
    expect(getEnvHas('SSHK_APP_DEVTOOLS_KEY')).toBe(false)
    vi.stubEnv('SSHK_APP_DEVTOOLS_KEY', 'k')
    expect(getEnvHas('SSHK_APP_DEVTOOLS_KEY')).toBe(true)
  })
})
