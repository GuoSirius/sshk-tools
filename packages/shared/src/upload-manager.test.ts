import { describe, expect, it } from 'vitest'
import {
  DEFAULT_UPLOAD_CONFIG,
  listUploadProfiles,
  newProfileId,
  normalizeUploadConfig,
  pickCloudProfile,
  pickRemoteProfile,
  resolveUploadTool,
} from './upload-manager'

const cfg = normalizeUploadConfig({
  local: { defaultDir: 'D:/edm-out' },
  remote: {
    defaultId: 'r1',
    profiles: [
      { id: 'r1', name: '生产 FTP', protocol: 'ftp', host: '10.0.0.1', port: 21, username: 'u' },
      { id: 'r2', name: '备份 SFTP', protocol: 'sftp', host: '10.0.0.2', username: 'u2' },
    ],
  },
  cloud: {
    defaultId: 'c1',
    profiles: [
      { id: 'c1', name: 'OSS 主账号', provider: 'aliyun-oss', bucket: 'edm-prod', region: 'oss-cn-hangzhou', accessKeyId: 'ak' },
      { id: 'c2', name: 'COS 营销', provider: 'tencent-cos', bucket: 'mkt', region: 'ap-guangzhou', accessKeyId: 'ak2' },
    ],
  },
  validation: { accept: ['.PNG', '.jpg', '.png'], maxSize: 2048 },
})

describe('R26 全局上传配置', () => {
  it('缺省 / 脏数据归一化成完整结构，扩展名去重转小写', () => {
    expect(normalizeUploadConfig(undefined)).toEqual(DEFAULT_UPLOAD_CONFIG)
    expect(cfg.validation.accept).toEqual(['.png', '.jpg'])
    expect(cfg.remote.profiles[1]?.protocol).toBe('sftp')
    expect(normalizeUploadConfig({ remote: { profiles: [{ id: 'bad' }] } }).remote.profiles).toHaveLength(0)
  })

  it('多 profile：同类型列表、按 type 过滤、label 带来源前缀', () => {
    expect(listUploadProfiles(cfg)).toHaveLength(4)
    expect(listUploadProfiles(cfg, 'remote')).toHaveLength(2)
    expect(listUploadProfiles(cfg, 'cloud').every((p) => p.targetType === 'cloud')).toBe(true)
    expect(listUploadProfiles(cfg)[0]?.label).toContain('远程 · 生产 FTP')
  })

  it('选 profile：显式 id > defaultId > 第一个；缺配置返回 null', () => {
    expect(pickRemoteProfile(cfg, 'r2')?.host).toBe('10.0.0.2')
    expect(pickRemoteProfile(cfg)?.id).toBe('r1')
    expect(pickCloudProfile(cfg, 'missing')?.id).toBe('c1')
    expect(pickCloudProfile(DEFAULT_UPLOAD_CONFIG)).toBeNull()
  })

  it('工具配置：未设限字段必须是 undefined，不能把空交集当成收紧', () => {
    const empty = resolveUploadTool({})
    expect(empty.targetType).toBe('local')
    expect(empty.validation.accept).toBeUndefined()
    expect(empty.validation.maxSize).toBeUndefined()
    const strict = resolveUploadTool({
      targetType: 'cloud',
      profileId: 'c1',
      overrides: { prefix: 'mail/' },
      validation: { accept: ['.JPG'], maxSize: 500 },
    })
    expect(strict.validation).toEqual({ accept: ['.jpg'], maxSize: 500 })
    expect(strict.overrides.prefix).toBe('mail/')
  })

  it('profile ID 符合 safeStorage 命名约束', () => {
    const id = newProfileId('remote')
    expect(id).toMatch(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/)
    expect(newProfileId('cloud')).toMatch(/^c/)
  })
})
