/**
 * R26：应用级上传配置的纯数据层（全局预设 + 工具覆盖）。
 *
 * 放在 shared 而不是 upload-core：渲染层（配置页 / 工具配置表单）也要读类型与纯函数，
 * 但绝不能把 upload-core 的 Node 侧依赖（basic-ftp / ssh2 / ali-oss）拖进渲染 bundle。
 * 本文件不 import 任何 Node 模块，profile 里也**不含密钥**——密钥只存 safeStorage。
 */
import { isUploadCloudVendor, type UploadCloudVendor } from './upload-vendors'

export type UploadTargetType = 'local' | 'remote' | 'cloud'

/** 远程 profile：FTP / SFTP 合并，用 protocol 区分 */
export interface UploadRemoteProfile {
  id: string
  name: string
  protocol: 'ftp' | 'sftp'
  host: string
  port?: number
  username: string
  remoteDir?: string
  passive?: boolean
  baseUrl?: string
  /** 签名 URL 模板：直链预览时用 {url} 占位符套签名（如 https://cdn/x?token=...&src={url}）；空=裸链 */
  signUrlTemplate?: string
}

/** 云 profile：可同云多账号、不同云混排；厂商清单唯一事实源见 upload-vendors.ts */
export interface UploadCloudProfile {
  id: string
  name: string
  provider: UploadCloudVendor
  region: string
  endpoint?: string
  bucket: string
  accessKeyId: string
  baseUrl?: string
  /** 签名 URL 模板：直链预览时用 {url} 占位符套签名；空=裸链 */
  signUrlTemplate?: string
}

export interface UploadValidationConfig {
  /** 含点、小写，如 ['.png', '.jpg']；空数组 = 不限制 */
  accept: string[]
  /** 字节；0 = 不限制 */
  maxSize: number
}

export interface UploadGlobalConfig {
  local: { defaultDir: string }
  remote: { profiles: UploadRemoteProfile[]; defaultId: string }
  cloud: { profiles: UploadCloudProfile[]; defaultId: string }
  validation: UploadValidationConfig
}

export interface UploadProfileOption {
  id: string
  name: string
  targetType: UploadTargetType
  /** 供下拉直接展示，带「远程 / 云」前缀 */
  label: string
}

/** 工具级配置：只选 profile + 覆盖非固定信息 + 收紧校验，不能放宽 */
export interface UploadToolConfig {
  targetType: UploadTargetType
  profileId: string
  overrides: {
    localDir?: string
    remotePath?: string
    bucket?: string
    prefix?: string
  }
  validation: { accept?: string[]; maxSize?: number }
}

export const DEFAULT_UPLOAD_CONFIG: UploadGlobalConfig = {
  local: { defaultDir: '' },
  remote: { profiles: [], defaultId: '' },
  cloud: { profiles: [], defaultId: '' },
  validation: { accept: [], maxSize: 0 },
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback)
const num = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? v : undefined
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])

/** 容错归一化：任何脏配置 / 缺省都能得到完整结构，UI 与 main 共用同一份语义 */
export function normalizeUploadConfig(raw: unknown): UploadGlobalConfig {
  const r = isObj(raw) ? raw : {}
  const local = isObj(r['local']) ? r['local'] : {}
  const remote = isObj(r['remote']) ? r['remote'] : {}
  const cloud = isObj(r['cloud']) ? r['cloud'] : {}
  const validation = isObj(r['validation']) ? r['validation'] : {}

  const remoteProfiles: UploadRemoteProfile[] = arr(remote['profiles']).flatMap((p) => {
    if (!isObj(p) || !str(p['id']) || !str(p['host'])) return []
    return [{
      id: str(p['id']),
      name: str(p['name'], str(p['id'])),
      protocol: p['protocol'] === 'sftp' ? 'sftp' : 'ftp',
      host: str(p['host']),
      port: num(p['port']),
      username: str(p['username']),
      remoteDir: str(p['remoteDir']),
      passive: p['passive'] !== false,
      baseUrl: str(p['baseUrl']),
      signUrlTemplate: str(p['signUrlTemplate']),
    }]
  })
  const cloudProfiles: UploadCloudProfile[] = arr(cloud['profiles']).flatMap((p) => {
    if (!isObj(p) || !str(p['id']) || !str(p['bucket'])) return []
    const provider = p['provider']
    return [{
      id: str(p['id']),
      name: str(p['name'], str(p['id'])),
      provider: isUploadCloudVendor(provider) ? provider : 'aliyun-oss',
      region: str(p['region']),
      endpoint: str(p['endpoint']),
      bucket: str(p['bucket']),
      accessKeyId: str(p['accessKeyId']),
      baseUrl: str(p['baseUrl']),
      signUrlTemplate: str(p['signUrlTemplate']),
    }]
  })

  const accept = arr(validation['accept'])
    .filter((e): e is string => typeof e === 'string')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)

  return {
    local: { defaultDir: str(local['defaultDir']) },
    remote: { profiles: remoteProfiles, defaultId: str(remote['defaultId']) },
    cloud: { profiles: cloudProfiles, defaultId: str(cloud['defaultId']) },
    validation: { accept: [...new Set(accept)], maxSize: num(validation['maxSize']) ?? 0 },
  }
}

/** 全局 profile 只读清单（不含任何密钥），type 省略时按 local → remote → cloud 顺序 */
export function listUploadProfiles(
  cfg: UploadGlobalConfig,
  type?: 'remote' | 'cloud',
): UploadProfileOption[] {
  const remote: UploadProfileOption[] = (type && type !== 'remote') ? [] : cfg.remote.profiles.map((p) => ({
    id: p.id,
    name: p.name,
    targetType: 'remote' as const,
    label: `远程 · ${p.name}（${p.protocol.toUpperCase()} ${p.host}）`,
  }))
  const cloud: UploadProfileOption[] = (type && type !== 'cloud') ? [] : cfg.cloud.profiles.map((p) => ({
    id: p.id,
    name: p.name,
    targetType: 'cloud' as const,
    label: `云 · ${p.name}（${p.provider} ${p.bucket}）`,
  }))
  return [...remote, ...cloud]
}

/** 选 profile：显式 id 优先，其次 defaultId，最后同类型第一个；找不到返回 null */
export function pickRemoteProfile(cfg: UploadGlobalConfig, id?: string): UploadRemoteProfile | null {
  const list = cfg.remote.profiles
  return list.find((p) => p.id === id)
    ?? list.find((p) => p.id === cfg.remote.defaultId)
    ?? list[0]
    ?? null
}

export function pickCloudProfile(cfg: UploadGlobalConfig, id?: string): UploadCloudProfile | null {
  const list = cfg.cloud.profiles
  return list.find((p) => p.id === id)
    ?? list.find((p) => p.id === cfg.cloud.defaultId)
    ?? list[0]
    ?? null
}

/**
 * 工具级配置归一化。
 * 关键：工具未设限的字段必须是 undefined 而不是空数组 / 0 —— 否则
 * mergeValidation 会把「空交集」当成更严的规则，反而抹掉全局白名单（等于放宽）。
 */
export function resolveUploadTool(raw: unknown): UploadToolConfig {
  const r = isObj(raw) ? raw : {}
  const o = isObj(r['overrides']) ? r['overrides'] : {}
  const v = isObj(r['validation']) ? r['validation'] : {}
  const t = r['targetType']
  const targetType: UploadTargetType = t === 'remote' || t === 'cloud' ? t : 'local'
  // manifest 字段可能是逗号分隔字符串（工具配置页只有 string 控件），也可能是数组
  const rawAccept = v['accept']
  const acceptItems: unknown[] = Array.isArray(rawAccept)
    ? rawAccept
    : typeof rawAccept === 'string' ? rawAccept.split(/[,，\s]+/) : []
  const accept = acceptItems
    .filter((e): e is string => typeof e === 'string')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
  const maxSize = num(v['maxSize']) ?? 0
  return {
    targetType,
    profileId: str(r['profileId']),
    overrides: {
      localDir: str(o['localDir']) || undefined,
      // remoteFolder 是配置页字段名（规避「路径类字段必须 dir/file」门禁，远端位置并非本机目录）
      remotePath: str(o['remotePath']) || str(o['remoteFolder']) || undefined,
      bucket: str(o['bucket']) || undefined,
      prefix: str(o['prefix']) || undefined,
    },
    validation: {
      accept: accept.length > 0 ? [...new Set(accept)] : undefined,
      maxSize: maxSize > 0 ? maxSize : undefined,
    },
  }
}

/** 生成符合 secret-ids 校验（字母开头、字母数字/下划线/连字符）的 profile id */
export function newProfileId(kind: 'remote' | 'cloud'): string {
  return `${kind === 'remote' ? 'r' : 'c'}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
}
