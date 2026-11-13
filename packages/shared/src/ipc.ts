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
  osPickFile: 'os:pickFile',
  osPickDir: 'os:pickDir',
  osPickSave: 'os:pickSave',
  osReadDataUri: 'os:readDataUri',
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
  /** 应用访问密钥（写入 safeStorage，明文永不下发） */
  accessKeySet: 'accessKey:set',
  /** 运行时工具包（#35 阶段二）：导入 / 列表 / 卸载 */
  runtimeInstall: 'runtime:install',
  runtimeList: 'runtime:list',
  runtimeUninstall: 'runtime:uninstall',
  badgeGenerate: 'badge:generate',
  badgeRegenerate: 'badge:regenerate',
  badgeParseDatasource: 'badge:parseDatasource',
  badgeReadHtml: 'badge:readHtml',
  badgeMarkBadges: 'badge:markBadges',
  badgeSavePosterPng: 'badge:savePosterPng',
  badgeListPosters: 'badge:listPosters',
  badgeDeletePoster: 'badge:deletePoster',
  /** 图片数据源：读取图片 / 视觉识别 / 工具专属密钥（PaddleOCR 与云端模型共用） */
  badgeParseImage: 'badge:parseImage',
  badgeSetVisionKey: 'badge:setVisionKey',
  badgeVisionState: 'badge:visionState',
} as const

export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS]
