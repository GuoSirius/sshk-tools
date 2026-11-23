/**
 * 应用内置模块 id 单一定义点（P4-8 · D53 口径延续）：四个基础模块并入应用本体后的命名空间，
 * 渲染层 provideToolId / ToolSettingsPage tool-id / verify-steps 直达目标 / VerifyGuidePage
 * 路由映射统一引用本表——禁再散写 'file-manager' 等模块 id 字面量（#129 铁律的应用内延伸，
 * 口径同 verify-steps 头注释；值须与 verify-structure §3a-2 KNOWN 白名单一致）。
 */
export const MODULE_IDS = {
  fileManager: 'file-manager',
  modelManager: 'model-manager',
  shareManager: 'share-manager',
  formManager: 'form-manager',
} as const

export type AppModuleId = (typeof MODULE_IDS)[keyof typeof MODULE_IDS]
