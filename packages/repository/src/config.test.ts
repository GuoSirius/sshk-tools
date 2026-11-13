import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ConfigService, DEFAULT_SETTINGS } from './config'

const dirs: string[] = []

function tempFile(): string {
  const dir = mkdtempSync(join(tmpdir(), 'sshk-cfg-'))
  dirs.push(dir)
  return join(dir, 'settings.json')
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('ConfigService', () => {
  it('无文件时返回默认值', () => {
    const cfg = new ConfigService(tempFile(), DEFAULT_SETTINGS)
    expect(cfg.get('app.themeMode')).toBe('dark')
    // 工具默认值来自各工具包 manifest，宿主 DEFAULT_SETTINGS 不再硬编码任何工具
    expect(cfg.listToolIds()).toEqual([])
  })

  it('set 后原子落盘并重读一致', () => {
    const file = tempFile()
    const cfg = new ConfigService(file, DEFAULT_SETTINGS)
    cfg.set('app.outputDir', 'D:/data/sshk')
    cfg.set('tools.badge-studio.posterWidth', 720)
    const raw = JSON.parse(readFileSync(file, 'utf8')) as Record<string, never>
    expect(raw['app']).toBeTruthy()
    const cfg2 = new ConfigService(file, DEFAULT_SETTINGS)
    expect(cfg2.get('app.outputDir')).toBe('D:/data/sshk')
    expect(cfg2.get('tools.badge-studio.posterWidth')).toBe(720)
  })

  it('非法命名空间与裸命名空间写入被拒', () => {
    const cfg = new ConfigService(tempFile(), DEFAULT_SETTINGS)
    expect(() => cfg.set('secrets.apiKey', 'x')).toThrow()
    expect(() => cfg.set('app', {})).toThrow()
  })

  it('损坏 JSON 回退默认值而非崩溃', () => {
    const file = tempFile()
    writeFileSync(file, '{broken json', 'utf8')
    const cfg = new ConfigService(file, DEFAULT_SETTINGS)
    expect(cfg.get('app.themeMode')).toBe('dark')
  })

  it('onChange 触发并携带命名空间', () => {
    const cfg = new ConfigService(tempFile(), DEFAULT_SETTINGS)
    const seen: string[] = []
    cfg.onChanged((ns, key) => seen.push(`${ns}:${key}`))
    cfg.set('app.themeMode', 'light')
    expect(seen).toEqual(['app:themeMode'])
  })
})
