/**
 * D-V3-2 打字平滑器（纯逻辑，可单测）：
 * 端点聚合大分片 / 响应过快时，delta 积压一次性到达会导致「一下子输出」。
 * 平滑器把分片入队，按固定节拍逐段释放，视觉恒为连续打字：
 * - 基础步长 baseStep：积压小时匀速释放
 * - 追赶系数 catchUpRatio：积压越大每拍释放越多（pending/catchUpRatio 向上取整），保证长回复不被拖太慢
 */
export interface TypingSmoothener {
  /** delta 入队（空串忽略） */
  push(delta: string): void
  /** 立即释放全部积压并停止节拍（流结束时调用，避免结尾跳变） */
  flush(): void
  /** 当前积压字符数（测试与调试用） */
  pending(): number
}

export interface TypingSmoothenerOptions {
  /** 释放节拍间隔（ms），默认 35 ≈ 28fps 打字感 */
  intervalMs?: number
  /** 基础步长（字符/拍），默认 3 */
  baseStep?: number
  /** 追赶系数：积压每达到 N 字符，步长 +1，默认 12 */
  catchUpRatio?: number
}

export function createTypingSmoothener(
  append: (text: string) => void,
  opts?: TypingSmoothenerOptions,
): TypingSmoothener {
  const intervalMs = opts?.intervalMs ?? 35
  const baseStep = opts?.baseStep ?? 3
  const catchUpRatio = Math.max(1, opts?.catchUpRatio ?? 12)
  let queue = ''
  let timer: ReturnType<typeof setInterval> | null = null

  function stop(): void {
    if (timer) { clearInterval(timer); timer = null }
  }

  function tick(): void {
    if (!queue) { stop(); return }
    const step = Math.max(baseStep, Math.ceil(queue.length / catchUpRatio))
    append(queue.slice(0, step))
    queue = queue.slice(step)
    if (!queue) stop()
  }

  return {
    push(delta: string): void {
      if (!delta) return
      queue += delta
      if (!timer) timer = setInterval(tick, intervalMs)
    },
    flush(): void {
      stop()
      if (queue) { append(queue); queue = '' }
    },
    pending: () => queue.length,
  }
}
