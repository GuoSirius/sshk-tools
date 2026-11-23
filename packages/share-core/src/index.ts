/**
 * @sshk/share-core — 局域网只读分享内核（plans/09）。
 * P6-6 拆分（#156 · B37-F8）：index.ts 只做聚合导出，真实边界按域落位——
 * - server.ts      内核类 ShareHub（server 监听 + 请求三级解析分发 + 全方法代理 + 挂载/代理配置）
 * - routes.ts      路由域：ShareRoute 契约 / TTL 口径 / 挂载别名规范化 / 密码继承
 * - static.ts      静态服务域：MIME / 目录列表页 / 文章阅读页（防 XSS）
 * - logs.ts        日志域：访问日志环形缓冲 + 500ms 防抖 flush
 * - state-file.ts  状态持久化域：hub-state.json resume / 节流落盘 / 清空删除
 * - network.ts     网络域：IPv4 枚举（虚拟网卡标记）+ 展示 IP 自动优选（§4.3）
 * 对外名全部保留（ShareHub/常量/工具函数——ui 子入口与宿主 modules/share/share-hub.ts 消费面零变化）。
 * 21 个内核单测（index.test.ts）为回归锚。
 */
export { ShareHub } from './server'
export { normalizeMountAlias, ttlMinutesLeft } from './routes'
export { DEFAULT_LOG_MAX_COUNT, DEFAULT_LOG_RETENTION_DAYS } from './logs'
