import { ElMessage } from 'element-plus'

/**
 * 统一动作执行（A17 · P0-4）：替代散落的 `try/catch { ElMessage.error }` 写法。
 * 成功提示可选；失败 toast 统一取 err.message（IpcResult 解包后已是 AppError.message）。
 * 返回布尔值便于调用方决定是否继续后续流程（如刷新列表、清空勾选）。
 */
export interface RunActionOptions {
  /** 成功后的 toast 文案；缺省静默 */
  success?: string
  /** 失败 toast 前缀（如「删除失败」）；缺省直接展示 err.message */
  errorPrefix?: string
}

export interface UseActionReturn {
  runWithToast: (action: () => Promise<void> | void, options?: RunActionOptions) => Promise<boolean>
}

export function useAction(): UseActionReturn {
  async function runWithToast(action: () => Promise<void> | void, options?: RunActionOptions): Promise<boolean> {
    try {
      await action()
      if (options?.success) ElMessage.success(options.success)
      return true
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      ElMessage.error(options?.errorPrefix ? `${options.errorPrefix}：${msg}` : msg)
      return false
    }
  }
  return { runWithToast }
}
