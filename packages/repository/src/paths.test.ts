import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  edmOutputRel,
  ensureOutputDirs,
  posterOutputRel,
  readOutput,
  resolveSafe,
  toRelPath,
  writeOutput,
} from './paths'

const dirs: string[] = []

function tempRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'sshk-repo-'))
  dirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('resolveSafe', () => {
  it('拒绝绝对路径与盘符', () => {
    const root = tempRoot()
    expect(() => resolveSafe(root, 'C:/evil/x.html')).toThrow()
    expect(() => resolveSafe(root, '/abs/path')).toThrow()
  })

  it('拒绝 .. 穿越', () => {
    const root = tempRoot()
    expect(() => resolveSafe(root, 'outputs/edm/../../evil.html')).toThrow()
    expect(() => resolveSafe(root, '..\\evil.html')).toThrow()
  })

  it('合法相对路径可解析', () => {
    const root = tempRoot()
    expect(resolveSafe(root, 'outputs/edm/mail_1/final.html')).toContain('final.html')
  })
})

describe('writeOutput / readOutput（覆盖式产物）', () => {
  it('自动创建父目录并覆盖写', () => {
    const root = tempRoot()
    const rel = edmOutputRel('mail_01', 'final')
    writeOutput(root, rel, 'v1')
    writeOutput(root, rel, 'v2')
    expect(readOutput(root, rel)).toBe('v2')
    expect(existsSync(join(root, 'outputs/edm/mail_01'))).toBe(true)
  })

  it('二进制内容（海报 png）与相对路径换算一致', () => {
    const root = tempRoot()
    const rel = posterOutputRel('pst_01', 'poster')
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47])
    const back = writeOutput(root, rel, bytes)
    expect(back).toBe(rel)
    expect(toRelPath(root, join(root, rel))).toBe(rel)
  })

  it('ensureOutputDirs 建齐固定布局且幂等', () => {
    const root = tempRoot()
    ensureOutputDirs(root)
    ensureOutputDirs(root)
    expect(existsSync(join(root, 'outputs/edm'))).toBe(true)
    expect(existsSync(join(root, 'assets/uploads'))).toBe(true)
  })
})
