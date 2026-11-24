/**
 * 示例数据覆盖层测试（2026-11-24 #189）：受控临时目录验证 读写/存在判定/恢复默认/越权拒绝。
 * 覆盖层是「只读系统内容的设计只读」缺口的安全阀：只允许 sample.yaml，越权路径一律空手而归。
 */
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { hasSampleOverride, isSampleFile, readSampleOverride, readSampleOverrideYaml, resetSampleOverride, writeSampleOverride } from './sample-overlay'

const dirs: string[] = []

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), `sshk-edm-ov-${prefix}-`))
  dirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('isSampleFile 白名单', () => {
  it('sample.yaml / 深层 sample.yaml 为真，其余文件为假', () => {
    expect(isSampleFile('sample.yaml')).toBe(true)
    expect(isSampleFile('elab/fragment/banner/v1/sample.yaml')).toBe(true)
    expect(isSampleFile('elab\\fragment\\sample.yaml')).toBe(true) // 反斜杠入参归一
    expect(isSampleFile('elab/meta.yaml')).toBe(false)
    expect(isSampleFile('elab/fragment/banner/v1/banner.njk')).toBe(false)
    expect(isSampleFile('elab/css/sample.yaml.bak')).toBe(false)
    expect(isSampleFile('')).toBe(false)
  })
})

describe('覆盖层 读写/恢复 闭环', () => {
  it('写入后读取一致，hasSampleOverride=true；reset 后 false 且空目录被清理', async () => {
    const root = tempDir('rw')
    const file = 'elab/fragment/banner/v1/sample.yaml'
    expect(await hasSampleOverride(root, file)).toBe(false)
    expect(await readSampleOverride(root, file)).toBeNull()

    await writeSampleOverride(root, file, 'title: 改过')
    expect(await readSampleOverride(root, file)).toBe('title: 改过')
    expect(await hasSampleOverride(root, file)).toBe(true)
    expect(await readSampleOverrideYaml(root, file)).toEqual({ title: '改过' })

    expect(await resetSampleOverride(root, file)).toBe(true)
    expect(await hasSampleOverride(root, file)).toBe(false)
    // 沿途空目录自底向上清理，覆盖根本身保留
    expect(existsSync(join(root, 'elab'))).toBe(false)
    expect(existsSync(root)).toBe(true)
  })

  it('reset 沿途非空目录即停（其他覆盖不受影响）', async () => {
    const root = tempDir('prune')
    await writeSampleOverride(root, 'a/b/sample.yaml', 'x: 1')
    await writeSampleOverride(root, 'a/c/sample.yaml', 'x: 2')
    expect(await resetSampleOverride(root, 'a/b/sample.yaml')).toBe(true)
    expect(await readSampleOverride(root, 'a/c/sample.yaml')).toBe('x: 2')
    expect(await readSampleOverride(root, 'a/b/sample.yaml')).toBeNull()
  })

  it('readSampleOverrideYaml：非法 YAML / 空文档返回 null（渲染回落系统根）', async () => {
    const root = tempDir('bad')
    await writeSampleOverride(root, 'a/sample.yaml', 'x: [1, oops')
    expect(await readSampleOverrideYaml(root, 'a/sample.yaml')).toBeNull()
    await writeSampleOverride(root, 'a/sample.yaml', '')
    expect(await readSampleOverrideYaml(root, 'a/sample.yaml')).toBeNull()
  })

  it('非 sample.yaml / 越权路径拒绝：读 null、写抛错、has/reset false', async () => {
    const root = tempDir('guard')
    await expect(writeSampleOverride(root, 'a/meta.yaml', 'code: a')).rejects.toThrow('sample.yaml')
    await expect(writeSampleOverride(root, '../escape/sample.yaml', 'x: 1')).rejects.toThrow()
    expect(await readSampleOverride(root, 'a/meta.yaml')).toBeNull()
    expect(await hasSampleOverride(root, '../escape/sample.yaml')).toBe(false)
    expect(await resetSampleOverride(root, '../escape/sample.yaml')).toBe(false)
  })
})
