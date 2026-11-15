/**
 * 并发控制（复核项 1）：主路径使用成熟库 p-limit，不再自研 worker 池。
 *
 * 用字面量 import() 让构建器把库内联进产物（安装包不含 node_modules），
 * 同时保留一条最小降级路径：万一产物缺 chunk，上传链路也不会整体崩掉。
 */
type LimitFactory = (concurrency: number) => <T>(fn: () => Promise<T>) => Promise<T>

let cachedFactory: LimitFactory | null = null

async function loadPLimit(): Promise<LimitFactory | null> {
  if (cachedFactory) return cachedFactory
  try {
    // 字面量 import 让构建器把 p-limit 内联进产物（安装包不含 node_modules）
    const loaded: unknown = await import('p-limit')
    const candidate = (loaded as { default?: unknown }).default ?? loaded
    if (typeof candidate !== 'function') return null
    cachedFactory = candidate as LimitFactory
    return cachedFactory
  } catch {
    // 极端情况（产物缺 chunk）降级到内置实现，不让上传链路整体崩掉
    return null
  }
}

/** 降级实现：仅用于 p-limit 未安装的开发态，保持输入顺序与并发上限语义一致 */
async function fallbackMap<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let cursor = 0
  const worker = async (): Promise<void> => {
    for (;;) {
      const i = cursor++
      if (i >= items.length) return
      results[i] = await fn(items[i]!, i)
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()))
  return results
}

/** 有并发上限的 map，保持输入顺序输出结果 */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return []
  const n = Math.max(1, Math.floor(limit) || 1)
  const factory = await loadPLimit()
  if (!factory) return await fallbackMap(items, n, fn)
  const run = factory(n)
  return await Promise.all(items.map((item, index) => run(() => fn(item, index))))
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
