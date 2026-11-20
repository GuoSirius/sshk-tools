import { describe, expect, it } from 'vitest'
import { fsMissingChunks, fsMultipartPlan, fsTransferCanPersist, fsTransferEffectivelyDone, readFsTransferSettings } from './fs'

/** plans/10：分片计划 / 下载缺片 / 持久化判定（纯函数单测） */

const MB = 1024 * 1024

describe('fsMultipartPlan（上传分片计划）', () => {
  it('小文件单片即整文件', () => {
    const p = fsMultipartPlan(100, 5)
    expect(p.partsTotal).toBe(1)
    expect(p.partSize).toBe(5 * MB)
    expect(p.partSizeAdjusted).toBe(false)
  })

  it('常规大文件按 partSizeMb 切片，尾片补齐', () => {
    const size = 52 * MB // 默认阈值 50MB 以上，5MB 片 → 11 片（尾片 2MB）
    const p = fsMultipartPlan(size, 5)
    expect(p.partsTotal).toBe(11)
    expect(p.partSizeAdjusted).toBe(false)
  })

  it('超过 10000 片上限自动上调单片大小并仍能覆盖全文件', () => {
    // 20GB / 5MB = 4096 片 < 10000，不触发；60GB / 5MB = 12288 片 > 10000 → 触发
    const size = 60n * 1024n * 1024n * 1024n
    const p = fsMultipartPlan(Number(size), 5)
    expect(p.partSizeAdjusted).toBe(true)
    expect(p.partsTotal).toBeLessThanOrEqual(10000)
    expect(p.partSize * p.partsTotal).toBeGreaterThanOrEqual(Number(size))
    expect(p.partSizeMb).toBe(Math.ceil(Number(size) / (10000 * MB)))
  })

  it('非法片大小回落 1MB 兜底', () => {
    const p = fsMultipartPlan(10 * MB, -3)
    expect(p.partSizeMb).toBeGreaterThanOrEqual(1)
    expect(p.partsTotal).toBeGreaterThanOrEqual(1)
  })
})

describe('fsMissingChunks（下载缺片计算）', () => {
  it('无已完成区间 → 全部缺片，end 为开区间', () => {
    const size = 5 * MB + 100
    const chunks = fsMissingChunks(size, MB, [])
    expect(chunks).toHaveLength(6)
    expect(chunks[0]).toEqual({ start: 0, end: MB })
    expect(chunks[5]).toEqual({ start: 5 * MB, end: size })
  })

  it('已完成区间折叠成片序号（含尾片闭区间）', () => {
    const size = 3 * MB
    const chunks = fsMissingChunks(size, MB, [
      { start: 0, end: MB - 1 },        // 第 0 片完整
      { start: 2 * MB, end: 2 * MB },   // 尾片只写了一半 → 不算完成
    ])
    expect(chunks).toHaveLength(2)
    expect(chunks[0]).toEqual({ start: MB, end: 2 * MB })
    expect(chunks[1]).toEqual({ start: 2 * MB, end: 3 * MB })
  })

  it('全部完成 → 无缺片', () => {
    const size = 2 * MB
    expect(fsMissingChunks(size, MB, [
      { start: 0, end: MB - 1 },
      { start: MB, end: 2 * MB - 1 },
    ])).toHaveLength(0)
  })

  it('零长度 / 非法参数返回空', () => {
    expect(fsMissingChunks(0, MB, [])).toHaveLength(0)
    expect(fsMissingChunks(10, 0, [])).toHaveLength(0)
  })

  it('脏区间（越界/重复）不产生误判', () => {
    const size = 2 * MB
    const chunks = fsMissingChunks(size, MB, [
      { start: -50, end: 100 }, // 负起点 → 折到片 0，end 不够 → 不算完成
      { start: 0, end: MB - 1 },
      { start: MB, end: 2 * MB - 1 },
      { start: 99 * MB, end: 100 * MB }, // 完全越界 → 忽略
    ])
    expect(chunks).toHaveLength(0)
  })
})

describe('fsTransferCanPersist（队列持久化判定）', () => {
  it('只持久化未完结的 upload/download', () => {
    for (const status of ['queued', 'running', 'paused', 'conflict', 'failed'] as const) {
      expect(fsTransferCanPersist('upload', status)).toBe(true)
      expect(fsTransferCanPersist('download', status)).toBe(true)
    }
  })

  it('完结状态与 copy/cross/delete 不写盘（预留扩展）', () => {
    for (const status of ['success', 'canceled'] as const) {
      expect(fsTransferCanPersist('upload', status)).toBe(false)
      expect(fsTransferCanPersist('download', status)).toBe(false)
    }
    for (const kind of ['copy', 'cross', 'delete'] as const) {
      expect(fsTransferCanPersist(kind, 'running')).toBe(false)
      expect(fsTransferCanPersist(kind, 'failed')).toBe(false)
    }
  })
})

describe('fsTransferEffectivelyDone（实质完成判定，避免重启后 100% 显示已暂停）', () => {
  it('transferred 达到 size 视为完成（含 100% 窗口期状态未落 success）', () => {
    expect(fsTransferEffectivelyDone(11370487, 11370487)).toBe(true)
    expect(fsTransferEffectivelyDone(200, 100)).toBe(true) // 超传也算完成
  })

  it('未传满不判完成，size=0（未知大小）也不误判', () => {
    expect(fsTransferEffectivelyDone(99, 100)).toBe(false)
    expect(fsTransferEffectivelyDone(0, 0)).toBe(false)
    expect(fsTransferEffectivelyDone(0, 100)).toBe(false)
  })
})

describe('readFsTransferSettings（传输设置单一事实源，文件系统与图片库共用）', () => {
  it('全部缺省时回落默认值', () => {
    expect(readFsTransferSettings(() => undefined)).toEqual({
      enabled: true, thresholdMb: 50, partSizeMb: 5, partsConcurrency: 3, requestTimeoutSec: 300,
    })
  })

  it('读取配置并钳制到合法区间（图片库上传也吃这份）', () => {
    const cfg: Record<string, unknown> = {
      'app.fs.multipart.enabled': false,
      'app.fs.multipart.thresholdMb': 9999,
      'app.fs.multipart.partSizeMb': 1,
      'app.fs.multipart.partsConcurrency': 99,
      'app.fs.multipart.requestTimeoutSec': 10,
    }
    expect(readFsTransferSettings((k) => cfg[k])).toEqual({
      enabled: false, thresholdMb: 1024, partSizeMb: 5, partsConcurrency: 8, requestTimeoutSec: 30,
    })
  })
})
