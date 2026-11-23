import { describe, expect, it, vi } from 'vitest'
import { bindSaveShortcut, type SaveCommandEditor } from './save-shortcut'

describe('bindSaveShortcut', () => {
  it('把传入的 keybinding 与保存回调注册到编辑器', () => {
    const addCommand = vi.fn()
    const editor: SaveCommandEditor = { addCommand }
    const onSave = vi.fn()
    bindSaveShortcut(editor, 1234, onSave)
    expect(addCommand).toHaveBeenCalledTimes(1)
    expect(addCommand).toHaveBeenCalledWith(1234, onSave)
    addCommand.mock.calls[0]?.[1]()
    expect(onSave).toHaveBeenCalledTimes(1)
  })

  it('编辑器未挂载时不抛错', () => {
    expect(() => bindSaveShortcut(null, 1234, vi.fn())).not.toThrow()
    expect(() => bindSaveShortcut(undefined, 1234, vi.fn())).not.toThrow()
  })
})
