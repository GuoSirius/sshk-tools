/**
 * 代码编辑器统一保存快捷键绑定（2026-11-23）。
 *
 * 设计口径：Ctrl/Cmd+S 由共享 CodeEditor 统一注册到 Monaco 实例（浏览器默认「保存网页」会被
 * Monaco 的 addCommand 拦截并 preventDefault），组件只 emit('save')；具体保存动作交给各宿主
 * 已有保存函数（文件保存 / css tab / 元数据 / 配置 …）。keybinding 由调用方传入，让本模块保持
 * 纯函数、可在单测里用假编辑器验证，不依赖 monaco 的 worker 环境。
 */
export interface SaveCommandEditor {
  addCommand(keybinding: number, handler: () => void): void
}

/** 绑定保存快捷键；editor 未挂载（只读预览等）时安全跳过。重复绑定时以最后一次为准。 */
export function bindSaveShortcut(
  editor: SaveCommandEditor | null | undefined,
  keybinding: number,
  onSave: () => void,
): void {
  editor?.addCommand(keybinding, onSave)
}
