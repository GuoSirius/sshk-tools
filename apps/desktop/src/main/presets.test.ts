import { describe, expect, it } from 'vitest'
import { buildPreset, mergePreset, stripSensitiveDeep, type PresetConfigStore, type PresetSecretStore } from './modules/llm/presets'

function store(initial: Record<string, unknown> = {}): PresetConfigStore & { data: Record<string, unknown> } {
  const data: Record<string, unknown> = { ...initial }
  return { data, get: (k) => data[k], set: (k, v) => { data[k] = v } }
}
function secretStore(): PresetSecretStore & { written: Record<string, string> } {
  const source: Record<string, string> = { p1: 'sk-provider', r1: 'ftp-pass', c1: 'oss-secret' }
  const written: Record<string, string> = {}
  return {
    written,
    getProviderKey: (id) => source[id] ?? '',
    getUploadKey: (id) => source[id] ?? '',
    setProviderKey: async (id, key) => { written[id] = key },
    setUploadKey: async (id, key) => { written[id] = key },
  }
}
const presetCfg = {
  'app.llm.providers': [{ _id: 'p1', name: 'A', baseURL: 'https://api.example.com/v1', model: 'm' }],
  'app.llm.activeProviderId': 'p1',
  'app.upload': {
    local: { defaultDir: 'D:/only-mine' },
    remote: { profiles: [{ id: 'r1', name: 'FTP', protocol: 'ftp', host: 'h', username: 'u' }], defaultId: 'r1' },
    cloud: { profiles: [{ id: 'c1', name: 'OSS', provider: 'aliyun-oss', region: 'r', bucket: 'b', accessKeyId: 'AK' }], defaultId: 'c1' },
    validation: { accept: [], maxSize: 0 },
  },
}

describe('stripSensitiveDeep（N3 脱敏）', () => {
  it('剔除各形态敏感键并报告路径', () => {
    const { clean, removed } = stripSensitiveDeep({
      name: 'x',
      apiKey: 'sk-xxx',
      nested: { accessKeySecret: 'a', password: 'p', token: 't', keep: 1 },
      list: [{ 口令: 'q', ok: true }],
    })
    expect(clean).toEqual({ name: 'x', nested: { keep: 1 }, list: [{ ok: true }] })
    expect(removed).toEqual(['apiKey', 'nested.accessKeySecret', 'nested.password', 'nested.token', 'list[0].口令'])
  })
})

describe('buildPreset（N3 导出）', () => {
  it('包含 Provider 与上传 profile，不含密钥与本机默认目录', () => {
    const cfg = store({
      'app.llm.providers': [
        { _id: 'p1', name: 'Agnes', kind: 'remote', baseURL: 'https://api.example.com/v1', model: 'gpt', enabled: true },
        { _id: 'bad', name: '缺字段', baseURL: 'not-a-url' },
      ],
      'app.llm.activeProviderId': 'p1',
      'app.upload': {
        local: { defaultDir: 'D:/only-mine' },
        remote: { profiles: [{ id: 'r1', name: '内网FTP', protocol: 'ftp', host: '10.0.0.2', username: 'u', password: 'should-strip' }], defaultId: 'r1' },
        cloud: { profiles: [{ id: 'c1', name: 'OSS', provider: 'aliyun-oss', region: 'oss-cn-hangzhou', bucket: 'b', accessKeyId: 'AK', secret: 'should-strip' }], defaultId: 'c1' },
        validation: { accept: ['.png'], maxSize: 1024 },
      },
    })
    const preset = buildPreset(cfg)
    expect(preset.kind).toBe('sshk-preset')
    expect(preset.llm?.providers).toHaveLength(1) // 非法 baseURL 的条目不进预设
    expect(preset.llm?.activeProviderId).toBe('p1')
    expect(preset.upload?.remote.profiles[0]).not.toHaveProperty('password')
    expect(preset.upload?.cloud.profiles[0]).not.toHaveProperty('secret')
    expect(JSON.stringify(preset)).not.toContain('should-strip')
    expect(preset.upload).not.toHaveProperty('local') // 本机默认目录不导出
  })
})

describe('mergePreset（N3 导入）', () => {
  const basePreset = {
    kind: 'sshk-preset',
    version: 1,
    exportedAt: '2026-11-16 16:00:00',
    llm: {
      providers: [
        { _id: 'p1', name: 'Agnes(新)', kind: 'remote', baseURL: 'https://api.example.com/v1', model: 'gpt-5', enabled: true },
        { _id: 'p2', name: '新增', kind: 'remote', baseURL: 'https://b.example.com/v1', model: 'm', enabled: false },
      ],
      activeProviderId: 'p2',
    },
    upload: {
      local: { defaultDir: 'D:/theirs' },
      remote: { profiles: [{ id: 'r1', name: '对端FTP', protocol: 'sftp', host: '192.168.1.9', username: 'u2' }], defaultId: 'r1' },
      cloud: { profiles: [], defaultId: '' },
      validation: { accept: ['.png', '.jpg'], maxSize: 2048 },
    },
  }

  it('Provider 按 _id 覆盖/追加；activeProviderId 合并后存在才生效；本机 local 目录不被覆盖', async () => {
    const cfg = store({
      'app.llm.providers': [{ _id: 'p1', name: 'Agnes', kind: 'remote', baseURL: 'https://api.example.com/v1', model: 'gpt', enabled: true }],
      'app.llm.activeProviderId': 'p1',
      'app.upload': {
        local: { defaultDir: 'D:/mine' },
        remote: { profiles: [], defaultId: '' },
        cloud: { profiles: [], defaultId: '' },
        validation: { accept: [], maxSize: 0 },
      },
    })
    const result = await mergePreset(cfg, basePreset)
    expect(result.providersMerged).toBe(2)
    expect(result.uploadProfilesMerged).toBe(1)
    const providers = cfg.data['app.llm.providers'] as { _id: string; model: string }[]
    expect(providers).toHaveLength(2)
    expect(providers.find((p) => p._id === 'p1')?.model).toBe('gpt-5')
    expect(cfg.data['app.llm.activeProviderId']).toBe('p2')
    const upload = cfg.data['app.upload'] as { local: { defaultDir: string }; validation: { maxSize: number }; remote: { profiles: unknown[] } }
    expect(upload.local.defaultDir).toBe('D:/mine')
    expect(upload.validation.maxSize).toBe(2048)
    expect(upload.remote.profiles).toHaveLength(1)
  })

  it('activeProviderId 指向不存在 Provider 时不更新当前激活', async () => {
    const cfg = store({
      'app.llm.providers': [],
      'app.llm.activeProviderId': null,
    })
    await mergePreset(cfg, { ...basePreset, llm: { providers: [], activeProviderId: 'ghost' } })
    expect(cfg.data['app.llm.activeProviderId']).toBeNull()
  })

  it('kind/version 不匹配或非法 JSON 结构直接报错', async () => {
    const cfg = store({})
    await expect(mergePreset(cfg, { kind: 'other', version: 1 })).rejects.toThrow(/预设文件/)
    await expect(mergePreset(cfg, null)).rejects.toThrow(/预设文件/)
    await expect(mergePreset(cfg, [1, 2])).rejects.toThrow(/预设文件/)
  })

  it('预设里的敏感键在导入侧再剔一次（双保险）', async () => {
    const cfg = store({})
    const result = await mergePreset(cfg, {
      kind: 'sshk-preset',
      version: 1,
      llm: { providers: [{ _id: 'p9', name: '带密钥', baseURL: 'https://x.com/v1', model: 'm', apiKey: 'sk-leak' }] },
    })
    expect(result.providersMerged).toBe(1)
    const providers = cfg.data['app.llm.providers'] as Record<string, unknown>[]
    expect(providers[0]).not.toHaveProperty('apiKey')
    expect(JSON.stringify(cfg.data)).not.toContain('sk-leak')
  })
})

describe('含密钥导出/导入（用户 2026-11-17 开关）', () => {
  it('默认导出不带 credentials；includeSecrets 才附明文密钥', () => {
    const cfg = store(presetCfg)
    const sec = secretStore()
    const plain = buildPreset(cfg, sec, false)
    expect(plain.credentials).toBeUndefined()
    const withSecrets = buildPreset(cfg, sec, true)
    expect(withSecrets.credentials?.providers).toEqual([{ id: 'p1', key: 'sk-provider' }])
    expect(withSecrets.credentials?.uploads).toEqual([
      { id: 'r1', key: 'ftp-pass' },
      { id: 'c1', key: 'oss-secret' },
    ])
    // credentials 字段名刻意避开脱敏正则，stripSensitiveDeep 不会误剔
    expect(stripSensitiveDeep(withSecrets).removed).toEqual([])
  })

  it('含密钥导入写回 safeStorage，且不把 credentials 段污染进配置', async () => {
    const cfg = store({})
    const sec = secretStore()
    const preset = buildPreset(store(presetCfg), sec, true)
    await mergePreset(cfg, preset, sec)
    expect(sec.written).toEqual({ p1: 'sk-provider', r1: 'ftp-pass', c1: 'oss-secret' })
    expect(cfg.data).not.toHaveProperty('credentials')
  })

  it('未传 secretStore 时 credentials 段被忽略，不写任何密钥（兼容旧调用）', async () => {
    const cfg = store({})
    const preset = buildPreset(store(presetCfg), secretStore(), true)
    await expect(mergePreset(cfg, preset)).resolves.toBeDefined()
    expect(cfg.data).not.toHaveProperty('credentials')
  })
})
