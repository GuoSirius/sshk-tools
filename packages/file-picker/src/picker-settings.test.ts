import { describe, expect, it } from 'vitest'
import type { FilePickerSource } from './types'
import {
  defaultSourceId,
  displayDirPath,
  loadSettings,
  matchFileKeyword,
  normalizeDirInput,
  resolveLastUploadTarget,
  saveSettings,
  settingsKey,
  sortSourcesByDefault,
  validateDirInput,
} from './picker-settings'

const sources: FilePickerSource[] = [
  { id: 'local-1', type: 'local', label: '本地' },
  { id: 'remote-1', type: 'remote', label: '远程' },
  { id: 'cloud-1', type: 'cloud', label: '云' },
  { id: 'cloud-2', type: 'cloud', label: '云2' },
]

function memoryStore(): Storage {
  const map = new Map<string, string>()
  return {
    get length() { return map.size },
    clear: () => map.clear(),
    getItem: (k: string) => map.get(k) ?? null,
    key: (i: number) => [...map.keys()][i] ?? null,
    removeItem: (k: string) => { map.delete(k) },
    setItem: (k: string, v: string) => { map.set(k, v) },
  }
}

const byId = (id: string): FilePickerSource => sources.find((s) => s.id === id) ?? sources[0]!
describe('picker-settings', () => {
  it('默认来源优先级：云 → 远程 → 本地', () => {
    expect(sortSourcesByDefault(sources).map((s) => s.id)).toEqual(['cloud-1', 'cloud-2', 'remote-1', 'local-1'])
    expect(defaultSourceId(sources)).toBe('cloud-1')
    expect(defaultSourceId([byId('local-1'), byId('remote-1')])).toBe('remote-1')
    expect(defaultSourceId([byId('local-1')])).toBe('local-1')
  })

  it('来源已删除时回落到优先级最高的可用来源', () => {
    expect(defaultSourceId(sources, 'deleted-profile')).toBe('cloud-1')
    expect(defaultSourceId(sources, 'remote-1')).toBe('remote-1')
  })

  it('全局统一存取（D58）：stateKey 形参已废弃被忽略，任何键名读写同一份', () => {
    const store = memoryStore()
    const a = { sourceId: 'cloud-1', targets: { 'cloud-1': { bucket: 'a-bucket', prefix: 'a/b' } } }
    saveSettings(store, 'instance-A', a)
    // 换一个「键名」读（形参被忽略）：回显同一份全局位置
    expect(loadSettings(store, 'instance-B')).toEqual(a)
    expect(loadSettings(store)).toEqual(a)
    expect(settingsKey('anything')).toBe('sshk:file-picker:global')
  })

  it('resolveLastUploadTarget：读上次 source+target；无记录/来源失效回落默认源，空来源返回 null', async () => {
    const store = memoryStore()
    const library = { sources: async () => sources } as any
    // 无保存记录 → 回落最高优先级云源，target 为空
    const fallback = await resolveLastUploadTarget(library, store)
    expect(fallback).toEqual({ source: byId('cloud-1'), target: {} })
    // 有保存记录 → 还原选中的源与其专属 target
    saveSettings(store, undefined, { sourceId: 'remote-1', targets: { 'remote-1': { remotePath: 'edm/mail' } } })
    expect(await resolveLastUploadTarget(library, store)).toEqual({
      source: byId('remote-1'), target: { remotePath: 'edm/mail' },
    })
    // 保存的源已被删除 → 回落默认源
    saveSettings(store, undefined, { sourceId: 'deleted', targets: {} })
    expect((await resolveLastUploadTarget(library, store))?.source.id).toBe('cloud-1')
    // 无任何来源 → null
    expect(await resolveLastUploadTarget({ sources: async () => [] } as any, store)).toBeNull()
  })

  it('损坏数据返回 null，不抛错', () => {
    const store = memoryStore()
    store.setItem('sshk:file-picker:global', '{bad json')
    expect(loadSettings(store)).toBeNull()
  })

  it('旧分桶键自动迁移（D58）：按优先序命中，命中后整链清理，含动态键', () => {
    const store = memoryStore()
    const preferred = { sourceId: 'remote-1', targets: { 'remote-1': { remotePath: 'edm' } }, tab: 'gallery' as const }
    const dyn = { sourceId: 'local-1', targets: {}, tab: 'upload' as const }
    // 动态键（edm:<字段> / 记录 id）不在优先表内；edm::image-field 优先级最高
    store.setItem('sshk:file-picker:edm:brief', JSON.stringify(dyn))
    store.setItem('sshk:file-picker:edm::image-field', JSON.stringify(preferred))
    store.setItem('sshk:rich-text:image-library:default', JSON.stringify(dyn))
    expect(loadSettings(store)).toEqual(preferred)
    // 整链清理：旧键全部摘除，只有全局键落盘
    expect(store.getItem('sshk:file-picker:edm:brief')).toBeNull()
    expect(store.getItem('sshk:file-picker:edm::image-field')).toBeNull()
    expect(store.getItem('sshk:rich-text:image-library:default')).toBeNull()
  })

  it('旧键迁移：无优先命中时取扫到的第一个；首次保存自然落全局键', () => {
    const store = memoryStore()
    const legacy = { sourceId: 'local-1', targets: {}, tab: 'upload' as const }
    store.setItem('sshk:rich-text:image-library:inst', JSON.stringify(legacy))
    expect(loadSettings(store)).toEqual(legacy)
    const fresh = { sourceId: 'cloud-1', targets: {}, tab: 'gallery' as const }
    saveSettings(store, undefined, fresh)
    expect(loadSettings(store)).toEqual(fresh)
  })

  it('文件名搜索：忽略大小写，命中 name / key / url 任一，空关键词全通过', () => {
    const file = { url: 'https://cdn/x/IMG_001.png', name: 'Banner.png', key: 'blog/2026/Banner.png' }
    expect(matchFileKeyword(file, '')).toBe(true)
    expect(matchFileKeyword(file, 'banner')).toBe(true)
    expect(matchFileKeyword(file, '2026')).toBe(true)
    expect(matchFileKeyword(file, 'img_001')).toBe(true)
    expect(matchFileKeyword(file, 'nope')).toBe(false)
  })
})

describe('normalizeDirInput', () => {
  it('首尾斜杠/重复斜杠/反斜杠统一为规范路径', () => {
    expect(normalizeDirInput('/a/b/c')).toBe('a/b/c')
    expect(normalizeDirInput('a/b/c/')).toBe('a/b/c')
    expect(normalizeDirInput('//a//b//c//')).toBe('a/b/c')
    expect(normalizeDirInput('a\\b\\c')).toBe('a/b/c')
  })
  it('三种写法归一后完全一致（作用域不再因写法不同而分裂）', () => {
    expect(normalizeDirInput('/a/b/c')).toBe(normalizeDirInput('a/b/c'))
    expect(normalizeDirInput('a/b/c')).toBe(normalizeDirInput('a/b/c/'))
  })
  it('空串与全斜杠归一为空', () => {
    expect(normalizeDirInput('')).toBe('')
    expect(normalizeDirInput('/')).toBe('')
  })
})

describe('displayDirPath', () => {
  it('云/远程桶根相对路径补前导 /，与级联回显一致', () => {
    expect(displayDirPath('bt_backup', 'cloud')).toBe('/bt_backup')
    expect(displayDirPath('a/b/c', 'cloud')).toBe('/a/b/c')
    expect(displayDirPath('home/user', 'remote')).toBe('/home/user')
  })
  it('已带 / 的值不重复补', () => {
    expect(displayDirPath('/bt_backup', 'cloud')).toBe('/bt_backup')
    expect(displayDirPath('/a/b', 'remote')).toBe('/a/b')
  })
  it('本地路径与空值原样返回', () => {
    expect(displayDirPath('D:\\a\\b', 'local')).toBe('D:\\a\\b')
    expect(displayDirPath('', 'cloud')).toBe('')
    expect(displayDirPath('', 'local')).toBe('')
  })
})

describe('validateDirInput', () => {
  it('空串合法', () => {
    expect(validateDirInput('', 'cloud').level).toBe('ok')
    expect(validateDirInput('   ', 'remote').level).toBe('ok')
  })
  it('控制字符在任何来源都报错', () => {
    expect(validateDirInput('a\nb', 'cloud').level).toBe('error')
    expect(validateDirInput('a\u0000b', 'local').level).toBe('error')
  })
  it('对象路径的 . / .. 段报错', () => {
    expect(validateDirInput('a/../b', 'cloud').level).toBe('error')
    expect(validateDirInput('./a', 'remote').level).toBe('error')
    expect(validateDirInput('a/./b', 'cloud').level).toBe('error')
  })
  it('反斜杠与首尾/重复斜杠给归一化提示（warn 不阻断）', () => {
    expect(validateDirInput('a\\b', 'cloud').level).toBe('warn')
    expect(validateDirInput('/a/b/', 'cloud').level).toBe('warn')
    expect(validateDirInput('a//b', 'cloud').level).toBe('warn')
  })
  it('URL 敏感字符 ? # 给提示', () => {
    expect(validateDirInput('a?b', 'cloud').level).toBe('warn')
    expect(validateDirInput('a#b', 'cloud').level).toBe('warn')
  })
  it('本地路径：保留字符报错，盘符冒号放行', () => {
    expect(validateDirInput('D:\\a\\b', 'local').level).toBe('ok')
    expect(validateDirInput('/home/a/b', 'local').level).toBe('ok')
    expect(validateDirInput('a|b', 'local').level).toBe('error')
    expect(validateDirInput('a*b', 'local').level).toBe('error')
  })
  it('合法对象路径通过', () => {
    expect(validateDirInput('a/b/c', 'cloud')).toEqual({ level: 'ok', message: '' })
  })
})
