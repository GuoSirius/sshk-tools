// ulid 实现已下沉到 @sshk/shared（纯包，渲染层可用）；此处按仓库约定再导出，
// 主进程侧代码继续从 @sshk/repository 引用不影响行为。
export { ulid, entityId } from '@sshk/shared'
