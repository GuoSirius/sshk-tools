import { describe, expect, it } from 'vitest'
import type { RichTextImageSource } from './types'
import {
  buildDirectoryTree,
  defaultSourceId,
  directoriesFromKeys,
  directoryTree,
  expandDirPath,
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

  it('目录从图片 key 派生多级完整前缀，末段文件名不算目录', () => {
    expect(directoriesFromKeys(['blog/2026/06/a.png', 'blog/2026/b.jpg', 'root.png', '\\win\\deep\\c.png']))
      .toEqual(['blog', 'blog/2026', 'blog/2026/06', 'win', 'win/deep'])
  })

  it('目录树：每层 value 为完整路径，叶子无空 children，可逐级展开', () => {
    const tree = directoryTree(['blog/2026/06/a.png', 'blog/2025/x.jpg', 'root.png'])
    expect(tree).toHaveLength(1)
    const blog = tree[0]!
    expect(blog).toMatchObject({ value: 'blog', label: 'blog' })
    expect(blog.children?.map((n) => n.value)).toEqual(['blog/2025', 'blog/2026'])
    const y2026 = blog.children?.find((n) => n.value === 'blog/2026')!
    expect(y2026.children?.map((n) => n.value)).toEqual(['blog/2026/06'])
    expect(y2026.children?.[0]).not.toHaveProperty('children') // 叶子不挂空 children
    expect(blog.children?.find((n) => n.value === 'blog/2025')).not.toHaveProperty('children')
  })

  it('目录树：仅根图无目录时返回空树；反斜杠路径按目录段处理', () => {
    expect(directoryTree(['root.png'])).toEqual([])
    expect(directoryTree(['\\win\\a.png'])).toEqual([{ value: 'win', label: 'win' }])
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

describe('buildDirectoryTree / expandDirPath', () => {
  it('真实目录路径直接成树（末段不再被当成文件名丢弃）', () => {
    expect(buildDirectoryTree(['blog/2026/06', 'blog/2025'])).toEqual([
      { value: 'blog', label: 'blog', children: [
        { value: 'blog/2025', label: '2025' },
        { value: 'blog/2026', label: '2026', children: [{ value: 'blog/2026/06', label: '06' }] },
      ] },
    ])
  })
  it('空目录也能进树（无法从图片反推时的核心能力）', () => {
    expect(buildDirectoryTree(['Down_tmp', 'PDF']).map((n) => n.value)).toEqual(['Down_tmp', 'PDF'])
  })
  it('展开目录为自身+各级父路径', () => {
    expect(expandDirPath('a/b/c')).toEqual(['a', 'a/b', 'a/b/c'])
    expect(expandDirPath('/a/b/c/')).toEqual(['a', 'a/b', 'a/b/c'])
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
