import { MODEL_MANAGER_PRESETS } from './llm/presets-data'

/**
 * app.modules.<moduleId>.* 配置默认值（P4-8c · C-3 · 台账#156）：
 * 三基础模块（file-manager / model-manager / share-manager）并入应用本体后，原工具 manifest
 * `defaults` 中的用户偏好默认值随迁至此（manifest → 数据对象语义等价），services.ts 装配时并入
 * ConfigService 默认值。键为 C-3 一次性迁移后的新前缀（旧键 tools.<oldToolId>.* 弃用不迁移）。
 *
 * - fileManager.editorMode：内容编辑器容器形态（原 file-manager manifest content-editor 组 default）；
 * - modelManager.*：网关偏好 3 字段 + 快速预设（原 model-console manifest defaults；
 *   defaultProviders 不在此处——播种数据在 modules/llm/presets-data.ts，密钥绝不默认播种）；
 * - shareManager：无配置段（分享服务参数在 app.shareHub.*，键不动）；
 * - 原 manifest 的 enabled / requiredGrant / dependsOn 为工具目录运行时策略，模块化后无对应物，不再保留。
 */
export const APP_MODULE_DEFAULTS = {
  fileManager: { editorMode: 'dialog' },
  modelManager: {
    defaultProviderId: '',
    chatTimeoutMs: 30000,
    streamEnabled: true,
    modelPresets: MODEL_MANAGER_PRESETS,
  },
  shareManager: {},
} as const

/** 把模块默认值并入 settings 基线（app.modules 段），供 ConfigService 构造使用 */
export function withAppModuleDefaults<T extends Record<string, unknown>>(base: T): T {
  const app = (base['app'] ?? {}) as Record<string, unknown>
  return { ...base, app: { ...app, modules: APP_MODULE_DEFAULTS } } as T
}
