export type ThemeMode = 'dark' | 'light' | 'system'
export type Origin = 'system' | 'custom'
export type EntityStatus = 'draft' | 'previewed' | 'generated' | 'archived'
export type DatasourceKind = 'image' | 'xlsx' | 'csv' | 'json'

/** 工具注册表条目：新增工具只需注册一条，桌面首页自动生成 */
export interface ToolDescriptor {
  id: string
  name: string
  description: string
  category: string
  icon: string
  entryRoute: string
  enabled: boolean
}

/** 四种上传来源统一归一后的点击统计行 */
export interface LinkStat {
  url: string
  normalizedUrl: string
  clicks: number
  totalClicks: number
  sourceFile?: string
}

/** 片段版本的可用范围策略：黑名单优先，白名单为空表示不限制 */
export interface FragmentPolicy {
  blacklist: string[]
  whitelist: string[]
}

/** 模板版本声明的槽位 */
export interface TemplateSlot {
  key: string
  type: string
  required: boolean
  multiple: boolean
  defaultFragmentVersionId?: string
  locked?: boolean
}

/** 目录迁移预检结果 */
export interface DirValidation {
  writable: boolean
  freeBytes: number
  requiredBytes: number
  isSubdirOfOld: boolean
  isSystemDir: boolean
  isNetworkDrive: boolean
  warnings: string[]
}
