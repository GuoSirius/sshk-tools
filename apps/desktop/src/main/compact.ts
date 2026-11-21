import type { AppServices } from './services'

/** H6 NeDB 防膨胀：超阈集合按需压缩 + 全量压缩；失败只告警，绝不影响使用（P3-1 自 index.ts 拆出） */
export async function compactDatabase(services: AppServices | null, reason: 'daily' | 'startup' | 'quit'): Promise<void> {
  const repo = services?.repository
  if (!repo) return
  const started = Date.now()
  try {
    const bulky = await repo.compactIfBulky()
    await repo.compact()
    console.log(`[sshk] NeDB 压缩完成（${reason}${bulky.length > 0 ? ` · 超阈集合：${bulky.join('、')}` : ''} · ${Date.now() - started}ms）`)
  } catch (err) {
    console.warn(`[sshk] NeDB 压缩失败（${reason}，不影响使用）：`, err)
  }
}
