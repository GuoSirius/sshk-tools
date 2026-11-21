import { app } from 'electron'
import { SecretsStore } from './secrets-store'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
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
  type LlmProvider,
} from '@sshk/llm-gateway'
import { AppError, ACCESS_GRANT,
  ACCESS_KEY_SECRET_ID,
  TOOL_IDS,
  mergeToolDefaults,
  type ToolHostCapabilities, } from '@sshk/shared'
import { MANIFESTS } from './discovery'
import { isProviderId, toolSecretId, uploadSecretId } from './secret-ids'
import { recordUsage } from './usage'
import { logger } from './logger'
import { createLlmService } from './llm-service'

export interface AppServices {
  config: ConfigService
  repository: Repository
  outputRoot: string
  dbDir: string
  /** 按 providerId 读取 apiKey（safeStorage 解密；永不下发渲染层） */
  getApiKey: (providerId: string) => string
  /** 上传通道密钥（应用级 app:upload: 命名空间，2026-11-19 由工具账下提升） */
  getUploadSecret: (profileId: string) => string
  setUploadSecret: (profileId: string, value: string) => void
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
 * 应用级服务装配（O6/N5 · 名字保留作装配入口）：
 * settings.json / NeDB / 产物目录 / secrets.bin（safeStorage）。
 * LLM 域（Provider 读取 / chatByProvider / listModels）已拆至 llm-service.ts，
 * 本文件保留装配编排与密钥/备份面。
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

  // P1-2（A2/Q-02）：密钥读写单一收口 SecretsStore——写队列串行 + 写前强制预载 +
  // mutate 作用于快照拷贝（落盘成功才 commit），消灭启动窗口丢密钥与并发覆盖
  const secretsStore = new SecretsStore(secretsPath, (msg) => {
    logger.error('secrets', `密钥保存失败：${msg}`)
  })

  /** 同步读缓存（启动预载后恒可用）；写路径必须走 secretsStore.set */
  function currentSecrets(): Record<string, string> { return secretsStore.snapshot() }

  /** 本机 OCR：无 shell、固定超时、限制输出，避免外部命令失控 */
  function runLocalOcr(req: {
    command: string
    args: string[]
    imagePath: string
    timeoutMs?: number
  }): Promise<string> {
    return new Promise((resolve, reject) => {
      const command = req.command.trim()
      if (!command) { reject(new AppError('未配置本机 OCR 命令')); return }
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
        reject(new AppError(`本机 OCR 启动失败：${(err as Error).message}`))
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
        reject(new AppError(`本机 OCR 超时（${Math.round(limit / 1000)}s）`, 'timeout'))
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
        reject(new AppError(`本机 OCR 启动失败：${err.message}`))
      })
      child.on('close', (code) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        if (code !== 0) reject(new AppError(`本机 OCR 退出码 ${code}：${stderr.slice(0, 500)}`))
        else resolve(stdout.trim())
      })
    })
  }

  // O6/N5（P3-2 第一刀）：LLM 域服务拆至 llm-service.ts，密钥仍由 SecretsStore 单一收口（快照只读注入）
  const llm = createLlmService({ config, repository, currentSecrets })

  const host: ToolHostCapabilities = {
    getToolSecret: (toolId, name) => currentSecrets()[toolSecretId(toolId, name)] ?? '',
    setToolSecret: (toolId, name, value) => {
      const id = toolSecretId(toolId, name)
      void secretsStore.set((secrets) => {
        if (!value) delete secrets[id]
        else secrets[id] = value
      }).catch(() => { /* 失败已由 onError 落盘（logger.error），IPC 调用方以返回值判断 */ })
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
      const started = Date.now()
      try {
        const result = await llmChat({
          provider,
          apiKey: req.apiKey,
          messages: req.messages,
          temperature: req.temperature,
          maxTokens: req.maxTokens,
        })
        // D-Q1 用量记录（vision）：badge 视觉识别等工具直连路径
        recordUsage(repository, {
          providerId: provider._id,
          providerName: provider.name,
          model: result.model,
          purpose: 'vision',
          streamed: false,
          contentLength: result.content.length,
          promptTokens: result.usage?.promptTokens,
          completionTokens: result.usage?.completionTokens,
          durationMs: Date.now() - started,
          ok: true,
        })
        return result.content
      } catch (err) {
        recordUsage(repository, {
          providerId: provider._id,
          providerName: provider.name,
          model: req.model,
          purpose: 'vision',
          streamed: false,
          durationMs: Date.now() - started,
          ok: false,
          error: (err as Error).message,
        })
        throw err
      }
    },
    listProviders: () => llm.listProviders(),
    chatByProvider: (req) => llm.chatByProvider(req),
    listModelsByProvider: (providerId, apiKey) => llm.listModelsByProvider(providerId, apiKey),
    runLocalOcr,
  }

  /**
   * 工具改名迁移（幂等，legacy 链式：upload-config → upload-manager → file-manager）：
   * - 2026-11-17「上传配置」→「上传管理」：secrets `app:tool:upload-config:<pid>` → `…upload-manager:<pid>`、settings `tools.upload-config.*` → `tools.upload-manager.*`
   * - 2026-11-19「上传管理」→「文件管理」：secrets `app:tool:upload-manager:<pid>` → `…file-manager:<pid>`、settings `tools.upload-manager.*` → `tools.file-manager.*`
   * 幂等：新键已存在时不覆盖（以新为准），旧键一律清掉。配置不迁移用户会"丢密钥/丢工具配置"。
   */
  function migrateToolRenames(): void {
    // 迁移链：按序执行，每段只处理自己那对 旧→新（新 id 已存在则以新为准）
    const CHAIN: Array<{ legacy: string; next: string; from: string; to: string; note: string }> = [
      { legacy: 'upload-config', next: 'upload-manager', from: 'tools.upload-config', to: 'tools.upload-manager', note: 'upload-config → upload-manager' },
      { legacy: 'upload-manager', next: TOOL_IDS.fileManager, from: 'tools.upload-manager', to: `tools.${TOOL_IDS.fileManager}`, note: 'upload-manager → file-manager' },
    ]
    try {
      const secrets = currentSecrets()
      let moved = 0
      for (const step of CHAIN) {
        const LEGACY = `app:tool:${step.legacy}:`
        for (const key of Object.keys(secrets)) {
          if (!key.startsWith(LEGACY)) continue
          const nextKey = `app:tool:${step.next}:${key.slice(LEGACY.length)}`
          if (!secrets[nextKey]) { secrets[nextKey] = secrets[key]!; moved++ }
          delete secrets[key]
        }
        const legacyCfg = config.get(step.from)
        if (legacyCfg && typeof legacyCfg === 'object' && !Array.isArray(legacyCfg)) {
          if (config.get(step.to) == null) config.set(step.to, legacyCfg)
          config.remove(step.from)
        }
        if (moved > 0 || legacyCfg) logger.info('upload', `工具改名迁移：${step.note}（本次密钥累计 ${moved} 条）`)
      }
      // 密钥命名空间提升（2026-11-19 用户拍板）：工具账下 → 应用级 app:upload:<pid>。
      // 通道 profile 数据已在应用级（app.upload），密钥留在工具命名空间会让工具改名/卸载
      // 牵连 EDM 图片上传、模板工具图片库等消费方（改名历史已两跳迁移证实脆弱）。
      // first-wins：app:upload:<pid> 已存在则以新为准；旧段一律清掉。幂等：提升后无残留。
      for (const prefix of ['app:tool:upload-config:', 'app:tool:upload-manager:', `app:tool:${TOOL_IDS.fileManager}:`]) {
        for (const key of Object.keys(secrets)) {
          if (!key.startsWith(prefix)) continue
          const nextKey = `app:upload:${key.slice(prefix.length)}`
          if (!secrets[nextKey]) { secrets[nextKey] = secrets[key]!; moved++ }
          delete secrets[key]
        }
      }
      if (moved > 0) void secretsStore.set((next) => { Object.assign(next, secrets) }).catch(() => { /* onError 已落盘 */ })
    } catch (err) {
      logger.error('upload', `工具改名迁移失败（不影响启动）：${(err as Error).message}`)
    }
  }

  void secretsStore.load().then(migrateToolRenames)

  return {
    config,
    repository,
    outputRoot,
    dbDir,
    host,
    getApiKey: (providerId) => currentSecrets()[providerId] ?? '',
    getUploadSecret: (profileId) => currentSecrets()[uploadSecretId(profileId)] ?? '',
    setUploadSecret: (profileId, value) => {
      const id = uploadSecretId(profileId)
      void secretsStore.set((secrets) => {
        if (!value) delete secrets[id]
        else secrets[id] = value
      }).catch(() => { /* onError 已落盘 */ })
    },
    ensureSecrets: async () => { await secretsStore.load() },
    setApiKey: (providerId, apiKey) => {
      if (!isProviderId(providerId)) throw new AppError(`非法 providerId: ${providerId}`)
      void secretsStore.set((secrets) => {
        if (apiKey === '') delete secrets[providerId]
        else secrets[providerId] = apiKey
      }).catch(() => { /* onError 已落盘 */ })
    },
    setAccessKey: (key) => {
      // 先写凭据再广播配置变更，保证广播触发的目录刷新拿到一致状态（P1-2：写成功后才设哈希）
      void secretsStore.set((secrets) => {
        if (!key) delete secrets[ACCESS_KEY_SECRET_ID]
        else secrets[ACCESS_KEY_SECRET_ID] = key
      }).then(() => { config.set('app.accessKeyHash', key ? sha256(key) : null) })
        .catch(() => { /* onError 已落盘；哈希未动，渲染层拿到的失败结果与存储一致 */ })
    },
    getAccessKeyState: () => {
      const key = currentSecrets()[ACCESS_KEY_SECRET_ID] ?? ''
      const hash = config.get('app.accessKeyHash') as string | null
      const valid = Boolean(key && hash && sha256(key) === hash)
      return { hasAccessKey: valid, grants: valid ? [ACCESS_GRANT] : [] }
    },
    importSecretsJson: (json) => {
      const parsed = JSON.parse(json) as { providers?: { _id?: string; apiKey?: string }[] }
      const pending: [string, string][] = []
      for (const item of parsed.providers ?? []) {
        if (!item || typeof item._id !== 'string' || !isProviderId(item._id)) continue
        if (typeof item.apiKey === 'string' && item.apiKey) pending.push([item._id, item.apiKey])
      }
      void secretsStore.set((secrets) => {
        for (const [id, apiKey] of pending) secrets[id] = apiKey
      }).catch(() => { /* onError 已落盘 */ })
    },
    // app:* 前缀的工具密钥与访问密钥都不参与 provider 迁移
    exportSecretsJson: () => JSON.stringify({
      providers: Object.entries(currentSecrets())
        .filter(([id]) => !id.startsWith('app:'))
        .map(([id, apiKey]) => ({ _id: id, apiKey })),
    }),
  }
}
