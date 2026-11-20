/**
 * wangEditor 自定义菜单：「Markdown 预览」（用户需求 2026-11-20 #131：扩展组新增操作）。
 *
 * 与「查看源码」（HTML）成对：本菜单把当前正文的 HTML 转成 Markdown 文本，
 * exec 经 WeakMap 回调到组件实例，由组件打开 MarkdownViewDialog 只读预览/复制。
 * alwaysEnable: true —— 预览不依赖选区（同源码菜单口径，绕开双实例切换的假死禁用）。
 */
import { Boot } from '@wangeditor/editor'
import type { IDomEditor, IButtonMenu } from '@wangeditor/editor'

export const MARKDOWN_VIEW_MENU_KEY = 'sshkMarkdownView'

const callbacks = new WeakMap<IDomEditor, () => void>()

export function bindMarkdownView(editor: IDomEditor, cb: () => void): void {
  callbacks.set(editor, cb)
}

export function unbindMarkdownView(editor: IDomEditor): void {
  callbacks.delete(editor)
}

class MarkdownViewMenu implements IButtonMenu {
  readonly title = 'Markdown 预览'
  readonly iconSvg =
    '<svg viewBox="0 0 640 512"><path d="M593.8 59.1l-547.6 0C20.7 59.1 0 79.8 0 105.2L0 406.7c0 25.5 20.7 46.2 46.2 46.2l547.7 0c25.5 0 46.2-20.7 46.1-46.1l0-301.6c0-25.4-20.7-46.1-46.2-46.1zM338.5 360.6l-61.5 0 0-120-61.5 76.9-61.5-76.9 0 120-61.7 0 0-209.2 61.5 0 61.5 76.9 61.5-76.9 61.5 0 0 209.2 .2 0zm135.3 3.1l-92.3-107.7 61.5 0 0-104.6 61.5 0 0 104.6 61.5 0-92.2 107.7z"></path></svg>'
  readonly tag = 'button' as const
  readonly alwaysEnable = true

  getValue(_editor: IDomEditor): string {
    return ''
  }

  isActive(_editor: IDomEditor): boolean {
    return false
  }

  isDisabled(editor: IDomEditor): boolean {
    return editor.isDestroyed || !callbacks.has(editor)
  }

  exec(editor: IDomEditor, _value?: string | boolean): void {
    callbacks.get(editor)?.()
  }
}

let registered = false

export function registerMarkdownViewMenu(): void {
  if (registered) return
  Boot.registerMenu({
    key: MARKDOWN_VIEW_MENU_KEY,
    factory: () => new MarkdownViewMenu(),
  })
  registered = true
}
