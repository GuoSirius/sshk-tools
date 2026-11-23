/**
 * D18 密钥跨机迁移（2026-11-17 起已删除 env 门控）：导出端填「迁移口令」即加密携带密钥，
 * 不再有 SSHK_TOOLS_ALLOW_SECRET_MIGRATION 开关（见 main/index.ts:317）。此处不定义任何相关常量。
 */
export const DEFAULT_THEME_MODE = 'dark'
/** Badge 徽标属性 / 点击字段 / 海报宽度默认值（CR-23 A案：badge-studio 硬编码孪生全部改引此处） */
export const DEFAULT_BADGE_ATTR = 'data-edm-badge'
export const DEFAULT_CLICKS_FIELD = 'clicks'
export const DEFAULT_POSTER_WIDTH = 680

/**
 * 纯工具 id 单一定义点（P8-4 · A7/CR-08）：verify-steps / edm-studio 主进程等跨文件静态引用统一走此常量，禁散写字面量。
 * 仅收录仍以「工具」形态存在的 id；file-manager / model-manager / share-manager 已随 P4-8（D53）退役为
 * 应用模块 id（应用管理 pages/app-admin/*），不再入此表——模块 id 引用统一走
 * apps/desktop/src/shared/verify-steps.ts 的 MODULE_IDS 与各消费点字面量。
 */
export const TOOL_IDS = {
  edmStudio: 'edm-studio',
  badgeStudio: 'badge-studio',
} as const

/**
 * 纯渲染模板工具 id（P8-4 · A7/CR-08：verify-steps 等跨文件静态引用统一走此常量，禁散写字面量）。
 * template-tool 未入上方 TOOL_IDS：它不参与按工具枚举的迁移/通道扫描链，仅作静态引用常量。
 */
export const TEMPLATE_TOOL_ID = 'template-tool'

/**
 * 工具配置键统一拼接（CR-25③ · P0-7）：`tools.<toolId>.<key>`。
 * 此前 badge-studio / model-console 各自重复实现同名 configKey()，格式漂移无门禁。
 */
export function toolConfigKey(toolId: string, key: string): string {
  return `tools.${toolId}.${key}`
}

/** 三阶段邮件产物文件名（覆盖式，固定路径） */
export const EDM_OUTPUT_FILES = {
  assembled: 'assembled.html',
  inlined: 'inlined.html',
  final: 'final.html',
} as const

/** 海报产物文件名（覆盖式，固定路径） */
export const POSTER_OUTPUT_FILES = {
  badged: 'badged.html',
  poster: 'poster.png',
} as const

/** 访问密钥解锁的 grant；工具声明 requiredGrant 后必须持有它才可见 */
export const ACCESS_GRANT = 'tools.restricted'
/** safeStorage 中应用访问密钥的条目名（密钥永不进入 settings.json） */
export const ACCESS_KEY_SECRET_ID = 'app:accessKey'
/** 清单里的 icon=auto 表示「使用工具包自带 assets/icon.svg」 */
export const AUTO_TOOL_ICON = 'auto'
/** 图标未配置 / 配置无效时回退的系统默认图标 key */
export const DEFAULT_TOOL_ICON = 'default'

/**
 * 分享路由「永久有效」哨兵（plans/09，用户 2026-11-17 拍板 ttlHours=0 即永久）：
 * 用安全整数上界作 expiresAt —— Date.now() 永不越过（不会误清理），
 * 且 JSON.stringify 能精确往返（Infinity 会变 null 破坏 resume）。
 */
export const SHARE_PERMANENT_EXPIRES_AT = Number.MAX_SAFE_INTEGER

/** 裸 expiresAt 存活判定（J-04 · 2026-11-22 复核）：永久哨兵视为永久有效。
 *  此前 9+ 处手写同一比较（ShareDialog/ContentsPage/posters/share-util/useFsShareMarks/server 内核），
 *  useFsShareMarks 曾硬编码 8e15 近似哨兵（漂移风险）——统一收编本谓词（落 shared：内核/渲染层同源，无 ui 反向依赖） */
export function isExpiresAlive(expiresAt: number, now = Date.now()): boolean {
  return expiresAt === SHARE_PERMANENT_EXPIRES_AT || expiresAt > now
}
