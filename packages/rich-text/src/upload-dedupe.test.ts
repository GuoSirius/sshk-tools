import { webcrypto } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { contentName, fingerprintKey, hashFile } from './upload-dedupe'

const subtle = webcrypto.subtle as unknown as SubtleCrypto
const blob = (s: string): Blob => new Blob([s])

describe('fingerprintKey', () => {
  const base = { scope: 'cloud-1|bucket-a|img/', name: 'a.png', size: 123, hash: 'abc123' }

  it('相同维度得到相同 key', () => {
    expect(fingerprintKey(base)).toBe(fingerprintKey({ ...base }))
  })

  it('hash 相同但文件名不同，视为不同文件（同内容复制多份改名，都允许上传）', () => {
    expect(fingerprintKey(base)).not.toBe(fingerprintKey({ ...base, name: 'renamed.png' }))
  })

  it('源文件名带后缀不同即视为不同（a.png / a.jpg 不去重）', () => {
    expect(fingerprintKey(base)).not.toBe(fingerprintKey({ ...base, name: 'a.jpg' }))
  })

  it('目标位置不同则 key 不同（同名同内容传到不同目录允许各传一份）', () => {
    expect(fingerprintKey(base)).not.toBe(fingerprintKey({ ...base, scope: 'cloud-1|bucket-a|other/' }))
    expect(fingerprintKey(base)).not.toBe(fingerprintKey({ ...base, scope: 'cloud-2|bucket-a|img/' }))
  })

  it('hash 不同则 key 不同（内容不同）', () => {
    expect(fingerprintKey(base)).not.toBe(fingerprintKey({ ...base, hash: 'xyz999' }))
  })

  it('无 hash 时降级为文件名+大小+位置', () => {
    const noHash = { ...base, hash: '' }
    expect(fingerprintKey(noHash)).toBe(fingerprintKey({ ...noHash }))
    expect(fingerprintKey(noHash)).not.toBe(fingerprintKey({ ...noHash, name: 'b.png' }))
    expect(fingerprintKey(noHash)).not.toBe(fingerprintKey({ ...noHash, size: 456 }))
    // 降级路径下 hash 不参与（两张不同 hash 但无可用的 hash 时仍靠 name+size）
    expect(fingerprintKey(noHash)).toBe(fingerprintKey({ ...noHash, hash: '' }))
  })

  it('有 hash 与无 hash 的路径不会碰撞', () => {
    expect(fingerprintKey(base)).not.toBe(fingerprintKey({ ...base, hash: '' }))
  })

  it('降级路径下文件名含分隔符/竖线也不碰撞', () => {
    const noHash = { ...base, hash: '' }
    const a = fingerprintKey({ ...noHash, name: 'x|y.png' })
    const b = fingerprintKey({ ...noHash, name: 'x' })
    const c = fingerprintKey({ ...noHash, name: 'y.png' })
    expect(a).not.toBe(b)
    expect(a).not.toBe(c)
  })
})

describe('contentName', () => {
  const hash = 'a1b2c3d4e5f60718293a4b5c6d7e8f90'

  it('普通文件名：原名-hash前8位.后缀', () => {
    expect(contentName('banner.png', hash)).toBe('banner-a1b2c3d4.png')
  })

  it('多级路径只改最后一段文件名', () => {
    expect(contentName('img/2024/banner.png', hash)).toBe('img/2024/banner-a1b2c3d4.png')
  })

  it('同名不同内容得到不同存储名（并存不覆盖）', () => {
    const other = 'ffeeddccbbaa99887766554433221100'
    const a = contentName('banner.png', hash)
    const b = contentName('banner.png', other)
    expect(a).not.toBe(b)
  })

  it('同名同内容得到相同存储名（幂等）', () => {
    expect(contentName('banner.png', hash)).toBe(contentName('banner.png', hash))
  })

  it('无后缀、多点文件名正常处理', () => {
    expect(contentName('README', hash)).toBe('README-a1b2c3d4')
    expect(contentName('photo.v2.final.png', hash)).toBe('photo.v2.final-a1b2c3d4.png')
  })

  it('点开头文件保持原名，不破坏工具识别（.gitignore/.env/.env.local）', () => {
    expect(contentName('.gitignore', hash)).toBe('.gitignore')
    expect(contentName('.env', hash)).toBe('.env')
    expect(contentName('.env.local', hash)).toBe('.env.local')
    // 带图片后缀的点文件也保持原名（避免 .gitignore.png 这类被改名后识别失效）
    expect(contentName('.hidden.png', hash)).toBe('.hidden.png')
  })

  it('hash 不可用时退回原名', () => {
    expect(contentName('banner.png', '')).toBe('banner.png')
  })
})

describe('hashFile', () => {
  it('相同内容得到相同 SHA-256', async () => {
    const h1 = await hashFile(blob('same-content'), subtle)
    const h2 = await hashFile(blob('same-content'), subtle)
    expect(h1).toBe(h2)
    expect(h1).toMatch(/^[0-9a-f]{64}$/)
  })

  it('不同内容 hash 不同', async () => {
    const h1 = await hashFile(blob('content-a'), subtle)
    const h2 = await hashFile(blob('content-b'), subtle)
    expect(h1).not.toBe(h2)
  })

  it('Web Crypto 不可用时降级返回空串，不抛错', async () => {
    await expect(hashFile(blob('x'), null)).resolves.toBe('')
  })
})
