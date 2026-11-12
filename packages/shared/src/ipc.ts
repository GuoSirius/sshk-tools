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
  edmListMails: 'edm:listMails',
  edmGenerate: 'edm:generate',
  edmRegenerate: 'edm:regenerate',
  badgeGenerate: 'badge:generate',
  badgeRegenerate: 'badge:regenerate',
} as const

export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS]
