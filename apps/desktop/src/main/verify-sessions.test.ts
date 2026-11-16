import { mkdtempSync, existsSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { VerifySession } from '@sshk/shared'
import { listSessions, loadSession, runAutoCheck, saveSession, type AutoCheckDeps } from './verify-sessions'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'verify-sessions-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

function makeSession(date: string): VerifySession {
  return { date, startedAt: `${date}T10:00:00Z`, updatedAt: `${date}T11:00:00Z`, results: { A1: { state: 'pass', at: `${date}T10:30:00Z` } } }
}

describe('verify 会话存储', () => {
  it('保存后可按日期读回；结构非法拒绝写入', () => {
    const path = saveSession(dir, makeSession('2026-11-16'))
    expect(existsSync(path)).toBe(true)
    const loaded = loadSession(dir, '2026-11-16')
    expect(loaded?.results.A1?.state).toBe('pass')
    expect(() => saveSession(dir, { date: 'x' } as unknown as VerifySession)).toThrow(/非法/)
  })

  it('无 date 参数读最近一份；损坏 JSON 视为不存在', () => {
    saveSession(dir, makeSession('2026-11-14'))
    saveSession(dir, makeSession('2026-11-16'))
    expect(loadSession(dir)?.date).toBe('2026-11-16')
    writeFileSync(join(dir, '2026-11-15.json'), '{broken')
    expect(loadSession(dir, '2026-11-15')).toBeNull()
  })

  it('listSessions 只返回合法日期且升序', () => {
    saveSession(dir, makeSession('2026-11-16'))
    saveSession(dir, makeSession('2026-11-14'))
    writeFileSync(join(dir, 'not-a-session.json'), '{}')
    expect(listSessions(dir)).toEqual(['2026-11-14', '2026-11-16'])
  })
})

describe('自动判定器', () => {
  const deps: AutoCheckDeps = {
    catalog: { upload: { enabled: true, visible: true }, broken: { enabled: true, visible: false } },
    channelCounts: { upload: 12 },
    lastErrors: (toolId) => (toolId === 'upload' ? ['render crashed'] : []),
    packagedResourceRoot: null,
  }

  it('catalogState：启用可见且有通道 → pass；不可见 → fail；目录空 → unknown', () => {
    expect(runAutoCheck('catalogState', 'upload', deps)).toMatchObject({ state: 'pass' })
    expect(runAutoCheck('catalogState', 'broken', deps)).toMatchObject({ state: 'fail' })
    expect(runAutoCheck('catalogState', 'upload', { ...deps, catalog: {} })).toMatchObject({ state: 'unknown' })
    expect(runAutoCheck('catalogState', 'nope', deps)).toMatchObject({ state: 'fail' })
  })

  it('logScan：无 error → pass；有 error → fail', () => {
    expect(runAutoCheck('logScan', 'edm', deps)).toMatchObject({ state: 'pass' })
    const r = runAutoCheck('logScan', 'upload', deps)
    expect(r.state).toBe('fail')
    expect(r.detail).toContain('1 条 error')
  })

  it('fileExists：edm-assets 仅打包版可判；dev → unknown', () => {
    expect(runAutoCheck('fileExists', 'edm-assets', deps)).toMatchObject({ state: 'unknown' })
    const packaged = runAutoCheck('fileExists', 'edm-assets', { ...deps, packagedResourceRoot: '/nowhere/resources' })
    expect(packaged.state).toBe('fail')
    expect(packaged.detail).toContain('edm')
  })

  it('未知类别/规范 → unknown 不抛异常', () => {
    expect(runAutoCheck('hostCapability', 'upload', deps)).toMatchObject({ state: 'unknown' })
    expect(runAutoCheck('fileExists', 'what', deps)).toMatchObject({ state: 'unknown' })
  })
})
