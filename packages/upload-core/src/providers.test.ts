import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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

  it('listDirectories 列出多级真实子目录（含空目录），忽略点开头目录与文件', async () => {
    const out = tempDir()
    mkdirSync(path.join(out, 'demo', 'nested'), { recursive: true })
    mkdirSync(path.join(out, 'empty-dir'), { recursive: true })
    mkdirSync(path.join(out, '.hidden'), { recursive: true })
    writeFileSync(path.join(out, 'a.png'), 'PNG')
    const provider = new LocalUploadProvider({ defaultDir: out })
    const dirs = await provider.listDirectories({ targetType: 'local' })
    expect(dirs).toContain('demo')
    expect(dirs).toContain('demo/nested')
    expect(dirs).toContain('empty-dir')
    expect(dirs).not.toContain('.hidden')
    expect(dirs.every((d) => !d.includes('\\'))).toBe(true)
  })

  it('listDirectories：根目录不存在返回空；localDir 覆盖生效', async () => {
    const provider = new LocalUploadProvider({ defaultDir: path.join(tempDir(), 'no-such') })
    expect(await provider.listDirectories({ targetType: 'local' })).toEqual([])
    const override = tempDir()
    mkdirSync(path.join(override, 'ov'))
    const dirs = await provider.listDirectories({ targetType: 'local', overrides: { localDir: override } })
    expect(dirs).toEqual(['ov'])
  })
})

describe('T5 CloudUploadProvider 多厂商 / 连通性自检', () => {
  const base = {
    region: 'ap-guangzhou',
    bucket: 'demo',
    accessKeyId: 'ak',
    accessKeySecret: 'sk',
  }

  it('SDK 未安装时给出明确安装提示，不静默失败', async () => {
    const provider = new CloudUploadProvider({ ...base, provider: 'tencent-cos', sdk: 'not-installed-sdk-xyz' })
    await expect(
      provider.upload({ name: 'a.png', size: 1, data: new Uint8Array([1]) }, { targetType: 'cloud' }),
    ).rejects.toThrow('云 SDK 未就绪')
  })

  it('连接测试同样复用按需加载与友好报错', async () => {
    const provider = new CloudUploadProvider({ ...base, provider: 'aws-s3', sdk: 'not-installed-sdk-xyz' })
    await expect(provider.testConnection()).rejects.toThrow('云 SDK 未就绪')
  })

  it('未配置密钥 / Bucket 时先做本地校验，不去连网络', async () => {
    const provider = new CloudUploadProvider({ provider: 'aws-s3', region: '', bucket: '', accessKeyId: '', accessKeySecret: '' })
    await expect(provider.testConnection()).rejects.toThrow('Bucket')
  })
})
