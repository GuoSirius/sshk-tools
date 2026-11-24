import { describe, expect, it, vi } from 'vitest'
import { bindSaveShortcut, type SaveCommandEditor } from './save-shortcut'

function fakeEditor(): { editor: SaveCommandEditor; addCommand: ReturnType<typeof vi.fn>; createContextKey: ReturnType<typeof vi.fn> } {
  const addCommand = vi.fn()
  const createContextKey = vi.fn()
  return { editor: { addCommand, createContextKey }, addCommand, createContextKey }
}

describe('bindSaveShortcut', () => {
  it('把传入的 keybinding 与保存回调注册到编辑器，并带实例唯一 when 键（多实例防串）', () => {
    const { editor, addCommand, createContextKey } = fakeEditor()
    const onSave = vi.fn()
    bindSaveShortcut(editor, 1234, onSave)
    expect(createContextKey).toHaveBeenCalledWith('saveShortcutOwned_1', true)
    expect(addCommand).toHaveBeenCalledTimes(1)
    expect(addCommand).toHaveBeenCalledWith(1234, onSave, 'saveShortcutOwned_1')
    addCommand.mock.calls[0]?.[1]()
    expect(onSave).toHaveBeenCalledTimes(1)
  })

  it('多个实例的 when 键互不相同（同页多编辑器各存各的保存）', () => {
    const a = fakeEditor()
    const b = fakeEditor()
    const onSave = vi.fn()
    bindSaveShortcut(a.editor, 1234, onSave)
    bindSaveShortcut(b.editor, 1234, onSave)
    expect(a.addCommand.mock.calls[0]?.[2]).not.toBe(b.addCommand.mock.calls[0]?.[2])
  })

  it('编辑器未挂载时不抛错', () => {
    expect(() => bindSaveShortcut(null, 1234, vi.fn())).not.toThrow()
    expect(() => bindSaveShortcut(undefined, 1234, vi.fn())).not.toThrow()
  })
})
