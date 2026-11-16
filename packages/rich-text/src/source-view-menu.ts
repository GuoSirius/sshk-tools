/**
 * wangEditor 自定义菜单：「查看源码」（用户需求 2026-11-16 ③：编辑后想看 HTML 源码）。
 *
 * wangEditor 内置菜单没有源码视图（codeBlock 的「编辑代码」只是代码文字，不是 HTML），
 * 因此自定义按钮：exec 经 WeakMap 回调到组件实例，由组件打开 SourceViewDialog。
 * alwaysEnable: true —— 源码查看不依赖选区（setDisabled 对 alwaysEnable 菜单直接放行），
 * 也顺带绕开双实例切换时「selection 同步竞态导致按钮假死禁用」的问题。
 */
import { Boot } from '@wangeditor/editor'
import type { IDomEditor, IButtonMenu } from '@wangeditor/editor'

export const SOURCE_VIEW_MENU_KEY = 'sshkSourceView'

const callbacks = new WeakMap<IDomEditor, () => void>()

export function bindSourceView(editor: IDomEditor, cb: () => void): void {
  callbacks.set(editor, cb)
}

export function unbindSourceView(editor: IDomEditor): void {
  callbacks.delete(editor)
}

class SourceViewMenu implements IButtonMenu {
  readonly title = '查看源码'
  readonly iconSvg =
    '<svg viewBox="0 0 1024 1024"><path d="M418.3 273.1 194.4 512l223.9 238.9-46.4 49.4L98.6 512l273.3-288.3z m187.4 0 223.9 238.9-223.9 238.9 46.4 49.4L925.4 512 652.1 223.7z"></path></svg>'
  readonly tag = 'button' as const
  /** 不依赖选区：selection 为 null 时也可点击（wangEditor setDisabled 对 alwaysEnable 放行） */
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

export function registerSourceViewMenu(): void {
  if (registered) return
  // IRegisterMenuConf 未被 @wangeditor/editor 转出口，按其结构（key + factory）字面量传入
  Boot.registerMenu({
    key: SOURCE_VIEW_MENU_KEY,
    factory: () => new SourceViewMenu(),
  })
  registered = true
}
