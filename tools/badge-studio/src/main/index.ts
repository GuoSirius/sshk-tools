import { registerBadgeIpc } from './ipc.js'

export type { StatRow, ParsedDatasource } from '../core/datasource.js'
export { parseDatasource, parseCsvText } from '../core/datasource.js'
export { normalizeUrl, DEFAULT_URL_NORM } from '../core/url-norm.js'
export type { UrlNormConfig } from '../core/url-norm.js'
export { injectBadges, markBadges } from '../core/badge.js'
export type { BadgeInjectConfig, BadgeStyle } from '../core/badge.js'
export { registerBadgeIpc } from './ipc.js'
export type { BadgeIpcDeps } from './ipc.js'
export { hashHtml } from './hash.js'

/**
 * 插件入口契约：宿主只认 default / register 导出。
 * 早期加载器「随便找一个函数」会误挑 parseDatasource，导致 IPC 全部未注册。
 */
export default registerBadgeIpc
