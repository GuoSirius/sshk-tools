/**
 * 代码编辑器统一保存快捷键绑定（2026-11-23）。
 *
 * 设计口径：Ctrl/Cmd+S 由共享 CodeEditor 统一注册到 Monaco 实例（浏览器默认「保存网页」会被
 * Monaco 的 addCommand 拦截并 preventDefault），组件只 emit('save')；具体保存动作交给各宿主
 * 已有保存函数（文件保存 / css tab / 元数据 / 配置 …）。keybinding 由调用方传入，让本模块保持
 * 纯函数、可在单测里用假编辑器验证，不依赖 monaco 的 worker 环境。
 */
export interface SaveCommandEditor {
  addCommand(keybinding: number, handler: () => void, when?: string): void
  /** 仅 monaco IStandaloneCodeEditor 提供：创建按编辑器 DOM 子树隔离作用域的上下文键 */
  createContextKey?(key: string, defaultValue: unknown): unknown
}

/** 实例序号：同页多编辑器实例各自需要唯一 when 键 */
let seq = 0

/**
 * 绑定保存快捷键；editor 未挂载（只读预览等）时安全跳过。
 *
 * 多实例防串（2026-11-24）：Monaco 全部 standalone 编辑器共享同一 keybinding resolver，
 * addCommand 无 when 时 _findCommand 自后向前取第一个匹配 —— 最后注册者恒赢，同页其余
 * 实例的 Ctrl+S 全部落空（内容页 4 个 tab 编辑器即表现为「源码 tab 按 Ctrl+S 保存了样式」）。
 * 故为每个实例造唯一 when 上下文键（editor.createContextKey 的键按编辑器 DOM 子树隔离，
 * keydown 只命中宿主编辑器自己的绑定，与 monaco addAction 用 editorId 作用域同机制）；
 * 无 createContextKey 的假编辑器/旧实现回退裸绑（保持旧行为）。
 */
export function bindSaveShortcut(
  editor: SaveCommandEditor | null | undefined,
  keybinding: number,
  onSave: () => void,
): void {
  if (!editor) return
  const when = `saveShortcutOwned_${++seq}`
  if (typeof editor.createContextKey === 'function') {
    editor.createContextKey(when, true)
    editor.addCommand(keybinding, onSave, when)
  } else {
    editor.addCommand(keybinding, onSave)
  }
}
