/** 有并发上限的 map，保持输入顺序输出结果（不引入额外依赖） */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return []
  const n = Math.max(1, Math.floor(limit) || 1)
  const results = new Array<R>(items.length)
  let cursor = 0

  const worker = async (): Promise<void> => {
    for (;;) {
      const i = cursor++
      const item = items[i]
      if (item === undefined) return
      results[i] = await fn(item, i)
    }
  }

  await Promise.all(Array.from({ length: Math.min(n, items.length) }, () => worker()))
  return results
}

/** 失败重试（retries = 首次失败后的额外尝试次数） */
export async function withRetry<T>(fn: () => Promise<T>, retries: number): Promise<T> {
  const max = Math.max(0, Math.floor(retries))
  let last: unknown
  for (let attempt = 0; attempt <= max; attempt++) {
    try {
      return await fn()
    } catch (err) {
      last = err
    }
  }
  throw last instanceof Error ? last : new Error(String(last))
}
