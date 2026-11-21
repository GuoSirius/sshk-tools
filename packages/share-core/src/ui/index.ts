/**
 * `@sshk/share-core/ui` —— 分享内核的渲染子入口（C-4 · P5-3）：
 * ShareDialog 与 share-ticket 凭证存取从 ui-kit 迁入，与内核同包就近维护；
 * ui-kit 回归零业务纯通用组件（B10 收口）。工具与分享管理模块共同消费。
 */
export { default as ShareDialog } from './ShareDialog.vue'
export { shareDialogStorageKey, readShareTicket, isTicketAlive, findShareTicketById, migrateShareTickets, shareFileDirectUrl, buildDirectUrl } from './share-ticket'
