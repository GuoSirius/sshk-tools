/**
 * IPC 白名单通道契约。
 * 渲染进程只能通过 preload 暴露的 window.api.* 调用，密钥永不下发。
 */
export const IPC_CHANNELS = {
  configGet: 'config:get',
  configSet: 'config:set',
  configChanged: 'config:changed',
  appVersion: 'app:version',
  appOpenDataDir: 'app:openDataDir',
  appReload: 'app:reload',
  appToggleDevTools: 'app:toggleDevTools',
  /** 只校验访问密钥不打开 DevTools：供「开发者模式」等敏感开关复用同一套口令 */
  appVerifyDevtoolsKey: 'app:verifyDevtoolsKey',
  /** 主进程 → 渲染层：窗口即将关闭，请弹出主题色确认框 */
  appRequestClose: 'app:requestClose',
  /** 渲染层 → 主进程：用户已确认退出，置 quitting 并真正退出 */
  appConfirmClose: 'app:confirmClose',
  backupExport: 'backup:export',
  backupImport: 'backup:import',
  backupRollback: 'backup:rollback',
  storageGetDir: 'storage:getDir',
  storageMigrate: 'storage:migrate',
  themeGet: 'theme:get',
  themeSet: 'theme:set',
  themeSystemChanged: 'theme:systemChanged',
  updateCheck: 'update:check',
  updateDownload: 'update:download',
  updateQuitAndInstall: 'update:quitAndInstall',
  /** 主进程 → 渲染层：autoUpdater 全生命周期状态推送（检查/发现/下载进度/完成/失败） */
  updateState: 'update:state',
  shareStart: 'share:start',
  shareStop: 'share:stop',
  shareCopyLink: 'share:copyLink',
  llmChat: 'llm:chat',
  llmListModels: 'llm:listModels',
  llmHealthCheck: 'llm:healthCheck',
  llmSetApiKey: 'llm:setApiKey',
  /** 编辑时按需查看已存密钥（用户主动点击，不默认下发） */
  llmGetApiKey: 'llm:getApiKey',
  /** 应用级 Provider 共享：所有工具只读元信息（绝不含密钥），按 id 调用 */
  llmProviders: 'llm:providers',
  llmProviderModels: 'llm:providerModels',
  /** R26 应用级上传能力：全局 profile 在 main 解析，密钥经 safeStorage，渲染层只拿元信息 */
  uploadSingle: 'upload:single',
  uploadBatch: 'upload:batch',
  /** 主进程 → 渲染层：单文件 / 批量进度（沿用 update:state 推送范式） */
  uploadProgress: 'upload:progress',
  uploadConfigGet: 'upload:config:get',
  uploadConfigSet: 'upload:config:set',
  uploadProfiles: 'upload:profiles',
  uploadSecretSet: 'upload:secret:set',
  uploadSecretState: 'upload:secret:state',
  /** 复用 llm:getApiKey 范式：用户主动点「查看」才下发已存密钥，不随列表默认下发 */
  uploadSecretGet: 'upload:secret:get',  /** 每个 remote / cloud profile 独立连通性自检；可用表单里尚未保存的临时值，不落盘 */
  uploadTest: 'upload:test',
  osPickFile: 'os:pickFile',
  osPickDir: 'os:pickDir',
  osPickSave: 'os:pickSave',
  osReadDataUri: 'os:readDataUri',
  osWriteText: 'os:writeText',
  /** 二进制写盘（base64 → 文件；路径必须来自用户保存对话框），下载 PNG 等场景 */
  osWriteBinary: 'os:writeBinary',
  osClipboardWrite: 'os:clipboardWrite',
  osShellOpen: 'os:shellOpen',
  edmListMails: 'edm:listMails',
  edmGenerate: 'edm:generate',
  edmRegenerate: 'edm:regenerate',
  /** M4/M5：EDM 全量能力走单通道 action 白名单（brands/tpl/frg/mail/share） */
  edmApi: 'edm:api',
  /** 工具目录：主进程单一裁决，渲染层只拿可见性结果 */
  toolsList: 'tools:list',
  toolsSetEnabled: 'tools:setEnabled',
  toolsSetGrant: 'tools:setGrant',
  toolsSetDependencies: 'tools:setDependencies',
  toolsSetOverrides: 'tools:setOverrides',
  toolsSetDistribution: 'tools:setDistribution',
  toolsCleanupOrphans: 'tools:cleanupOrphans',
  /** 开发者模式（仅源码开发环境可用）：工具清单编辑 / 构建 / 导出 / 校验 */
  devState: 'dev:state',
  devManifestGet: 'dev:manifestGet',
  devManifestSet: 'dev:manifestSet',
  devVerify: 'dev:verify',
  devBuild: 'dev:build',
  devBuildExternal: 'dev:buildExternal',
  devPack: 'dev:pack',
  devToolCreate: 'dev:toolCreate',
  /** U1-1 L1 提示层（仅源码 dev）：扫描 tools/ 发现新工具，供渲染层横幅提示重启 */
  devToolScan: 'dev:toolScan',
  /** 应用访问密钥（写入 safeStorage，明文永不下发） */
  accessKeySet: 'accessKey:set',
  /** 运行时工具包（#35 阶段二）：导入 / 列表 / 卸载 */
  runtimeInstall: 'runtime:install',
  /** 安装前预览：内建冲突 / 升降级裁决（写盘前征求用户意见） */
  runtimePreview: 'runtime:preview',
  runtimeList: 'runtime:list',
  runtimeUninstall: 'runtime:uninstall',
  runtimeReadRenderer: 'runtime:readRenderer',
  runtimeKeysList: 'runtime:keysList',
  runtimeKeysImport: 'runtime:keysImport',
  runtimeKeysRevoke: 'runtime:keysRevoke',
  badgeGenerate: 'badge:generate',
  badgeRegenerate: 'badge:regenerate',
  /** N5 源更新检测：对比 poster.sourceHash 与源邮件当前 sourceHash（mail 型衍生关系） */
  badgeSourceState: 'badge:sourceState',
  badgeParseDatasource: 'badge:parseDatasource',
  badgeReadHtml: 'badge:readHtml',
  badgeMarkBadges: 'badge:markBadges',
  badgeSavePosterPng: 'badge:savePosterPng',
  badgeListPosters: 'badge:listPosters',
  badgeDeletePoster: 'badge:deletePoster',
  badgeSavePosterMeta: 'badge:savePosterMeta',
  badgeExportFiles: 'badge:exportFiles',
  /** 图片数据源：读取图片 / 视觉识别 / 工具专属密钥（PaddleOCR 与云端模型共用） */
  badgeParseImage: 'badge:parseImage',
  badgeSetVisionKey: 'badge:setVisionKey',
  badgeVisionState: 'badge:visionState',
  /** 下载已截图海报 PNG：{ posterId, outPath }，outPath 来自 pickSave */
  badgeDownloadPng: 'badge:downloadPng',
  /** 海报分享（C-T1 @sshk/share-core）：局域网只读 token 链接 */
  badgeShareStart: 'badge:shareStart',
  badgeShareStop: 'badge:shareStop',
  badgeShareStatus: 'badge:shareStatus',
  /** H3 日志落盘：渲染层 → 主进程（ipcRenderer.send 单向，不走 invoke） */
  logFrontend: 'log:frontend',
  /** 日志目录信息 / 清空（设置 → 系统与数据 → 日志） */
  logDirGet: 'log:dir',
  logClean: 'log:clean',
  /** N1 一键诊断：采集（预览，只含布尔/名称/计数）+ 导出 zip（report.md + logs/） */
  diagCollect: 'diag:collect',
  diagExport: 'diag:export',
  /** D-Q1 模型用量日志：统计（分组+最近明细）/ 清空 */
  usageStats: 'usage:stats',
  usageClear: 'usage:clear',
  /** N3 配置预设分享：导出（脱敏 JSON）/ 导入（按 id 合并，密钥不随预设走） */
  presetExport: 'preset:export',
  presetImport: 'preset:import',
  /** N4 回滚快照：列表 / 恢复 / 清空（开关 app.outputSnapshot 默认关，D19 行为零变化） */
  snapshotList: 'snapshot:list',
  snapshotRestore: 'snapshot:restore',
  snapshotClear: 'snapshot:clear',
  /** N2 工具健康度面板：聚合目录裁决 + 插件状态 + 日志 error 检索 */
  toolsHealth: 'tools:health',
  /** 关于页运行环境信息（版本/commit/Electron/Chrome/Node） */
  appRuntime: 'app:runtime',
} as const

export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS]
