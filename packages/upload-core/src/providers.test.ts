import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { LocalUploadProvider } from './providers/local'
import { CloudUploadProvider } from './providers/cloud'

const dirs: string[] = []
function tempDir(): string {
  const d = mkdtempSync(path.join(tmpdir(), 'sshk-upload-'))
  dirs.push(d)
  return d
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

describe('T3 LocalUploadProvider', () => {
  it('从本地源文件复制到默认目录并返回 file URL', async () => {
    const src = tempDir()
    const out = tempDir()
    writeFileSync(path.join(src, 'a.png'), 'PNG')
    const provider = new LocalUploadProvider({ defaultDir: out })
    const result = await provider.upload(
      { name: 'a.png', size: 3, source: path.join(src, 'a.png') },
      { targetType: 'local' },
    )
    expect(existsSync(path.join(out, 'a.png'))).toBe(true)
    expect(readFileSync(path.join(out, 'a.png'), 'utf8')).toBe('PNG')
    expect(result.url).toContain('a.png')
    expect(result.key).toBe('a.png')
  })

  it('工具级 localDir 覆盖全局默认目录', async () => {
    const def = tempDir()
    const override = tempDir()
    const provider = new LocalUploadProvider({ defaultDir: def })
    await provider.upload(
      { name: 'b.txt', size: 2, data: new TextEncoder().encode('hi') },
      { targetType: 'local', overrides: { localDir: override } },
    )
    expect(existsSync(path.join(override, 'b.txt'))).toBe(true)
    expect(existsSync(path.join(def, 'b.txt'))).toBe(false)
  })

  it('直接内容分支（无 source）也能落盘', async () => {
    const out = tempDir()
    const provider = new LocalUploadProvider({ defaultDir: out })
    await provider.upload({ name: 'c.css', size: 4, data: new TextEncoder().encode('.a{}') }, { targetType: 'local' })
    expect(readFileSync(path.join(out, 'c.css'), 'utf8')).toBe('.a{}')
  })
})

describe('T5 CloudUploadProvider 扩展点', () => {
  it('未实现的云厂商明确报错，不静默走 OSS', async () => {
    const provider = new CloudUploadProvider({
      provider: 'aws-s3',
      region: '',
      bucket: '',
      accessKeyId: '',
      accessKeySecret: '',
    })
    await expect(
      provider.upload({ name: 'a.png', size: 1 }, { targetType: 'cloud' }),
    ).rejects.toThrow('尚未实现')
  })
})
