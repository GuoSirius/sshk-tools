import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { app, safeStorage } from 'electron'
import {
  ConfigService,
  DEFAULT_SETTINGS,
  Repository,
  defaultConfigPath,
  ensureOutputDirs,
  resolveOutputRoot,
} from '@sshk/repository'
import {
  chat as llmChat,
  listModels as llmListModels,
  type LlmProvider,
} from '@sshk/llm-gateway'
import {
  ACCESS_GRANT,
  ACCESS_KEY_SECRET_ID,
  mergeToolDefaults,
  type LlmProviderInfo,
  type ToolHostCapabilities,
} from '@sshk/shared'
import { MANIFESTS } from './discovery'
import { isProviderId, toolSecretId } from './secret-ids'

export interface AppServices {
  config: ConfigService
  repository: Repository
  outputRoot: string
  dbDir: string
  /** 按 providerId 读取 apiKey（safeStorage 解密；永不下发渲染层） */
  getApiKey: (providerId: string) => string
  /** 确保密钥缓存已从 safeStorage 解密预载（幂等） */
  ensureSecrets: () => Promise<void>
  setApiKey: (providerId: string, apiKey: string) => void
  /** 应用访问密钥：写入 safeStorage，settings 只留 sha256 摘要 */
  setAccessKey: (key: string) => void
  /** 权限裁决输入：是否有效 + 已持有的 grants（不含明文） */
  getAccessKeyState: () => { hasAccessKey: boolean; grants: string[] }
  /** 全量密钥 JSON（zip 导出加密迁移用；默认导出路径拿不到它） */
  exportSecretsJson: () => string
  /** 导入备份后把解密出的 Provider 密钥合并回 safeStorage */
  importSecretsJson: (json: string) => void
  /** 暴露给工具插件的宿主能力；应用不依赖工具，工具可依赖这些能力 */
  host: ToolHostCapabilities
}

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

/**
 * 应用级服务装配：
 * settings.json / NeDB / 产物目录 / secrets.bin（safeStorage）。
 * 工具默认配置来自各工具包 manifest.defaults，宿主不硬编码任何工具的默认值。
 */
export function setupServices(): AppServices {
  const userData = app.getPath('userData')
  const config = new ConfigService(
    defaultConfigPath(userData),
    mergeToolDefaults(DEFAULT_SETTINGS, MANIFESTS),
  )
  const dbDir = join(userData, 'db')
  const repository = new Repository(dbDir)
  const outputRoot = resolveOutputRoot(config.get('app.outputDir') as string | null, join(userData, 'sshk-data'))
  ensureOutputDirs(outputRoot)

  const secretsPath = join(userData, 'secrets.bin')

  let secretsCache: Record<string, string> | null = null
  /** 启动时解密预载进内存缓存；之后同步读走缓存，写盘后即时更新（safeStorage 异步 API 迁移配套） */
  async function loadSecrets(): Promise<Record<string, string>> {
    if (secretsCache) return secretsCache
    if (!existsSync(secretsPath)) { secretsCache = {}; return secretsCache }
    try {
      const raw = readFileSync(secretsPath)
      if (!(await safeStorage.isEncryptionAvailable())) {
        // 静默丢密钥会表现为「重启后配置失效」，必须把原因留在日志里
        console.warn('[sshk] safeStorage 不可用，本次无法解密 secrets.bin（密钥仍在磁盘）')
        secretsCache = {}
        return secretsCache
      }
      secretsCache = JSON.parse(String(await safeStorage.decryptStringAsync(raw))) as Record<string, string>
      return secretsCache
    } catch (err) {
      console.warn('[sshk] secrets.bin 解密失败（密钥仍在磁盘，重填后即恢复）：', (err as Error).message)
      secretsCache = {}
      return secretsCache
    }
  }

  /** 同步读缓存（启动预载后恒可用）；写路径必须走 saveSecrets */
  function currentSecrets(): Record<string, string> { return secretsCache ?? {} }

  async function saveSecrets(secrets: Record<string, string>): Promise<void> {
    if (!(await safeStorage.isEncryptionAvailable())) {
      throw new Error('当前系统不支持凭据加密（safeStorage 不可用），无法保存密钥')
    }
    writeFileSync(secretsPath, safeStorage.encryptString(JSON.stringify(secrets)))
    secretsCache = secrets
  }

  /**
   * 应用级 Provider 是宿主能力，不属于任何工具：
   * 所有工具通过 host.listProviders()/chatByProvider() 复用同一份配置与密钥，
   * 不需要也不允许各自再配一遍 baseURL / apiKey。
   */
  function readProviders(): LlmProvider[] {
    const raw = config.get('app.llm.providers')
    if (!Array.isArray(raw)) return []
    return raw.filter((item): item is LlmProvider => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return false
      const p = item as Record<string, unknown>
      return typeof p['_id'] === 'string'
        && typeof p['baseURL'] === 'string'
        && /^https?:\/\//i.test(p['baseURL'])
        && typeof p['model'] === 'string'
    })
  }

  function findProvider(providerId: string): LlmProvider {
    if (!isProviderId(providerId)) throw new Error(`非法 Provider ID：${providerId}`)
    const provider = readProviders().find((p) => p._id === providerId)
    if (!provider) {
      throw new Error(`未找到 Provider「${providerId}」，请先在「模型控制台」新增或启用`)
    }
    return provider
  }

  /** 本机 OCR：无 shell、固定超时、限制输出，避免外部命令失控 */
  function runLocalOcr(req: {
    command: string
    args: string[]
    imagePath: string
    timeoutMs?: number
  }): Promise<string> {
    return new Promise((resolve, reject) => {
      const command = req.command.trim()
      if (!command) { reject(new Error('未配置本机 OCR 命令')); return }
      const args = req.args.map((arg) => arg.replaceAll('{image}', req.imagePath))
      let child: ReturnType<typeof spawn>
      try {
        child = spawn(command, args, {
          shell: false,
          windowsHide: true,
          // Windows 控制台默认 GBK，强制 Python 走 UTF-8，否则中文文件名 / 报错全是乱码
          env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
        })
      } catch (err) {
        reject(new Error(`本机 OCR 启动失败：${(err as Error).message}`))
        return
      }
      let stdout = ''
      let stderr = ''
      let settled = false
      const limit = Math.min(Math.max(req.timeoutMs ?? 60_000, 1_000), 180_000)
      const timer = setTimeout(() => {
        if (settled) return
        settled = true
        child.kill()
        reject(new Error(`本机 OCR 超时（${Math.round(limit / 1000)}s）`))
      }, limit)
      child.stdout?.setEncoding('utf8')
      child.stderr?.setEncoding('utf8')
      child.stdout?.on('data', (chunk: string) => {
        if (stdout.length < 2_000_000) stdout += chunk
      })
      child.stderr?.on('data', (chunk: string) => {
        if (stderr.length < 20_000) stderr += chunk
      })
      child.on('error', (err) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        reject(new Error(`本机 OCR 启动失败：${err.message}`))
      })
      child.on('close', (code) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        if (code !== 0) reject(new Error(`本机 OCR 退出码 ${code}：${stderr.slice(0, 500)}`))
        else resolve(stdout.trim())
      })
    })
  }

  const host: ToolHostCapabilities = {
    getToolSecret: (toolId, name) => currentSecrets()[toolSecretId(toolId, name)] ?? '',
    setToolSecret: (toolId, name, value) => {
      const id = toolSecretId(toolId, name)
      const secrets = currentSecrets()
      if (!value) delete secrets[id]
      else secrets[id] = value
      saveSecrets(secrets)
    },
    chat: async (req) => {
      const provider: LlmProvider = {
        _id: 'host-tool-vision',
        name: 'Tool Vision',
        kind: 'remote',
        baseURL: req.baseURL,
        model: req.model,
        enabled: true,
      }
      const result = await llmChat({
        provider,
        apiKey: req.apiKey,
        messages: req.messages,
        temperature: req.temperature,
        maxTokens: req.maxTokens,
      })
      return result.content
    },
    listProviders: (): LlmProviderInfo[] => readProviders().map((p) => ({
      _id: p._id,
      name: p.name,
      kind: p.kind,
      baseURL: p.baseURL,
      model: p.model,
      enabled: p.enabled,
      // 只回布尔标记，绝不回明文；工具据此提示用户「需要去模型控制台填 Key」
      hasApiKey: Boolean(currentSecrets()[p._id]),
    })),
    chatByProvider: async (req) => {
      const provider = findProvider(req.providerId)
      const result = await llmChat({
        provider: req.model ? { ...provider, model: req.model } : provider,
        apiKey: currentSecrets()[provider._id] ?? '',
        messages: req.messages,
        temperature: req.temperature,
        maxTokens: req.maxTokens,
      })
      return result.content
    },
    listModelsByProvider: (providerId, apiKey) => llmListModels(
      findProvider(providerId),
      typeof apiKey === 'string' && apiKey ? apiKey : (currentSecrets()[providerId] ?? ''),
    ),
    runLocalOcr,
  }

  void loadSecrets()

  return {
    config,
    repository,
    outputRoot,
    dbDir,
    host,
    getApiKey: (providerId) => currentSecrets()[providerId] ?? '',
    ensureSecrets: async () => { await loadSecrets() },
    setApiKey: (providerId, apiKey) => {
      if (!isProviderId(providerId)) throw new Error(`非法 providerId: ${providerId}`)
      const secrets = currentSecrets()
      if (apiKey === '') delete secrets[providerId]
      else secrets[providerId] = apiKey
      saveSecrets(secrets)
    },
    setAccessKey: (key) => {
      const secrets = currentSecrets()
      if (!key) delete secrets[ACCESS_KEY_SECRET_ID]
      else secrets[ACCESS_KEY_SECRET_ID] = key
      // 先写凭据再广播配置变更，保证广播触发的目录刷新拿到一致状态
      saveSecrets(secrets)
      config.set('app.accessKeyHash', key ? sha256(key) : null)
    },
    getAccessKeyState: () => {
      const key = currentSecrets()[ACCESS_KEY_SECRET_ID] ?? ''
      const hash = config.get('app.accessKeyHash') as string | null
      const valid = Boolean(key && hash && sha256(key) === hash)
      return { hasAccessKey: valid, grants: valid ? [ACCESS_GRANT] : [] }
    },
    importSecretsJson: (json) => {
      const parsed = JSON.parse(json) as { providers?: { _id?: string; apiKey?: string }[] }
      const secrets = currentSecrets()
      for (const item of parsed.providers ?? []) {
        if (!item || typeof item._id !== 'string' || !isProviderId(item._id)) continue
        if (typeof item.apiKey === 'string' && item.apiKey) secrets[item._id] = item.apiKey
      }
      saveSecrets(secrets)
    },
    // app:* 前缀的工具密钥与访问密钥都不参与 provider 迁移
    exportSecretsJson: () => JSON.stringify({
      providers: Object.entries(loadSecrets())
        .filter(([id]) => !id.startsWith('app:'))
        .map(([id, apiKey]) => ({ _id: id, apiKey })),
    }),
  }
}
