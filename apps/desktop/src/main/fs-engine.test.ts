import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FsDriver } from '@sshk/upload-core'
import type { FsChannelInfo, FsListPage, FsSearchResult, FsStatResult, FsUsageResult } from '@sshk/shared'
import { FsTransferEngine } from './fs'

/**
 * P1-1（A1/Q-01）：FsTransferEngine 状态机单测——conflict / pause / cancel 矩阵。
 * 生产入口是 FsRuntime（fs.ts:1053），引擎 export 仅为注入 mock driver 做最小矩阵验证；
 * 周期性 progress = 周期性采样检查点，暂停/取消在下一个检查点必落定（无竞态）。
 */

function makeFakeDriver(opts: {
  remoteExists?: boolean
  onWrite?: (path: string, onProgress?: (bytes: number) => void) => Promise<void>
}): FsDriver {
  const stat: FsStatResult = { exists: opts.remoteExists === true, isDir: false, size: 3 }
  return {
    writable: true,
    list: (): Promise<FsListPage> => Promise.resolve({ path: '/', entries: [], cursor: null }),
    stat: (): Promise<FsStatResult> => Promise.resolve(stat),
    mkdir: (): Promise<void> => Promise.resolve(),
    rmFile: (): Promise<void> => Promise.resolve(),
    rmDir: (): Promise<number> => Promise.resolve(0),
    cp: (): Promise<void> => Promise.resolve(),
    mv: (): Promise<void> => Promise.resolve(),
    readBuffer: (): Promise<{ data: Buffer; size: number }> => Promise.resolve({ data: Buffer.from('abc'), size: 3 }),
    write: (path, _body, onProgress): Promise<void> =>
      opts.onWrite ? opts.onWrite(path, onProgress) : Promise.resolve(),
    download: (_p, destFile, onProgress): Promise<void> => {
      writeFileSync(destFile, 'abc')
      onProgress?.(3)
      return Promise.resolve()
    },
    search: (): Promise<FsSearchResult> => Promise.resolve({ entries: [], truncated: false, scanned: 0 }),
    usage: (): Promise<FsUsageResult> => Promise.resolve({ files: 0, size: 0, totalBytes: 0, truncated: false }),
    ensureCanDelete: (): Promise<void> => Promise.resolve(),
  }
}

const resolved = {
  driver: undefined as unknown as FsDriver,
  channel: { id: 'p1', name: '测试通道', type: 'cloud', detail: '测试', root: '', hasSecret: true, writable: true } as FsChannelInfo & Record<string, unknown> as never,
}

function makeEngine(storeDir: string): FsTransferEngine {
  // getDriver 动态读 resolved.driver：单测在 beforeEach 建引擎、测试内再设驱动
  return new FsTransferEngine({
    getDriver: () => ({ driver: resolved.driver, channel: resolved.channel }),
    concurrencyOf: () => 3,
    multipartSettings: () => ({ enabled: false, thresholdMb: 50, partSizeMb: 8, partsConcurrency: 3, requestTimeoutSec: 60 } as never),
    onEvent: () => { /* 单测不消费推送 */ },
    storeDir,
  })
}

/**
 * 周期性 progress 驱动：每 25ms 一个采样检查点。
 * 关键：检查点抛出的 __fs_paused__/__fs_canceled__ 信号必须沿 write Promise 传播回引擎
 * （真实驱动里异常沿流管道中止写入），否则引擎会永远 await write。
 */
function startProgress(
  onProgress: ((bytes: number) => void) | undefined,
  rejectWrite: (err: unknown) => void,
  onAbort?: () => void,
): () => void {
  const timer = setInterval(() => {
    try {
      onProgress?.(1)
    } catch (err) {
      clearInterval(timer)
      onAbort?.()
      rejectWrite(err)
    }
  }, 25)
  return () => clearInterval(timer)
}

describe('FsTransferEngine 状态机（P1-1 · conflict/pause/cancel 矩阵）', () => {
  let dir = ''
  let engine: FsTransferEngine
  const stoppers: (() => void)[] = []

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'fsx-test-'))
    engine = makeEngine(dir)
  })
  afterEach(() => {
    for (const stop of stoppers) stop()
    rmSync(dir, { recursive: true, force: true })
  })

  function st(id: string): string {
    return engine.all().find((t) => t.id === id)?.status ?? ''
  }

  it('conflict：远端同名文件挂起为 conflict，不被成功路径覆盖（P1-1 根因回归）', async () => {
    resolved.driver = makeFakeDriver({ remoteExists: true })
    const local = join(dir, 'local.txt')
    writeFileSync(local, 'abc')
    const id = engine.add([{ kind: 'upload', profileId: 'p1', name: 'local.txt', remotePath: '/remote.txt', localPath: local }], () => resolved)[0]!
    // execute 是 fire-and-forget：轮询直到状态落定
    await vi_wait(() => ['conflict', 'success', 'failed', 'canceled'].includes(st(id)))
    expect(st(id)).toBe('conflict')
    // 覆盖重试 → 成功
    engine.retry([id], true)
    await vi_wait(() => st(id) === 'success')
    expect(st(id)).toBe('success')
  })

  it('cancel：运行中 stop → 下一个采样检查点落 canceled', async () => {
    resolved.driver = makeFakeDriver({
      onWrite: (_p, onProgress) => new Promise<void>((_resolveP, rejectP) => {
        stoppers.push(startProgress(onProgress, rejectP))
      }),
    })
    const local = join(dir, 'slow.txt')
    writeFileSync(local, 'abc')
    const id = engine.add([{ kind: 'upload', profileId: 'p1', name: 'slow.txt', remotePath: '/slow.txt', localPath: local }], () => resolved)[0]!
    await vi_wait(() => st(id) === 'running')
    engine.stop([id])
    await vi_wait(() => st(id) === 'canceled')
    expect(st(id)).toBe('canceled')
  })

  it('pause → resume：协作检查点暂停后可继续完成', async () => {
    let round = 0
    resolved.driver = makeFakeDriver({
      onWrite: (_p, onProgress) => new Promise<void>((resolveP, rejectP) => {
        round += 1
        if (round === 1) {
          // 第一轮：检查点异常 → 引擎落 paused；write Promise 随之 reject（孤儿化无害）
          stoppers.push(startProgress(onProgress, rejectP))
        } else {
          // 第二轮（resume 后）：150ms 后自然完成 → success
          const timer = setInterval(() => { try { onProgress?.(1) } catch { clearInterval(timer) } }, 25)
          stoppers.push(() => clearInterval(timer))
          setTimeout(() => resolveP(), 150)
        }
      }),
    })
    const local = join(dir, 'p.txt')
    writeFileSync(local, 'abc')
    const id = engine.add([{ kind: 'upload', profileId: 'p1', name: 'p.txt', remotePath: '/p.txt', localPath: local }], () => resolved)[0]!
    await vi_wait(() => st(id) === 'running')
    engine.pause([id])
    await vi_wait(() => st(id) === 'paused')
    engine.resume([id])
    await vi_wait(() => st(id) === 'success', 4000)
    expect(st(id)).toBe('success')
  })

  it('无冲突上传直接成功（对照组）', async () => {
    resolved.driver = makeFakeDriver({ remoteExists: false })
    const local = join(dir, 'ok.txt')
    writeFileSync(local, 'abc')
    const id = engine.add([{ kind: 'upload', profileId: 'p1', name: 'ok.txt', remotePath: '/ok.txt', localPath: local }], () => resolved)[0]!
    await vi_wait(() => st(id) === 'success')
    expect(st(id)).toBe('success')
  })

  it('下载任务落盘成功且内容正确', async () => {
    resolved.driver = makeFakeDriver({ remoteExists: true })
    const dest = join(dir, 'dl.txt')
    const id = engine.add([{ kind: 'download', profileId: 'p1', name: 'dl.txt', remotePath: '/src.txt', destPath: dest }], () => resolved)[0]!
    await vi_wait(() => ['success', 'failed'].includes(st(id)), 3000)
    expect(st(id)).toBe('success')
    expect(existsSync(dest)).toBe(true)
    expect(readFileSync(dest, 'utf8')).toBe('abc')
  })
})

/** 轮询等待异步状态机落定（引擎 execute 为 fire-and-forget，无完成回调可 await） */
function vi_wait(cond: () => boolean, timeoutMs = 2000): Promise<void> {
  return new Promise((resolveP, rejectP) => {
    const started = Date.now()
    const tick = (): void => {
      try {
        if (cond()) return resolveP()
      } catch (err) { return rejectP(err) }
      if (Date.now() - started > timeoutMs) return rejectP(new Error('状态机等待超时'))
      setTimeout(tick, 15)
    }
    tick()
  })
}
