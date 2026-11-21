import type { IpcErrorCode } from '@sshk/shared'

/**
 * 上传/云存储域错误归类器（B16 · P0-4 注册制）：
 * 从 ipc-wrap 的硬编码 classifyExpected 迁出——云 SDK / 网络库的「预期内业务失败」
 * 由领域包自我申报，ipc-wrap 只做注册与调度，不再内置任何 SDK 知识。
 * 只认确定性标记（code/status）与既有友好文案同款关键词，不匹配返回 null（unknown + 全量日志）。
 */
export function uploadErrorClassifier(err: unknown): IpcErrorCode | null {
  const rec = err as { code?: unknown; status?: unknown; name?: unknown }
  const sdkCode = String(rec?.code ?? '')
  const status = Number(rec?.status ?? 0)
  const name = String(rec?.name ?? '')
  const msg = err instanceof Error ? err.message : String(err)
  if (
    sdkCode === 'AccessDenied' || name === 'AccessDeniedError' || status === 403 ||
    /no right to access|bucket acl|AccessDenied|permission denied|Forbidden|无权|权限不足/i.test(msg)
  ) return 'permission'
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|getaddrinfo/i.test(msg)) return 'timeout'
  if (/530|532|Authentication|All authentication|认证失败|密码错误/i.test(msg)) return 'permission'
  if (sdkCode === 'NoSuchBucket' || sdkCode === 'NoSuchKey' || /NoSuchBucket|NoSuchKey|The specified bucket does not exist/i.test(msg)) return 'io'
  return null
}
