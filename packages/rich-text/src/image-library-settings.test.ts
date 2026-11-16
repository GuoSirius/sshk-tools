import { describe, expect, it } from 'vitest'
import type { RichTextImageSource } from './types'
import {
  defaultSourceId,
  directoriesFromKeys,
  loadSettings,
  saveSettings,
  settingsKey,
  sortSourcesByDefault,
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

  it('目录从图片 key 派生多级完整前缀，末段文件名不算目录', () => {
    expect(directoriesFromKeys(['blog/2026/06/a.png', 'blog/2026/b.jpg', 'root.png', '\\win\\deep\\c.png']))
      .toEqual(['blog', 'blog/2026', 'blog/2026/06', 'win', 'win/deep'])
  })
})
