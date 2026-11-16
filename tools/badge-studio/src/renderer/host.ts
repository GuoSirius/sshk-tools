import { IPC_CHANNELS as C } from '@sshk/shared'
import { createSafeHost } from '@sshk/ui-kit'

/**
 * H2 零裸调：badge-studio 渲染层宿主代理。
 * 通道映射=方法名→IPC_CHANNELS；事件订阅类（upload.onProgress）不登记、直通具名方法。
 */
export const host = createSafeHost({
  config: { get: C.configGet, set: C.configSet },
  os: {
    pickFile: C.osPickFile,
    pickSave: C.osPickSave,
    readDataUri: C.osReadDataUri,
    clipboardWrite: C.osClipboardWrite,
  },
  llm: { providers: C.llmProviders, providerModels: C.llmProviderModels },
  /** N5：从 EDM 邮件选择源 HTML（mail:list 单通道） */
  edm: { api: C.edmApi },
  upload: { batch: C.uploadBatch },
  badge: {
    generate: C.badgeGenerate,
    regenerate: C.badgeRegenerate,
    sourceState: C.badgeSourceState,
    parseDatasource: C.badgeParseDatasource,
    readHtml: C.badgeReadHtml,
    markBadges: C.badgeMarkBadges,
    savePosterPng: C.badgeSavePosterPng,
    listPosters: C.badgeListPosters,
    deletePoster: C.badgeDeletePoster,
    savePosterMeta: C.badgeSavePosterMeta,
    exportFiles: C.badgeExportFiles,
    parseImage: C.badgeParseImage,
    setVisionKey: C.badgeSetVisionKey,
    visionState: C.badgeVisionState,
    downloadPng: C.badgeDownloadPng,
    shareStart: C.badgeShareStart,
    shareStop: C.badgeShareStop,
    shareStatus: C.badgeShareStatus,
  },
})
