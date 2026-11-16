/**
 * wangEditor 自定义菜单：「图片库」（打开工具侧注入的图片库弹窗）。
 *
 * 为什么不用 group-image 里加 key：用户要求工具栏保持 wangEditor 原始默认分组顺序，
 * 只用 insertKeys 把本菜单插到默认 group-image 之前，其余不动。
 *
 * Boot.registerMenu 是全局注册（每编辑器一次注册即可）；菜单实例按编辑器独立创建，
 * exec 时经 WeakMap 回调到对应组件实例 —— 双富文本同屏时各开各的弹窗，互不串扰。
 */
import { Boot } from '@wangeditor/editor'
import type { IDomEditor, IButtonMenu } from '@wangeditor/editor'

export const IMAGE_LIBRARY_MENU_KEY = 'sshkImageLibrary'

/** 默认工具栏数组里 group-image 的下标（wangEditor 5.1.23 genDefaultToolbarKeys 核实）；insertKeys 用 */
export const DEFAULT_GROUP_IMAGE_INDEX = 22

const callbacks = new WeakMap<IDomEditor, () => void>()

export function bindImageLibrary(editor: IDomEditor, cb: () => void): void {
  callbacks.set(editor, cb)
}

export function unbindImageLibrary(editor: IDomEditor): void {
  callbacks.delete(editor)
}

class ImageLibraryMenu implements IButtonMenu {
  readonly title = '图片库'
  readonly tag = 'button' as const
  readonly iconSvg =
    '<svg viewBox="0 0 1024 1024"><path d="M864 128H160a64 64 0 0 0-64 64v640a64 64 0 0 0 64 64h704a64 64 0 0 0 64-64V192a64 64 0 0 0-64-64zM352 320a64 64 0 1 1-64 64 64 64 0 0 1 64-64z m448 512H224l160-208 96 128 112-144z"></path></svg>'

  getValue(_editor: IDomEditor): string {
    return ''
  }

  isActive(_editor: IDomEditor): boolean {
    return false
  }

  isDisabled(editor: IDomEditor): boolean {
    return !callbacks.has(editor)
  }

  exec(editor: IDomEditor, _value?: string | boolean): void {
    callbacks.get(editor)?.()
  }
}

let registered = false

export function registerImageLibraryMenu(): void {
  if (registered) return
  // IRegisterMenuConf 未被 @wangeditor/editor 转出口，按其结构（key + factory）字面量传入
  Boot.registerMenu({
    key: IMAGE_LIBRARY_MENU_KEY,
    factory: () => new ImageLibraryMenu(),
  })
  registered = true
}
