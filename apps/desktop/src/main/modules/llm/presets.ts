import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { AppError, normalizeUploadConfig, now, type UploadGlobalConfig } from '@sshk/shared'
import { logger } from '../../logger'

/**
 * N3 配置预设分享（plans/05 §八）：
 * 导出 = 模型 Provider 集（不含密钥）+ 上传 profile 集（不含密钥）→ JSON 预设文件；
 * 导入 = 按 id 合并（同 id 覆盖、新 id 追加），密钥不随预设走（对端在各自主进程配置）。
 * 脱敏红线：导出与导入双侧都过 stripSensitiveDeep，命中敏感键的值一律剔除；
 * 本地默认目录/密钥等本机绑定信息不进预设。
 */

const PRESET_KIND = 'sshk-preset'
const PRESET_VERSION = 1
const SENSITIVE_KEY_RE = /(api[-_]?key|apikey|secret|password|passwd|token|口令|密码|密钥)/i

/** 预设文件结构（version 升级时只增不破：旧版本导入按可识别字段宽容处理） */
export interface ConfigPreset {
  kind: typeof PRESET_KIND
  version: number
  exportedAt: string
  llm?: { providers: unknown[]; activeProviderId: string | null }
  upload?: { remote: UploadGlobalConfig['remote']; cloud: UploadGlobalConfig['cloud']; validation: UploadGlobalConfig['validation'] }
  /** 仅「含密钥导出」时存在：明文密钥段，导入时写回 safeStorage（默认导出绝不带此段） */
  credentials?: PresetCredentials
}

/** 导入结果计数 */
export interface PresetImportResult {
  providersMerged: number
  uploadProfilesMerged: number
}

/** 最小配置存取投影（ConfigService 的子集），便于单测注入 */
export interface PresetConfigStore {
  get(key: string): unknown
  set(key: string, value: unknown): void
}

/**
 * 密钥存取投影（用户 2026-11-17：导出开关控制是否携带密钥）。
 * 密钥在 safeStorage 而非 config，导出/导入需经此投影读写；字段名刻意避开敏感正则关键词，
 * 使 credentials 段能安全通过 stripSensitiveDeep（若用 apiKey/secret 会在导入侧被误剔）。
 */
export interface PresetSecretStore {
  getProviderKey(providerId: string): string
  getUploadKey(profileId: string): string
  setProviderKey(providerId: string, key: string): Promise<void>
  setUploadKey(profileId: string, key: string): Promise<void>
}

/** 预设里的密钥段（字段名避开 apiKey/secret/token 等敏感正则，避免被脱敏误剔） */
export interface PresetCredentials {
  providers?: { id: string; key: string }[]
  uploads?: { id: string; key: string }[]
}

/** 深拷贝并剔除敏感键；返回剔除的键路径列表（空数组 = 无敏感键，正常） */
export function stripSensitiveDeep(value: unknown, path = ''): { clean: unknown; removed: string[] } {
  const removed: string[] = []
  const walk = (v: unknown, p: string): unknown => {
    if (Array.isArray(v)) return v.map((item, i) => walk(item, `${p}[${i}]`))
    if (v && typeof v === 'object') {
      const out: Record<string, unknown> = {}
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
        const childPath = p ? `${p}.${k}` : k
        if (SENSITIVE_KEY_RE.test(k)) {
          removed.push(childPath)
          continue
        }
        out[k] = walk(val, childPath)
      }
      return out
    }
    return v
  }
  return { clean: walk(value, path), removed }
}

/** Provider 结构校验：_id + http(s) baseURL + model（与 services.readProviders 同口径） */
function validProvider(p: unknown): boolean {
  if (!p || typeof p !== 'object' || Array.isArray(p)) return false
  const r = p as Record<string, unknown>
  return typeof r['_id'] === 'string' && r['_id'] !== ''
    && typeof r['baseURL'] === 'string' && /^https?:\/\//i.test(r['baseURL'])
    && typeof r['model'] === 'string'
}

/**
 * 组装预设（本机 local.defaultDir 不导出；结构非法的 Provider 条目不进预设）。
 * - includeSecrets=false（默认）：密钥字段强剔除，预设绝不含明文（原有脱敏红线不变）；
 * - includeSecrets=true 且提供 secretStore：额外附 credentials 段（明文密钥），供可信设备间完整迁移。
 */
export function buildPreset(cfg: PresetConfigStore, secretStore?: PresetSecretStore, includeSecrets = false): ConfigPreset {
  const rawProviders = Array.isArray(cfg.get('app.llm.providers')) ? (cfg.get('app.llm.providers') as unknown[]) : []
  const validProviders = rawProviders.filter(validProvider)
  const { clean, removed } = stripSensitiveDeep({
    llm: {
      providers: validProviders,
      activeProviderId: cfg.get('app.llm.activeProviderId') ?? null,
    },
    upload: normalizeUploadConfig(cfg.get('app.upload')),
  })
  if (removed.length > 0) {
    logger.warn('preset', `导出预设时剔除敏感字段：${removed.join('、')}`)
  }
  const cleanObj = (clean ?? {}) as Record<string, unknown>
  const upload = cleanObj['upload'] as UploadGlobalConfig | undefined
  const preset: ConfigPreset = {
    kind: PRESET_KIND,
    version: PRESET_VERSION,
    exportedAt: now(),
  }
  if (cleanObj['llm']) preset.llm = cleanObj['llm'] as ConfigPreset['llm']
  if (upload) {
    preset.upload = { remote: upload.remote, cloud: upload.cloud, validation: upload.validation }
  }
  // 含密钥导出：从 safeStorage 投影读取，按 providerId / profileId 组装 credentials 段
  if (includeSecrets && secretStore) {
    const providers = validProviders
      .map((p) => ({ id: (p as { _id: string })._id, key: secretStore.getProviderKey((p as { _id: string })._id) }))
      .filter((x) => Boolean(x.key))
    const keysOfUpload = [...(upload?.remote.profiles ?? []), ...(upload?.cloud.profiles ?? [])]
      .map((p) => ({ id: p.id, key: secretStore.getUploadKey(p.id) }))
      .filter((x) => Boolean(x.key))
    preset.credentials = {
      ...(providers.length ? { providers } : {}),
      ...(keysOfUpload.length ? { uploads: keysOfUpload } : {}),
    }
    logger.warn('preset', `含密钥导出：Provider ${providers.length} / 上传 Profile ${keysOfUpload.length} 条明文密钥写入预设，请妥善保管该文件`)
  }
  return preset
}

/** 合并预设到当前配置（按 id 覆盖/追加；返回计数）。非法结构直接抛错（H1：调用方 handleOk 包装）
 *  secretStore 可选：提供时，预设里的 credentials 段（含密钥导出才有）会写回 safeStorage。 */
export async function mergePreset(cfg: PresetConfigStore, raw: unknown, secretStore?: PresetSecretStore): Promise<PresetImportResult> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new AppError('预设文件格式不正确', 'io')
  const preset = raw as Record<string, unknown>
  if (preset['kind'] !== PRESET_KIND || typeof preset['version'] !== 'number') {
    throw new AppError('不是 sshk-tools 配置预设文件（kind/version 不匹配）', 'io')
  }
  // credentials 段先摘出（字段名避开敏感正则，stripSensitiveDeep 不会剔它），避免被写进配置
  const rawCred = preset['credentials'] as PresetCredentials | undefined
  const { clean, removed } = stripSensitiveDeep(preset)
  if (removed.length > 0) {
    logger.warn('preset', `导入预设时剔除敏感字段：${removed.join('、')}`)
  }
  const data = clean as Record<string, unknown>
  delete data['credentials']
  let providersMerged = 0
  let uploadProfilesMerged = 0

  // ── llm providers：按 _id 覆盖/追加；activeProviderId 仅在合并后存在时更新 ──
  const llm = data['llm'] as { providers?: unknown[]; activeProviderId?: unknown } | undefined
  if (llm && Array.isArray(llm.providers)) {
    const incoming = llm.providers.filter(validProvider)
    const currentRaw = cfg.get('app.llm.providers')
    const current = Array.isArray(currentRaw) ? [...(currentRaw as Record<string, unknown>[])] : []
    for (const provider of incoming) {
      const p = provider as Record<string, unknown>
      const idx = current.findIndex((c) => c['_id'] === p['_id'])
      if (idx >= 0) current[idx] = p
      else current.push(p)
      providersMerged++
    }
    cfg.set('app.llm.providers', current)
    const wantActive = typeof llm.activeProviderId === 'string' ? llm.activeProviderId : null
    if (wantActive && current.some((c) => c['_id'] === wantActive)) {
      cfg.set('app.llm.activeProviderId', wantActive)
    }
  }

  // ── 上传 profile：按 id 覆盖/追加；validation 采纳预设；local.defaultDir 本机绑定不导入 ──
  const uploadRaw = data['upload']
  if (uploadRaw && typeof uploadRaw === 'object' && !Array.isArray(uploadRaw)) {
    const presetUpload = normalizeUploadConfig(uploadRaw)
    const current = normalizeUploadConfig(cfg.get('app.upload'))
    const nextRemote = [...current.remote.profiles]
    const nextCloud = [...current.cloud.profiles]
    for (const p of presetUpload.remote.profiles) {
      const idx = nextRemote.findIndex((c) => c.id === p.id)
      if (idx >= 0) nextRemote[idx] = p
      else nextRemote.push(p)
      uploadProfilesMerged++
    }
    for (const p of presetUpload.cloud.profiles) {
      const idx = nextCloud.findIndex((c) => c.id === p.id)
      if (idx >= 0) nextCloud[idx] = p
      else nextCloud.push(p)
      uploadProfilesMerged++
    }
    current.remote.profiles = nextRemote
    current.cloud.profiles = nextCloud
    // defaultId 仅在合并后仍存在时采纳
    if (presetUpload.remote.defaultId && nextRemote.some((p) => p.id === presetUpload.remote.defaultId)) {
      current.remote.defaultId = presetUpload.remote.defaultId
    }
    if (presetUpload.cloud.defaultId && nextCloud.some((p) => p.id === presetUpload.cloud.defaultId)) {
      current.cloud.defaultId = presetUpload.cloud.defaultId
    }
    current.validation = presetUpload.validation
    cfg.set('app.upload', current)
  }

  // 含密钥预设：把 credentials 段写回 safeStorage（仅写入本预设确实合并进来的 id，避免陈旧密钥覆盖）
  if (rawCred && secretStore) {
    let keysRestored = 0
    const appliedProviderIds = new Set((data['llm'] as { providers?: { _id: string }[] } | undefined)?.providers?.map((p) => p._id) ?? [])
    for (const c of rawCred.providers ?? []) {
      if (!c || typeof c.id !== 'string' || typeof c.key !== 'string' || !c.key) continue
      if (!appliedProviderIds.has(c.id)) continue
      await secretStore.setProviderKey(c.id, c.key)
      keysRestored++
    }
    const appliedUploadIds = new Set([
      ...(presetUploadSafeIds(preset)),
    ])
    for (const c of rawCred.uploads ?? []) {
      if (!c || typeof c.id !== 'string' || typeof c.key !== 'string' || !c.key) continue
      if (!appliedUploadIds.has(c.id)) continue
      await secretStore.setUploadKey(c.id, c.key)
      keysRestored++
    }
    if (keysRestored > 0) logger.warn('preset', `含密钥预设导入：已写回 ${keysRestored} 条明文密钥到 safeStorage`)
  }

  logger.info('preset', `预设导入完成：Provider ${providersMerged} / 上传 Profile ${uploadProfilesMerged}`)
  return { providersMerged, uploadProfilesMerged }
}

/** 从原始预设中取合法上传 profile id（用于校验 credentials 写回范围，防止陈旧密钥覆盖） */
function presetUploadSafeIds(preset: Record<string, unknown>): string[] {
  const upload = preset['upload'] as { remote?: { profiles?: { id: string }[] }; cloud?: { profiles?: { id: string }[] } } | undefined
  return [...(upload?.remote?.profiles ?? []), ...(upload?.cloud?.profiles ?? [])].map((p) => p.id).filter(Boolean)
}

/** 导出预设到 .json（路径必须来自用户保存对话框） */
export function exportPreset(
  cfg: PresetConfigStore,
  outPath: string,
  secretStore?: PresetSecretStore,
  includeSecrets = false,
): { file: string; providers: number; uploadProfiles: number; secrets: number } {
  const target = String(outPath ?? '')
  if (!/\.json$/i.test(target)) throw new AppError('保存路径必须是 .json', 'io')
  const preset = buildPreset(cfg, secretStore, includeSecrets)
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, JSON.stringify(preset, null, 2), 'utf8')
  const providers = preset.llm?.providers.length ?? 0
  const uploadProfiles = (preset.upload?.remote.profiles.length ?? 0) + (preset.upload?.cloud.profiles.length ?? 0)
  const secrets = (preset.credentials?.providers?.length ?? 0) + (preset.credentials?.uploads?.length ?? 0)
  logger.info('preset', `预设已导出：${target}（Provider ${providers} / 上传 Profile ${uploadProfiles}${secrets ? ` / 密钥 ${secrets}` : ''}）`)
  return { file: target, providers, uploadProfiles, secrets }
}

/** 从 .json 导入预设（路径必须来自用户文件选择对话框，与 backup.import 同范式） */
export async function importPreset(cfg: PresetConfigStore, filePath: string, secretStore?: PresetSecretStore): Promise<PresetImportResult> {
  const source = String(filePath ?? '')
  if (!/\.json$/i.test(source)) throw new AppError('请选择 .json 预设文件', 'io')
  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(source, 'utf8'))
  } catch {
    throw new AppError('预设文件不是合法 JSON', 'io')
  }
  return mergePreset(cfg, raw, secretStore)
}
