/**
 * D18 密钥跨机迁移（2026-11-17 起已删除 env 门控）：导出端填「迁移口令」即加密携带密钥，
 * 不再有 SSHK_TOOLS_ALLOW_SECRET_MIGRATION 开关（见 main/index.ts:317）。此处不定义任何相关常量。
 */
export const DEFAULT_THEME_MODE = 'dark'
/** Badge 徽标属性 / 点击字段 / 海报宽度默认值（CR-23 A案：badge-studio 硬编码孪生全部改引此处） */
export const DEFAULT_BADGE_ATTR = 'data-edm-badge'
export const DEFAULT_CLICKS_FIELD = 'clicks'
export const DEFAULT_POSTER_WIDTH = 680

export const TOOL_IDS = {
  edmStudio: 'edm-studio',
  badgeStudio: 'badge-studio',
  /** P4-8c（C-11 敲板，台账#156）：原 model-console 工具随 P4-8b 退役并入应用本体（模型管理模块），
   *  id 定稿 model-manager；键名保留 modelConsole 避免全量改引用。旧 id 的存量分享路由/日志数据
   *  不迁移（历史数据），分享归属校验白名单已含旧 id（见 main/modules/share/share-hub.ts）。 */
  modelConsole: 'model-manager',
  /** 2026-11-17 由 upload-config 改名（上传配置→上传管理）；2026-11-19 再改名（上传管理→文件管理）。
   *  旧 id 链 upload-config → upload-manager → file-manager 的密钥/配置段/hub 路由启动时自动迁移 */
  fileManager: 'file-manager',
} as const

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
