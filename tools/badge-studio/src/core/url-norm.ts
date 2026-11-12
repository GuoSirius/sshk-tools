export interface UrlNormConfig {
  stripUtm: boolean
  stripHash: boolean
  stripTrailingSlash: boolean
  sortQuery: boolean
  lowercaseHost: boolean
}

export const DEFAULT_URL_NORM: UrlNormConfig = {
  stripUtm: true,
  stripHash: true,
  stripTrailingSlash: true,
  sortQuery: true,
  lowercaseHost: true,
}

const UTM_KEYS = new Set([
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
  'utm_id', 'utm_name', 'utm_cid', 'utm_reader', 'utm_referrer', 'utm_social',
  'spm', 'from', 'scenario',
])

/**
 * URL 归一（数据契约 badge.urlNorm）：去 UTM / 去 # / 去末尾斜杠 / query 排序 / host 小写。
 * 归一只用于「统计行 ↔ 邮件链接」匹配，不改变原文。
 */
export function normalizeUrl(raw: string, cfg: UrlNormConfig = DEFAULT_URL_NORM): string {
  let url = raw.trim()
  if (url === '') return ''
  if (cfg.stripHash) {
    const hashIdx = url.indexOf('#')
    if (hashIdx >= 0) url = url.slice(0, hashIdx)
  }
  // 仅 http(s) 做 query/host 级处理；锚点链接与 javascript: 原样返回
  const m = /^(https?):\/\/([^/?#]+)([^?]*)\??(.*)$/i.exec(url)
  if (!m) return url
  const protocol = m[1]!.toLowerCase()
  let host = m[2]!
  let pathname = m[3] || ''
  let query = m[4] ?? ''

  if (cfg.lowercaseHost) host = host.toLowerCase()
  if (cfg.stripTrailingSlash && pathname.length > 1 && pathname.endsWith('/')) {
    pathname = pathname.slice(0, -1)
  }

  if (query !== '') {
    const pairs = query.split('&').filter((p) => p !== '')
    const kept = cfg.stripUtm ? pairs.filter((p) => !UTM_KEYS.has(p.split('=')[0]!.toLowerCase())) : pairs
    if (cfg.sortQuery) kept.sort()
    query = kept.join('&')
  }

  const search = query === '' ? '' : `?${query}`
  return `${protocol}://${host}${pathname}${search}`
}
