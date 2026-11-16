import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  clearSnapshots,
  listSnapshots,
  outputSnapshotOptions,
  pruneSnapshots,
  restoreSnapshot,
  SNAPSHOT_MAX_BYTES,
  type SnapshotConfigReader,
} from './snapshots'
import { writeOutput } from './paths'

let root = ''
let userData = ''

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'sshk-snap-root-'))
  userData = mkdtempSync(join(tmpdir(), 'sshk-snap-user-'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
  rmSync(userData, { recursive: true, force: true })
})

describe('outputSnapshotOptions（N4 开关）', () => {
  const cfg = (value: unknown): SnapshotConfigReader => ({ get: (key) => (key === 'app.outputSnapshot' ? value : null) })

  it('开关关闭 / 未配置返回空对象（D19 默认行为零变化）', () => {
    expect(outputSnapshotOptions(undefined, 'tool', userData)).toEqual({})
    expect(outputSnapshotOptions(cfg(false), 'tool', userData)).toEqual({})
    expect(outputSnapshotOptions(cfg(null), 'tool', userData)).toEqual({})
  })

  it('开关开启返回 .snapshots/<toolId> 快照目录', () => {
    const opts = outputSnapshotOptions(cfg(true), 'badge-studio', userData)
    expect(opts.snapshotDir).toBe(join(userData, '.snapshots', 'badge-studio'))
  })
})

describe('writeOutput 快照闭环（覆盖 → 快照 → 恢复）', () => {
  it('覆盖前旧文件进快照，恢复后回到原路径', () => {
    const rel = 'outputs/poster/p1.html'
    const opts = outputSnapshotOptions({ get: () => true }, 'badge-studio', userData)
    writeOutput(root, rel, '<html>v1</html>')
    writeOutput(root, rel, '<html>v2</html>', opts)

    const snapshots = listSnapshots(join(userData, '.snapshots'))
    expect(snapshots).toHaveLength(1)
    expect(snapshots[0]?.rel).toBe(rel)
    expect(snapshots[0]?.toolId).toBe('badge-studio')
    expect(readFileSync(snapshots[0]!.origPath, 'utf8')).toBe('<html>v2</html>')

    const restored = restoreSnapshot(join(userData, '.snapshots'), snapshots[0]!.id)
    expect(restored).toBe(snapshots[0]!.origPath)
    expect(readFileSync(join(root, rel), 'utf8')).toBe('<html>v1</html>')

    // 快照保留，可反复恢复
    expect(listSnapshots(join(userData, '.snapshots'))).toHaveLength(1)
  })

  it('不传 snapshotDir 时零快照（现状不变）；首次写入（无旧文件）不产生快照', () => {
    writeOutput(root, 'outputs/edm/a.html', 'x')
    expect(listSnapshots(join(userData, '.snapshots'))).toHaveLength(0)

    const opts = outputSnapshotOptions({ get: () => true }, 'edm-studio', userData)
    writeOutput(root, 'outputs/edm/b.html', 'v1', opts)
    expect(listSnapshots(join(userData, '.snapshots'))).toHaveLength(0) // 无旧文件可快照
    writeOutput(root, 'outputs/edm/b.html', 'v2', opts)
    expect(listSnapshots(join(userData, '.snapshots'))).toHaveLength(1)
  })

  it('clearSnapshots 清空后列表归零、恢复报错', () => {
    const opts = outputSnapshotOptions({ get: () => true }, 'badge-studio', userData)
    writeOutput(root, 'outputs/poster/p2.html', 'old', opts)
    writeOutput(root, 'outputs/poster/p2.html', 'new', opts)
    const snapshotRoot = join(userData, '.snapshots')
    expect(clearSnapshots(snapshotRoot)).toBe(1)
    expect(existsSync(snapshotRoot)).toBe(false)
    expect(() => restoreSnapshot(snapshotRoot, 'badge-studio/outputs/poster/p2.html')).toThrow(/快照/)
  })
})

describe('pruneSnapshots（50MB 上限）', () => {
  it('超过上限从最旧开始清理，最新快照保留', () => {
    const snapshotRoot = join(userData, '.snapshots')
    // 3 份快照各约 20KB，上限压到 30KB → 最旧 1 份被清
    writeOutput(root, 'outputs/poster/p.html', 'x'.repeat(20 * 1024))
    for (let i = 0; i < 3; i++) {
      const dir = join(snapshotRoot, `tool-${i}`)
      writeOutput(root, 'outputs/poster/p.html', 'y'.repeat(20 * 1024), { snapshotDir: dir })
    }
    const removed = pruneSnapshots(snapshotRoot, 30 * 1024)
    const left = listSnapshots(snapshotRoot)
    expect(removed).toBeGreaterThanOrEqual(1)
    expect(left.length).toBeLessThan(3)
    // 剩余占用不超上限
    const total = left.reduce((acc, s) => acc + s.sizeBytes, 0)
    expect(total).toBeLessThanOrEqual(30 * 1024)
    expect(SNAPSHOT_MAX_BYTES).toBe(50 * 1024 * 1024)
  })
})
