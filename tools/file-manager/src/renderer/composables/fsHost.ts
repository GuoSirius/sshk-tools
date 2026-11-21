/**
 * fs/os/upload/shareHub 宿主通道直连封装点（H2 零裸调规则的唯一豁免点）。
 *
 * 背景：FileExplorerPage 原页面（.vue，不在 H2 lint 范围）对 window.api.fs / os / upload / shareHub
 * 全量直调；P4-4 结构拆分把这些行为逐字平移进 .ts composable 后触发 H2 规则。
 * 为保证「拆结构、保行为」——通道、参数、调用时机零变化——本文件集中 re-export 直连句柄，
 * 各 composable 一律经此取用；文件级 eslint-disable 仅豁免 no-restricted-syntax 的 H2 选择器。
 *
 * 说明：可探测式能力声明（createSafeHost + hostApiMissing）见 ../host.ts（os/content/upload 部分
 * 通道，ProfilesPage 消费）；fs.* 通道由桌面 preload 显式声明（apps/desktop/src/preload/index.ts），
 * 与原页面行为一致，不做能力探测。
 */
/* eslint-disable no-restricted-syntax -- H2 豁免：window.api.* 直连唯一封装点（原 .vue 页面行为保真平移） */
export const fsApi = window.api.fs
export const osApi = window.api.os
export const uploadApi = window.api.upload
export const shareHubApi = window.api.shareHub
