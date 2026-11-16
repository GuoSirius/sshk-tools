import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { now } from '@sshk/shared'

/**
 * N4 回滚快照（plans/05 §八）：
 * `app.outputSnapshot` 开启时（默认关，D19 行为零变化），覆盖产物前把旧文件
 * 复制进 `<userData>/.snapshots/<toolId>/<产物相对路径>`（每文件只保留最近 1 份）。
 * 全量快照上限 50MB，超出自动从最旧开始清理。
 * 纯 fs 实现（不依赖 electron），宿主与工具插件共用同一份逻辑。
 */

/** 快照总占用上限（字节） */
export const SNAPSHOT_MAX_BYTES = 50 * 1024 * 1024

/** N4 快照元数据（与快照文件同目录，`<rel>.meta.json`） */
export interface OutputSnapshotMeta {
  /** 产物相对路径（相对产物根，正斜杠） */
  rel: string
  /** 被覆盖前的绝对路径（恢复目标） */
  origPath: string
  toolId: string
  time: string
  sizeBytes: number
}

/** 快照列表行（设置页展示 / 恢复入口） */
export interface OutputSnapshotEntry extends OutputSnapshotMeta {
  /** 稳定标识：`<toolId>/<rel>`，restore 用 */
  id: string
}

/** 最小配置投影：只读 `app.outputSnapshot` 开关 */
export interface SnapshotConfigReader {
  get(key: string): unknown
}

/**
 * 传给 writeOutput 的快照选项：开关关闭返回空对象（D19 默认行为不变）。
 * 工具插件用法：`writeOutput(root, rel, content, outputSnapshotOptions(config, toolId, userDataDir))`
 */
export function outputSnapshotOptions(
  cfg: SnapshotConfigReader | undefined,
  toolId: string,
  userDataDir: string,
): { snapshotDir?: string } {
  if (!cfg || cfg.get('app.outputSnapshot') !== true) return {}
  return { snapshotDir: join(userDataDir, '.snapshots', toolId) }
}

/** 覆盖前快照：旧文件复制进 snapshotDir（按 rel 镜像 + meta）。失败静默（快照不阻断写产物） */
export function snapshotBeforeWrite(snapshotDir: string, abs: string, rel: string, toolId: string): void {
  try {
    if (!existsSync(abs) || !statSync(abs).isFile()) return
    const target = join(snapshotDir, rel.replaceAll('\\', '/'))
    mkdirSync(dirname(target), { recursive: true })
    copyFileSync(abs, target)
    const meta: OutputSnapshotMeta = {
      rel: rel.replaceAll('\\', '/'),
      origPath: abs,
      toolId,
      time: now(),
      sizeBytes: statSync(abs).size,
    }
    writeFileSync(target + '.meta.json', JSON.stringify(meta), 'utf8')
  } catch {
    // 快照失败不阻断正常产物写入
  }
}

interface SnapRootAware {
  snapshotDir: string
  metaPath: string
  meta: OutputSnapshotMeta
  sizeBytes: number
}

const META_SUFFIX = '.meta.json'

/** 快照文件本体路径 = meta 路径去掉 .meta.json 后缀（与快照文件同目录同名） */
function snapshotFileOf(metaPath: string): string {
  return metaPath.slice(0, -META_SUFFIX.length)
}

/** 递归收集快照（以 meta 文件为准，快照文件本体尺寸随行） */
function collectSnapshots(root: string): SnapRootAware[] {
  const out: SnapRootAware[] = []
  const walk = (dir: string): void => {
    if (!existsSync(dir)) return
    for (const name of readdirSync(dir)) {
      const full = join(dir, name)
      if (statSync(full).isDirectory()) {
        walk(full)
      } else if (name.endsWith(META_SUFFIX)) {
        try {
          const meta = JSON.parse(readFileSync(full, 'utf8')) as OutputSnapshotMeta
          const snapshotDir = dirname(full)
          const file = snapshotFileOf(full)
          out.push({
            snapshotDir,
            metaPath: full,
            meta,
            sizeBytes: existsSync(file) ? statSync(file).size : 0,
          })
        } catch {
          // meta 损坏：跳过该条（不抛，列表仍可用）
        }
      }
    }
  }
  if (!existsSync(root)) return out
  for (const toolDir of readdirSync(root)) {
    const full = join(root, toolDir)
    if (statSync(full).isDirectory()) walk(full)
  }
  return out
}

function toEntry(root: string, snap: SnapRootAware): OutputSnapshotEntry {
  const relToRoot = snap.metaPath.slice(root.length + 1)
  const id = relToRoot.replace(/\.meta\.json$/, '').replaceAll('\\', '/')
  return { ...snap.meta, id }
}

/** 快照清单（按时间倒序，最新的在前；供设置页展示） */
export function listSnapshots(root: string): OutputSnapshotEntry[] {
  return collectSnapshots(root)
    .map((s) => toEntry(root, s))
    .sort((a, b) => b.time.localeCompare(a.time))
}

/** 恢复快照：把旧文件复制回原路径（覆盖当前产物；快照保留，可反复恢复） */
export function restoreSnapshot(root: string, id: string): string {
  const snap = collectSnapshots(root).find((s) => toEntry(root, s).id === String(id ?? ''))
  if (!snap) throw new Error('快照不存在或已被清理')
  const source = snapshotFileOf(snap.metaPath)
  if (!existsSync(source)) throw new Error('快照文件缺失，无法恢复')
  mkdirSync(dirname(snap.meta.origPath), { recursive: true })
  copyFileSync(source, snap.meta.origPath)
  return snap.meta.origPath
}

/** 清空全部快照（设置页「清空快照」；仅清应用自己的 .snapshots 目录） */
export function clearSnapshots(root: string): number {
  const count = collectSnapshots(root).length
  if (existsSync(root)) rmSync(root, { recursive: true, force: true })
  return count
}

/** 超限清理：按时间从最旧删起，直到总占用 ≤ maxBytes */
export function pruneSnapshots(root: string, maxBytes: number = SNAPSHOT_MAX_BYTES): number {
  const snaps = collectSnapshots(root).sort((a, b) => a.meta.time.localeCompare(b.meta.time))
  let total = snaps.reduce((acc, s) => acc + s.sizeBytes, 0)
  let removed = 0
  for (const snap of snaps) {
    if (total <= maxBytes) break
    try {
      const file = snapshotFileOf(snap.metaPath)
      if (existsSync(file)) {
        total -= snap.sizeBytes
        rmSync(file, { force: true })
        removed++
      }
      rmSync(snap.metaPath, { force: true })
    } catch {
      // 清理失败不阻断
    }
  }
  return removed
}
