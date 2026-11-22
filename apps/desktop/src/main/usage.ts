import { format } from '@sshk/shared'
import type { UsageGroup, UsageStatsPayload } from '@sshk/shared'
import type { Repository, UsageRec } from '@sshk/repository'
import { logger } from './logger'

/**
 * D-Q1 模型用量日志：
 * - 采集点：llm-gateway chat 返回后（main 侧）——console 调试 / 工具调用 / 视觉识别
 * - 只记元数据（provider/model/tokens/耗时/成败），绝不记 messages 内容
 * - 记录失败绝不影响业务（fire-and-forget）
 * - 明细保留 90 天（usageClear 顺手清理）
 */

export interface UsageInput {
  providerId: string
  providerName: string
  model: string
  purpose: string
  streamed: boolean
  contentLength?: number
  promptTokens?: number
  completionTokens?: number
  durationMs: number
  ok: boolean
  error?: string
}

/** 流式无 usage 时按 ~4 字符/token 估算 completion tokens（非流式取真实 usage） */
function estimateTokens(input: UsageInput): { promptTokens?: number; completionTokens?: number } {
  if (input.completionTokens != null) {
    return { promptTokens: input.promptTokens, completionTokens: input.completionTokens }
  }
  return {
    promptTokens: input.promptTokens,
    completionTokens: input.contentLength != null ? Math.round(input.contentLength / 4) : undefined,
  }
}

export function recordUsage(repository: Repository, input: UsageInput): void {
  const tokens = estimateTokens(input)
  void repository.insert<UsageRec>('usage', {
    providerId: input.providerId,
    providerName: input.providerName,
    model: input.model,
    purpose: input.purpose,
    streamed: input.streamed,
    promptTokens: tokens.promptTokens,
    completionTokens: tokens.completionTokens,
    durationMs: Math.round(input.durationMs),
    ok: input.ok,
    ...(input.error ? { error: input.error.slice(0, 300) } : {}),
  }).catch((err: unknown) => logger.warn('usage', `用量记录写入失败（不影响业务）：${(err as Error).message}`))
}

/** 按 provider+model 分组聚合 + 最近明细（limit 200，时间倒序） */
export async function collectUsageStats(
  repository: Repository,
  since: string | null,
): Promise<UsageStatsPayload> {
  const query: Record<string, unknown> = {}
  if (since) query['createdAt'] = { $gte: since }
  const rows = await repository.list<UsageRec>('usage', query, { createdAt: -1 })

  const map = new Map<string, UsageGroup>()
  for (const r of rows) {
    const key = `${r.providerId}|${r.model}`
    let g = map.get(key)
    if (!g) {
      g = { providerId: r.providerId, providerName: r.providerName, model: r.model, calls: 0, okCalls: 0, failCalls: 0, promptTokens: 0, completionTokens: 0, totalMs: 0 }
      map.set(key, g)
    }
    g.calls++
    if (r.ok) g.okCalls++
    else g.failCalls++
    g.promptTokens += r.promptTokens ?? 0
    g.completionTokens += r.completionTokens ?? 0
    g.totalMs += r.durationMs
  }
  const groups = [...map.values()].sort((a, b) => b.calls - a.calls)
  return {
    since,
    groups,
    totalCalls: rows.length,
    records: rows.slice(0, 200),
  }
}

/** 清空用量明细：keepDays=0 全清；否则删除早于 N 天的记录。返回删除数 */
export async function clearUsage(repository: Repository, keepDays = 0): Promise<number> {
  if (keepDays <= 0) return repository.removeWhere('usage', {})
  const cutoff = format(new Date(Date.now() - keepDays * 86_400_000), 'YYYY-MM-DDTHH:mm:ss')
  return repository.removeWhere('usage', { createdAt: { $lt: cutoff } })
}

/** 明细保留天数（头注释承诺「保留 90 天」，此前只有设置页手动清理时执行——承诺未兑现） */
const USAGE_RETENTION_DAYS = 90

/** 启动清理（2026-11-22 复核）：按保留天数删除过期明细，兑现「明细保留 90 天」 */
export function purgeExpiredUsageOnStart(repository: Repository): void {
  void clearUsage(repository, USAGE_RETENTION_DAYS)
    .then((n) => { if (n > 0) logger.info('usage', `启动清理：已删除 ${n} 条超过 ${USAGE_RETENTION_DAYS} 天的用量明细`) })
    .catch((err: unknown) => logger.warn('usage', `启动清理用量明细失败：${(err as Error).message}`))
}
