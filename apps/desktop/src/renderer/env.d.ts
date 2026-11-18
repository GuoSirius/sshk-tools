/// <reference path="../types/vite-glob.d.ts" />

declare module 'virtual:uno.css'
/** CSS 副作用导入：TS 6 起会校验 side-effect import，本地声明即可，不依赖 vite/client 类型包 */
declare module '*.css'
declare module '*.scss'
declare module '*.svg' {
  const url: string
  export default url
}

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<Record<string, unknown>, Record<string, unknown>, unknown>
  export default component
}

interface LlmProvider {
  _id: string
  name: string
  kind: 'local' | 'remote'
  baseURL: string
  /** 默认模型名 */
  model: string
  /** 回退模型名：默认模型失败后自动回退再试，可留空 */
  fallbackModel?: string
  /** 每个模型失败后的额外重试次数（0-5），默认 0 */
  maxRetries?: number
  enabled: boolean
}

/** 主进程推送的 autoUpdater 全生命周期状态 */
interface UpdateState {
  phase: 'idle' | 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error' | 'dev'
  version?: string
  percent?: number
  error?: string
}

interface PosterRecord {
  _id: string
  name: string
  source: { type: 'mail' | 'upload'; mailId?: string; htmlPath: string }
  datasources: { file: string; kind: string; ocrReviewed?: boolean }[]
  configSnapshot: { badgeAttr: string; clicksField: string; posterWidth: number; scale: number; badgePositionText?: string; badgePositionImage?: string }
  outputs: { badged?: string; poster?: string }
  statsSnapshot?: Record<string, unknown>[]
  status: string
  lastGeneratedAt?: string
  createdAt: string
  updatedAt: string
  archived: boolean
}

interface Window {
  api: {
    config: {
      get(key: string): Promise<unknown>
      set(key: string, value: unknown): Promise<boolean>
      onChanged(callback: (payload: { namespace: string; key: string }) => void): void
    }
    theme: {
      set(mode: string): Promise<boolean>
      onSystemChanged(callback: () => void): void
    }
    app: {
      version(): Promise<string>
      runtime(): Promise<{ version: string; commit: string; electron: string; chrome: string; node: string }>
      openDataDir(): Promise<void>
      reload(force?: boolean): Promise<boolean>
      toggleDevTools(key?: string): Promise<boolean>
      verifyDevtoolsKey(key: string, operation?: 'devtools' | 'developerMode'): Promise<boolean>
      /** 主进程在窗口关闭前回调：渲染层据此弹出主题色确认框 */
      onRequestClose(callback: () => void): void
      /** 渲染层确认关闭后调用：主进程置 quitting 并真正退出 */
      confirmClose(): Promise<boolean>
    }
    update: {
      check(): Promise<{ dev?: boolean; disabled?: boolean; updateAvailable?: boolean; version?: string | null; error?: string }>
      download(): Promise<boolean>
      quitAndInstall(): Promise<{ dev?: boolean } | void>
      onState(callback: (payload: UpdateState) => void): void
    }
    llm: {
      chat(
        provider: LlmProvider,
        messages: {
          role: 'system' | 'user' | 'assistant'
          content: string | Array<
            { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }
          >
        }[],
        options?: { onDelta?: boolean; /** 工具自选模型：优先于 Provider 默认模型与回退模型 */ model?: string },
      ): Promise<{ content: string; model: string }>
      onDelta(callback: (delta: string) => void): void
      /** apiKey 可选：保存 Provider 前用刚填的 key 探测；不传则读主进程 safeStorage */
      listModels(provider: LlmProvider, apiKey?: string): Promise<string[]>
      healthCheck(provider: LlmProvider, apiKey?: string): Promise<{ ok: boolean; message: string; latencyMs?: number }>
      setApiKey(providerId: string, apiKey: string): Promise<boolean>
      /** 编辑时按需查看已存密钥（用户主动点击） */
      getApiKey(providerId: string): Promise<string>
      /** 应用级 Provider 只读清单（不含密钥）；所有工具共用一份配置 */
      providers(): Promise<import('@sshk/shared').LlmProviderInfo[]>
      /** 按 Provider id 查 /models；不落盘密钥 */
      providerModels(providerId: string, apiKey?: string): Promise<string[]>
    }
    /** R26 应用级上传能力（全局 profile / safeStorage 密钥不下发） */
    upload: {
      single(req: { toolId?: string; name: string; size: number; mime?: string; source?: string; dataUrl?: string; targetType?: 'local' | 'remote' | 'cloud'; profileId?: string; overrides?: { localDir?: string; remotePath?: string; bucket?: string; prefix?: string } }): Promise<{ url: string; key?: string; name: string }>
      batch(reqs: { toolId?: string; name: string; size: number; mime?: string; source?: string; dataUrl?: string }[]): Promise<{ url: string; key?: string; name: string }[]>
      onProgress(callback: (payload: { name: string; percent: number; status: string; error?: string }) => void): void
      getConfig(): Promise<import('@sshk/shared').UploadGlobalConfig>
      setConfig(cfg: unknown): Promise<import('@sshk/shared').UploadGlobalConfig>
      profiles(type?: 'remote' | 'cloud'): Promise<import('@sshk/shared').UploadProfileOption[]>
      setSecret(profileId: string, value: string): Promise<boolean>
      secretState(): Promise<Record<string, boolean>>
      getSecret(profileId: string): Promise<string>
      /** N11：返回结构化结果，校验失败不 reject，避免主进程控制台刷堆栈 */
      test(req: { type: 'remote' | 'cloud'; profile: Record<string, unknown>; secret?: string }): Promise<{ ok: boolean; message: string }>
      /** 富文本图片库：按来源列出已有图片，返回分页（nextCursor 非空可续拉） */
      listImages(req: { toolId?: string; targetType?: 'local' | 'remote' | 'cloud'; profileId?: string; overrides?: { localDir?: string; remotePath?: string; bucket?: string; prefix?: string }; limit?: number; cursor?: string }): Promise<{ items: { url: string; key: string; name: string; size?: number; modified?: number }[]; nextCursor?: string | null }>
      /** 富文本图片库：按来源列出真实目录（含空目录），返回相对路径数组 */
      listDirectories(req: { toolId?: string; targetType?: 'local' | 'remote' | 'cloud'; profileId?: string; overrides?: { localDir?: string; remotePath?: string; bucket?: string; prefix?: string } }): Promise<string[]>
    }
    os: {
      pickFile(opts?: { filters?: { name: string; extensions: string[] }[]; multi?: boolean; defaultPath?: string }): Promise<string[]>
      pickDir(opts?: { defaultPath?: string }): Promise<string>
      pickSave(opts?: { fileName?: string; extensions?: string[]; defaultPath?: string }): Promise<string>
      readDataUri(file: string): Promise<string>
      writeText(path: string, content: string): Promise<boolean>
      writeBinary(path: string, base64: string): Promise<boolean>
      clipboardWrite(text: string): Promise<boolean>
      shellOpen(target: string): Promise<boolean>
    }
    /** X6 文件系统：已配置上传通道的远端/云浏览管理 + 统一传输队列（密钥只在 main） */
    fs: {
      profiles(): Promise<import('@sshk/shared').FsProfilesPayload>
      list(req: { profileId: string; path: string; cursor?: string | null }): Promise<import('@sshk/shared').FsListPage>
      stat(req: { profileId: string; path: string }): Promise<import('@sshk/shared').FsStatResult>
      mkdir(req: { profileId: string; path: string }): Promise<boolean>
      rm(req: import('@sshk/shared').FsRmRequest): Promise<{ taskIds: string[] }>
      cp(req: import('@sshk/shared').FsCpRequest): Promise<{ taskIds: string[] }>
      mv(req: import('@sshk/shared').FsMvRequest): Promise<boolean>
      /** 跨通道复制（目录 main 侧递归展开，走传输队列） */
      crossCopy(req: import('@sshk/shared').FsCrossCopyRequest): Promise<import('@sshk/shared').FsCrossCopyResult>
      /** 递归搜索（path 前缀内名称子串匹配） */
      search(req: import('@sshk/shared').FsSearchRequest): Promise<import('@sshk/shared').FsSearchResult>
      /** 目录容量统计 */
      usage(req: { profileId: string; path: string }): Promise<import('@sshk/shared').FsUsageResult>
      read(req: { profileId: string; path: string; maxBytes?: number }): Promise<import('@sshk/shared').FsReadResult>
      write(req: import('@sshk/shared').FsWriteRequest): Promise<boolean>
      transferStart(inputs: import('@sshk/shared').FsTransferInput[]): Promise<{ taskIds: string[] }>
      transferList(): Promise<import('@sshk/shared').FsTransferTask[]>
      transferCancel(ids: string[]): Promise<boolean>
      transferRetry(ids: string[], overwrite?: boolean): Promise<boolean>
      transferClear(): Promise<{ removed: number }>
      onTransferEvent(callback: (task: import('@sshk/shared').FsTransferTask) => void): void
      pickUpload(opts?: { type?: 'file' | 'dir' | 'any' }): Promise<string[]>
      flattenLocal(paths: string[]): Promise<import('@sshk/shared').FsLocalFile[]>
      downloadDir(profileId: string): Promise<string>
      setDownloadDir(dir: string): Promise<string>
      /** 拖拽 File → 本地绝对路径（非文件拖拽返回 ''） */
      pathForFile(file: File): string
    }
    badge: {
      parseDatasource(file: string): Promise<{ kind: string; rows: { url: string; clicks: number; totalClicks: number }[]; warnings: string[] }>
      readHtml(file: string): Promise<{ html: string; hash: string }>
      markBadges(payload: unknown): Promise<string>
      generate(payload: unknown): Promise<{ posterId: string; badgedRel: string; html: string; matchCounts: Record<string, number> }>
      /** N5 源更新检测：对比 poster.sourceHash 与源邮件当前指纹 */
      sourceState(payload?: { posterIds?: string[] }): Promise<{ rows: { posterId: string; stale: boolean; sourceRel: string | null; mailId: string | null }[] }>
      savePosterPng(payload: { posterId: string; base64: string }): Promise<string>
      listPosters(): Promise<PosterRecord[]>
      savePosterMeta(payload: { posterId?: string; name?: string; configSnapshot?: { badgeAttr: string; clicksField: string; badgePositionText?: string; badgePositionImage?: string } }): Promise<{ posterId: string }>
      deletePoster(posterId: string): Promise<boolean>
      downloadPng(payload: { posterId: string; outPath: string }): Promise<{ outPath: string }>
      templateDownload(fmt: 'xlsx' | 'csv' | 'json'): Promise<{ base64: string; fileName: string }>
      exportFiles(payload: { posterIds: string[]; outPath: string }): Promise<{ outPath: string; posters: number }>
      parseImage(payload: {
        file: string
        provider: 'cloud' | 'paddleocr' | 'manual'
        providerId?: string
        model?: string
        paddleCommand?: string
        paddleArgs?: string
        ocrLayout?: import('@sshk/badge-studio').OcrLayoutConfig
      }): Promise<{
        rows: { url: string; clicks: number; totalClicks: number; metrics?: Record<string, number> }[]
        warnings: string[]
        csv: string
        raw: string
      }>
      setVisionKey(key: string): Promise<boolean>
      visionState(): Promise<{ hasKey: boolean }>
    }
    logs: {
      logFront(payload: { level: 'debug' | 'info' | 'warn' | 'error'; scope: string; msg: string; detail?: unknown }): void
      getDir(): Promise<{ dir: string; sizeBytes: number; files: { name: string; sizeBytes: number }[] }>
      clean(): Promise<{ removed: number }>
    }
    diagnostics: {
      collect(): Promise<import('@sshk/shared').DiagnosisData>
      save(outPath: string): Promise<{ file: string; logs: number }>
    }
    usage: {
      stats(since?: string | null): Promise<import('@sshk/shared').UsageStatsPayload>
      clear(keepDays?: number): Promise<{ removed: number }>
    }
    tools: {
      list(): Promise<import('@sshk/shared').ToolCatalogPayload>
      setEnabled(id: string, enabled: boolean): Promise<import('@sshk/shared').ToolCatalogPayload>
      setGrant(id: string, grant: string): Promise<import('@sshk/shared').ToolCatalogPayload>
      setDependencies(id: string, ids: string[]): Promise<import('@sshk/shared').ToolCatalogPayload>
      setOverrides(id: string, overrides: Record<string, string>): Promise<import('@sshk/shared').ToolCatalogPayload>
      setDistribution(ids: string[] | null): Promise<import('@sshk/shared').ToolCatalogPayload>
      cleanupOrphans(): Promise<import('@sshk/shared').ToolCatalogPayload>
      /** N2 工具健康度：聚合目录裁决 + 插件状态 + 日志 error 检索（无敏感信息） */
      health(): Promise<import('@sshk/shared').ToolHealthPayload>
    }
    /** U2 验证引导：会话存取 + main 侧自动判定 */
    verify: {
      load(date?: string): Promise<import('@sshk/shared').VerifySession | null>
      save(session: import('@sshk/shared').VerifySession): Promise<string>
      list(): Promise<string[]>
      autoCheck(req: { kind: string; spec: string }): Promise<{ state: string; detail: string }>
    }
    presets: {
      /** 导出配置预设；includeSecrets=true 携带明文密钥（需用户显式开启） */
      export(outPath: string, includeSecrets?: boolean): Promise<{ file: string; providers: number; uploadProfiles: number; secrets: number }>
      /** 导入配置预设（按 id 合并，含密钥时写回 safeStorage） */
      import(filePath: string): Promise<{ providersMerged: number; uploadProfilesMerged: number }>
    }
    snapshots: {
      /** N4 回滚快照：列表（时间倒序） */
      list(): Promise<import('@sshk/repository').OutputSnapshotEntry[]>
      restore(id: string): Promise<string>
      clear(): Promise<{ removed: number }>
    }
    backup: {
      export(zipPath: string, passphrase?: string): Promise<{ counts: Record<string, number>; file: string }>
      import(zipPath: string, passphrase?: string): Promise<{ counts: Record<string, number>; secretsRestored: number; secretsMessage: string }>
    }
    runtime: {
      preview(zipPath: string): Promise<import('@sshk/shared').InstallPreview>
      install(zipPath: string, explicitlyTrusted?: boolean): Promise<{ record: import('@sshk/shared').InstalledPackageRecord; warnings: string[] }>
      list(): Promise<import('@sshk/shared').InstalledPackageRecord[]>
      uninstall(id: string): Promise<boolean>
      readRenderer(packageId: string): Promise<string>
      keysList(): Promise<{ keyId: string; label: string; importedAt: string }[]>
      keysImport(label: string, pem: string): Promise<{ keyId: string; label: string }>
      keysRevoke(keyId: string): Promise<boolean>
    }
    accessKey: {
      set(key: string): Promise<import('@sshk/shared').ToolCatalogPayload>
    }
    /** 开发者工具：仅源码开发环境可用；state().available=false 时 UI 禁用入口 */
    dev: {
      state(): Promise<{ available: boolean; repoRoot: string | null; reason: string }>
      manifestGet(id: string): Promise<string>
      manifestSet(id: string, raw: string): Promise<{ ok: boolean; output: string; catalog?: import('@sshk/shared').ToolCatalogPayload }>
      verify(): Promise<{ ok: boolean; output: string }>
      build(): Promise<{ ok: boolean; output: string }>
      buildExternal(id: string): Promise<{ ok: boolean; output: string }>
      pack(id: string, sign?: boolean): Promise<{ ok: boolean; output: string }>
      /** 仅 dev：创建工具向导提交后生成整套骨架 */
      create(req: Record<string, unknown>): Promise<{ ok: boolean; output: string; catalog?: import('@sshk/shared').ToolCatalogPayload }>
      /** U1-1 L1 提示层：扫描 tools/ 发现清单外的新工具（打包版恒空） */
      toolScan(): Promise<{ newTools: { id: string; name: string }[] }>
    }
    /** 通用通道调用：工具（含运行时外部包）调用各自 main 注册的专属通道 */
    ipc: {
      invoke(channel: string, ...args: unknown[]): Promise<unknown>
    }
    edm: {
      api(action: string, data?: Record<string, unknown>): Promise<unknown>
    }
    /** ShareHub 常驻分享服务（plans/09） */
    shareHub: {
      create(input: import('@sshk/shared').ShareRouteInput): Promise<import('@sshk/shared').ShareRouteTicket>
      list(toolId?: string): Promise<import('@sshk/shared').ShareRouteInfo[]>
      revoke(id: string, toolId?: string): Promise<boolean>
      renew(id: string, ttlHours: number | null, toolId?: string, mode?: 'reset' | 'extend', patch?: { allowIndex?: boolean }): Promise<import('@sshk/shared').ShareRouteTicket>
      status(): Promise<import('@sshk/shared').HubStatus>
    }
    shareHubControl: {
      start(): Promise<{ port: number }>
      restart(): Promise<{ port: number }>
      stop(): Promise<{ port: number }>
      clear(): Promise<{ port: number }>
    }
  }
}
