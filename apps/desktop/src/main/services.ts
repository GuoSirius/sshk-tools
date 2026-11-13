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
import { chat as llmChat, type LlmProvider } from '@sshk/llm-gateway'
import {
  ACCESS_GRANT,
  ACCESS_KEY_SECRET_ID,
  mergeToolDefaults,
  type ToolHostCapabilities,
} from '@sshk/shared'
import { MANIFESTS } from './discovery'

export interface AppServices {
  config: ConfigService
  repository: Repository
  outputRoot: string
  dbDir: string
  /** 按 providerId 读取 apiKey（safeStorage 解密；永不下发渲染层） */
  getApiKey: (providerId: string) => string
  setApiKey: (providerId: string, apiKey: string) => void
  /** 应用访问密钥：写入 safeStorage，settings 只留 sha256 摘要 */
  setAccessKey: (key: string) => void
  /** 权限裁决输入：是否有效 + 已持有的 grants（不含明文） */
  getAccessKeyState: () => { hasAccessKey: boolean; grants: string[] }
  /** 全量密钥 JSON（zip 导出加密迁移用；默认导出路径拿不到它） */
  exportSecretsJson: () => string
  /** 暴露给工具插件的宿主能力；应用不依赖工具，工具可依赖这些能力 */
  host: ToolHostCapabilities
}

const PROVIDER_ID_RE = /^prv_[0-9a-z]+$/
const SECRET_PART_RE = /^[a-z][a-z0-9-]{1,32}$/

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

/** 工具专属密钥统一起 app:tool: 前缀，导出备份时自动排除，不混进 Provider 密钥 */
function toolSecretId(toolId: string, name: string): string {
  if (!SECRET_PART_RE.test(toolId) || !SECRET_PART_RE.test(name)) {
    throw new Error(`非法工具密钥标识: ${toolId}/${name}`)
  }
  return `app:tool:${toolId}:${name}`
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
        child = spawn(command, args, { shell: false, windowsHide: true })
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
    getToolSecret: (toolId, name) => loadSecrets()[toolSecretId(toolId, name)] ?? '',
    setToolSecret: (toolId, name, value) => {
      const id = toolSecretId(toolId, name)
      const secrets = loadSecrets()
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
    runLocalOcr,
  }

  return {
    config,
    repository,
    outputRoot,
    dbDir,
    host,
    getApiKey: (providerId) => loadSecrets()[providerId] ?? '',
    setApiKey: (providerId, apiKey) => {
      if (!PROVIDER_ID_RE.test(providerId)) throw new Error(`非法 providerId: ${providerId}`)
      const secrets = loadSecrets()
      if (apiKey === '') delete secrets[providerId]
      else secrets[providerId] = apiKey
      saveSecrets(secrets)
    },
    setAccessKey: (key) => {
      const secrets = loadSecrets()
      if (!key) delete secrets[ACCESS_KEY_SECRET_ID]
      else secrets[ACCESS_KEY_SECRET_ID] = key
      // 先写凭据再广播配置变更，保证广播触发的目录刷新拿到一致状态
      saveSecrets(secrets)
      config.set('app.accessKeyHash', key ? sha256(key) : null)
    },
    getAccessKeyState: () => {
      const key = loadSecrets()[ACCESS_KEY_SECRET_ID] ?? ''
      const hash = config.get('app.accessKeyHash') as string | null
      const valid = Boolean(key && hash && sha256(key) === hash)
      return { hasAccessKey: valid, grants: valid ? [ACCESS_GRANT] : [] }
    },
    // app:* 前缀的工具密钥与访问密钥都不参与 provider 迁移
    exportSecretsJson: () => JSON.stringify({
      providers: Object.entries(loadSecrets())
        .filter(([id]) => !id.startsWith('app:'))
        .map(([id, apiKey]) => ({ _id: id, apiKey })),
    }),
  }
}
