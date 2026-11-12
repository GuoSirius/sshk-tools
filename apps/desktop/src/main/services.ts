import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app, safeStorage } from 'electron'
import {
  ConfigService,
  DEFAULT_SETTINGS,
  Repository,
  defaultConfigPath,
  ensureOutputDirs,
  resolveOutputRoot,
} from '@sshk/repository'

export interface AppServices {
  config: ConfigService
  repository: Repository
  outputRoot: string
  dbDir: string
  /** 按 providerId 读取 apiKey（safeStorage 解密；永不下发渲染层） */
  getApiKey: (providerId: string) => string
  setApiKey: (providerId: string, apiKey: string) => void
  /** 全量密钥 JSON（zip 导出加密迁移用；默认导出路径拿不到它） */
  exportSecretsJson: () => string
}

const PROVIDER_ID_RE = /^prv_[0-9a-z]+$/

/**
 * 应用级服务装配（M3 → 主进程）：
 * settings.json / NeDB / 产物目录 / secrets.bin（safeStorage）。
 * 密钥只落 safeStorage 加密文件，不进 settings、不进 zip 明文（D18）。
 */
export function setupServices(): AppServices {
  const userData = app.getPath('userData')
  const config = new ConfigService(defaultConfigPath(userData), DEFAULT_SETTINGS)
  const dbDir = join(userData, 'db')
  const repository = new Repository(dbDir)
  const outputRoot = resolveOutputRoot(config.get('app.outputDir') as string | null, join(userData, 'sshk-data'))
  ensureOutputDirs(outputRoot)

  const secretsPath = join(userData, 'secrets.bin')

  function loadSecrets(): Record<string, string> {
    if (!existsSync(secretsPath)) return {}
    try {
      const raw = readFileSync(secretsPath)
      if (!safeStorage.isEncryptionAvailable()) return {}
      return JSON.parse(safeStorage.decryptString(raw)) as Record<string, string>
    } catch {
      return {}
    }
  }

  function saveSecrets(secrets: Record<string, string>): void {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('当前系统不支持凭据加密（safeStorage 不可用），无法保存密钥')
    }
    writeFileSync(secretsPath, safeStorage.encryptString(JSON.stringify(secrets)))
  }

  return {
    config,
    repository,
    outputRoot,
    dbDir,
    getApiKey: (providerId) => loadSecrets()[providerId] ?? '',
    setApiKey: (providerId, apiKey) => {
      if (!PROVIDER_ID_RE.test(providerId)) throw new Error(`非法 providerId: ${providerId}`)
      const secrets = loadSecrets()
      if (apiKey === '') delete secrets[providerId]
      else secrets[providerId] = apiKey
      saveSecrets(secrets)
    },
    exportSecretsJson: () => JSON.stringify({ providers: Object.entries(loadSecrets()).map(([id, apiKey]) => ({ _id: id, apiKey })) }),
  }
}
