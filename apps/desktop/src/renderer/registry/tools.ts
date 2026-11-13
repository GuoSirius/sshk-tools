// 工具注册表已上移到 @sshk/shared：主进程裁决层与渲染层共用同一份元数据真相源。
// 保留此 re-export 以兼容既有 import 路径；渲染层实际可见性以主进程 tools:list 结果为准。
export { TOOLS, TOOL_GROUPS, BUILTIN_TOOL_ICONS } from '@sshk/shared'
