/** D18：检测到该环境变量才允许加密携带模型密钥，实现 100% 导入还原 */
export const ENV_ALLOW_SECRET_MIGRATION = 'SSHK_TOOLS_ALLOW_SECRET_MIGRATION'

export const DEFAULT_THEME_MODE = 'dark'
export const DEFAULT_BADGE_ATTR = 'data-edm-badge'
export const DEFAULT_CLICKS_FIELD = 'clicks'
export const DEFAULT_POSTER_WIDTH = 680
export const DEFAULT_CAPTURE_SEGMENT_HEIGHT = 4000

export const ID_PREFIX = {
  brand: 'brd',
  template: 'tpl',
  templateVersion: 'tplv',
  fragment: 'frg',
  fragmentVersion: 'frgv',
  mail: 'mail',
  poster: 'pst',
  provider: 'prv',
} as const

export const TOOL_IDS = {
  edmStudio: 'edm-studio',
  badgeStudio: 'badge-studio',
  modelConsole: 'model-console',
} as const

export const CONFIG_NAMESPACE = {
  app: 'app',
  tools: 'tools',
} as const

/** 产物目录下应用自有的子目录（迁移时只处理这些，绝不递归删用户目录本身） */
export const OUTPUT_SUBDIRS = {
  outputs: 'outputs',
  assets: 'assets',
  manifest: '.storage-manifest.json',
  staging: '.migrating',
} as const

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
