import { existsSync, readFileSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { unlink } from 'node:fs/promises'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { ShareRoute } from './routes'
import { DEFAULT_TTL_HOURS } from './routes'

/**
 * 状态持久化域（P6-6 自 index.ts 拆出）：hub-state.json 读写（重启 resume 未过期路由）
 * + 写操作串行化 + 500ms 节流合并（多工具并发 create 不重复落盘）。
 */
interface PersistedHub {
  version: 1
  routes: ShareRoute[]
}

/** 旧状态文件名（badge/edm）——由宿主启动时检测即静默删除，内核不读取不迁移。 */
export const LEGACY_SHARE_STATE_FILES = ['badge-share-state.json', 'edm-share-state.json']

export class StateFileStore {
  private timer: ReturnType<typeof setTimeout> | null = null

  constructor(
    private readonly stateFile: string,
    /** 路由快照 getter：flush 时取内核当前路由表（内存态是权威） */
    private readonly getRoutes: () => ShareRoute[],
    /** 落盘失败回调（宿主接 logger）：此前静默吞错，崩溃/重启后路由全丢且无痕迹 */
    private readonly onError?: (msg: string) => void,
  ) {}

  /** 从状态文件恢复未过期路由（已过期剔除并从文件移除）。
   *  返回 null = 文件不存在/损坏（不触发 flush，与原实现一致）；数组 = 解析成功（调用方回填路由表后 flush）。 */
  resume(): ShareRoute[] | null {
    if (!existsSync(this.stateFile)) return null
    try {
      const saved = JSON.parse(readFileSync(this.stateFile, 'utf8')) as PersistedHub
      if (!saved || !Array.isArray(saved.routes)) return null
      const now = Date.now()
      const restored: ShareRoute[] = []
      for (const r of saved.routes) {
        // plans/12 总原则：不兼容旧数据——缺 updatedAt 的旧路由视为脏数据丢弃（旧链接失效，用户已接受）
        if (!r?.token || !r.root || !r.expiresAt || typeof r.updatedAt !== 'number') continue
        if (now > r.expiresAt) continue
        // content kind 的 root 是虚拟标记（内容在 NeDB），不校验磁盘存在；file kind 保持
        if (r.kind !== 'content' && !existsSync(r.root)) continue
        restored.push({
          id: r.id ?? randomUUID(), token: r.token, toolId: r.toolId ?? '',
          label: r.label ?? '分享', root: r.root, entry: r.entry ?? '',
          ttlHours: r.ttlHours ?? DEFAULT_TTL_HOURS, createdAt: r.createdAt ?? now,
          updatedAt: r.updatedAt, expiresAt: r.expiresAt, password: r.password ?? '',
          allowIndex: r.allowIndex, hits: r.hits ?? 0,
          kind: r.kind ?? 'file', contentId: r.contentId,
        })
      }
      return restored
    } catch {
      // 状态文件损坏：忽略，从空路由表开始（不影响服务启动）
      return null
    }
  }

  /** 写操作串行化 + 500ms 节流合并（多工具并发 create 不重复落盘）。 */
  schedule(): void {
    if (this.timer) return
    this.timer = setTimeout(() => {
      this.timer = null
      void this.flush()
    }, 500)
    this.timer.unref?.()
  }

  async flush(): Promise<void> {
    if (this.timer) { clearTimeout(this.timer); this.timer = null }
    if (!this.stateFile) return
    try {
      const dir = dirname(this.stateFile)
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
      // 2026-11-22 复核：tmp+renameSync 原子写（此前直接覆写，非原子 + 失败静默——
      // 写坏 → resume() 返回 null → 重启全部分享路由丢失且无提示）
      const tmp = `${this.stateFile}.tmp`
      try {
        writeFileSync(tmp, JSON.stringify({ version: 1, routes: [...this.getRoutes()] } satisfies PersistedHub), 'utf8')
        renameSync(tmp, this.stateFile)
      } catch (err) {
        try { rmSync(tmp, { force: true }) } catch { /* 忽略 */ }
        throw err
      }
    } catch (err) {
      // 落盘失败不影响当次分享（内存态仍是权威），但必须留痕
      this.onError?.(`hub-state.json 落盘失败（重启后分享路由可能丢失）：${(err as Error).message}`)
    }
  }

  /** 停止并清空全部路由时删除状态文件（所有链接永久失效）。 */
  async clearFile(): Promise<void> {
    if (this.timer) { clearTimeout(this.timer); this.timer = null }
    await unlink(this.stateFile).catch(() => { /* 本就不存在，忽略 */ })
  }
}
