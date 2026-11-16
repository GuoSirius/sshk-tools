import { describe, expect, it } from 'vitest'
import { buildPreset, mergePreset, stripSensitiveDeep, type PresetConfigStore } from './presets'

function store(initial: Record<string, unknown> = {}): PresetConfigStore & { data: Record<string, unknown> } {
  const data: Record<string, unknown> = { ...initial }
  return { data, get: (k) => data[k], set: (k, v) => { data[k] = v } }
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

  it('Provider 按 _id 覆盖/追加；activeProviderId 合并后存在才生效；本机 local 目录不被覆盖', () => {
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
    const result = mergePreset(cfg, basePreset)
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

  it('activeProviderId 指向不存在 Provider 时不更新当前激活', () => {
    const cfg = store({
      'app.llm.providers': [],
      'app.llm.activeProviderId': null,
    })
    mergePreset(cfg, { ...basePreset, llm: { providers: [], activeProviderId: 'ghost' } })
    expect(cfg.data['app.llm.activeProviderId']).toBeNull()
  })

  it('kind/version 不匹配或非法 JSON 结构直接报错', () => {
    const cfg = store({})
    expect(() => mergePreset(cfg, { kind: 'other', version: 1 })).toThrow(/预设文件/)
    expect(() => mergePreset(cfg, null)).toThrow(/预设文件/)
    expect(() => mergePreset(cfg, [1, 2])).toThrow(/预设文件/)
  })

  it('预设里的敏感键在导入侧再剔一次（双保险）', () => {
    const cfg = store({})
    const result = mergePreset(cfg, {
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
