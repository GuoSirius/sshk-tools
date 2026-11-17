import { describe, expect, it } from 'vitest'
import type { RichTextImageSource } from './types'
import {
  defaultSourceId,
  loadSettings,
  matchImageKeyword,
  normalizeDirInput,
  saveSettings,
  settingsKey,
  sortSourcesByDefault,
  validateDirInput,
} from './image-library-settings'

const sources: RichTextImageSource[] = [
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

const byId = (id: string): RichTextImageSource => sources.find((s) => s.id === id) ?? sources[0]!
describe('image-library-settings', () => {
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

  it('按 stateKey 隔离存取，重启（新 store 对象同底层）可回显', () => {
    const store = memoryStore()
    const a = { sourceId: 'cloud-1', targets: { 'cloud-1': { bucket: 'a-bucket', prefix: 'a/b' } } }
    const b = { sourceId: 'local-1', targets: {} }
    saveSettings(store, 'instance-A', a)
    saveSettings(store, 'instance-B', b)
    expect(loadSettings(store, 'instance-A')).toEqual(a)
    expect(loadSettings(store, 'instance-B')).toEqual(b)
    expect(settingsKey('instance-A')).not.toBe(settingsKey('instance-B'))
  })

  it('损坏数据返回 null，不抛错', () => {
    const store = memoryStore()
    store.setItem(settingsKey('x'), '{bad json')
    expect(loadSettings(store, 'x')).toBeNull()
  })

  it('文件名搜索：忽略大小写，命中 name / key / url 任一，空关键词全通过', () => {
    const img = { url: 'https://cdn/x/IMG_001.png', name: 'Banner.png', key: 'blog/2026/Banner.png' }
    expect(matchImageKeyword(img, '')).toBe(true)
    expect(matchImageKeyword(img, 'banner')).toBe(true)
    expect(matchImageKeyword(img, '2026')).toBe(true)
    expect(matchImageKeyword(img, 'img_001')).toBe(true)
    expect(matchImageKeyword(img, 'nope')).toBe(false)
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
