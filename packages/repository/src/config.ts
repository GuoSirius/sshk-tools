import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export type ConfigListener = (namespace: 'app' | 'tools', key: string, value: unknown) => void

type Settings = Record<string, Record<string, unknown>>

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function deepMerge<T extends Record<string, unknown>>(base: T, patch: Record<string, unknown>): T {
  const out: Record<string, unknown> = { ...base }
  for (const [k, v] of Object.entries(patch)) {
    const prev = out[k]
    if (isPlainObject(v) && isPlainObject(prev)) out[k] = deepMerge(prev as Record<string, unknown>, v)
    else out[k] = v
  }
  return out as T
}

/**
 * 配置服务（数据契约 §3）：settings.json 两层结构 `app.* / tools.<id>.*`。
 * - app.*：应用/系统级（主题、产物目录、访问密钥 hash、分发白名单、工具元数据覆盖）
 * - tools.<id>.*：工具自有配置 + enabled / requiredGrant 运行时策略
 * - 写入原子化（tmp + rename）；目录自动创建（先检测后创建）
 * - 缺字段逐级补默认值；非法 JSON 视为损坏并回退默认值
 * - 写成功后触发 onChange（主进程负责经 IPC 广播 config:changed）
 */
export class ConfigService {
  private data: Settings
  private listeners = new Set<ConfigListener>()

  constructor(
    private readonly filePath: string,
    private readonly defaults: Settings,
  ) {
    this.data = this.load()
  }

  private load(): Settings {
    if (!existsSync(this.filePath)) {
      return structuredClone(this.defaults)
    }
    try {
      const raw = JSON.parse(readFileSync(this.filePath, 'utf8')) as Settings
      return deepMerge(structuredClone(this.defaults), raw)
    } catch {
      return structuredClone(this.defaults)
    }
  }

  private persist(): void {
    mkdirSync(dirname(this.filePath), { recursive: true })
    const tmp = `${this.filePath}.tmp`
    writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf8')
    renameSync(tmp, this.filePath)
  }

  /** 点路径读取，如 `app.outputDir` / `tools.badge-studio.badgeAttr` */
  get(path: string): unknown {
    const [ns, ...rest] = path.split('.')
    const section = this.data[ns ?? '']
    if (!section) return undefined
    let cur: unknown = section
    for (const k of rest) {
      if (!isPlainObject(cur)) return undefined
      cur = cur[k]
    }
    return cur
  }

  /** 点路径写入；namespace 仅限 app / tools.<toolId> */
  set(path: string, value: unknown): void {
    const parts = path.split('.')
    const ns = parts[0]
    if (ns !== 'app' && ns !== 'tools') {
      throw new Error(`配置命名空间仅限 app / tools: ${path}`)
    }
    if ((parts.length ?? 0) < 2) {
      throw new Error(`配置写入必须带 key: ${path}`)
    }
    if (!this.data[ns]) this.data[ns] = {}
    let cur = this.data[ns]!
    for (let i = 1; i < parts.length - 1; i++) {
      const k = parts[i]!
      if (!isPlainObject(cur[k])) cur[k] = {}
      cur = cur[k] as Record<string, unknown>
    }
    const leaf = parts[parts.length - 1]!
    cur[leaf] = value
    this.persist()
    for (const fn of this.listeners) fn(ns, parts.slice(1).join('.'), value)
  }

  /** 删除一个配置段（清理已删除工具留下的孤儿配置） */
  remove(path: string): void {
    const parts = path.split('.')
    const ns = parts[0]
    if (ns !== 'app' && ns !== 'tools') {
      throw new Error(`配置命名空间仅限 app / tools: ${path}`)
    }
    if (parts.length < 2) throw new Error(`配置删除必须带 key: ${path}`)
    const section = this.data[ns]
    if (!section) return
    let cur = section
    for (let i = 1; i < parts.length - 1; i++) {
      const next = cur[parts[i]!]
      if (!isPlainObject(next)) return
      cur = next
    }
    delete cur[parts[parts.length - 1]!]
    this.persist()
    for (const fn of this.listeners) fn(ns, parts.slice(1).join('.'), undefined)
  }

  /** settings.json 中已有的 tools.<id>，用于孤儿配置识别 */
  listToolIds(): string[] {
    return Object.keys(this.data.tools ?? {})
  }

  onChanged(fn: ConfigListener): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  /** 导入整段配置（zip 导入用；调用方负责剔除机器相关字段） */
  replaceAll(next: Settings): void {
    this.data = deepMerge(structuredClone(this.defaults), next)
    this.persist()
  }

  snapshot(): Settings {
    return structuredClone(this.data)
  }
}

export const DEFAULT_SETTINGS: Settings = {
  app: {
    themeMode: 'dark',
    sidebarCollapsed: false,
    autoUpdate: true,
    updateChannel: 'stable',
    locale: 'zh-CN',
    outputDir: null,
    share: { enabled: true, port: 0, bindLan: true, ttlHours: 72 },
    launchOnBoot: false,
    tray: true,
    window: { width: 1440, height: 900, maximized: false },
    llm: { activeProviderId: null, providers: [] },
    /** 访问密钥的 sha256（仅存摘要，明文只进 safeStorage） */
    accessKeyHash: null,
    /** 分发白名单；null = 全部工具 */
    distribution: { includeTools: null },
    /** 工具元数据覆盖：app.toolOverrides.<id> = { name, description, category, icon } */
    toolOverrides: {},
  },
  /**
   * 工具配置默认值不在这里硬编码：宿主启动时由
   * mergeToolDefaults(DEFAULT_SETTINGS, MANIFESTS) 把各工具包
   * tool.manifest.json 的 defaults 合并进来（应用不强依赖工具）。
   */
  tools: {},
}

export function defaultConfigPath(userDataDir: string): string {
  return join(userDataDir, 'settings.json')
}
