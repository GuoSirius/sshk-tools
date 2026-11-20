import dayjs from 'dayjs'
import timezone from 'dayjs/plugin/timezone.js'
import utc from 'dayjs/plugin/utc.js'

// timezone 插件依赖 utc 插件，仅用于提供时区换算能力。
// 业务时间一律 Asia/Shanghai，不产生、不存储、不输出 UTC 时间。
dayjs.extend(utc)
dayjs.extend(timezone)

export const TIME_ZONE = 'Asia/Shanghai'
export const ISO_WITH_OFFSET = 'YYYY-MM-DDTHH:mm:ssZ'
export const DISPLAY_FORMAT = 'YYYY-MM-DD HH:mm:ss'
export const FILE_NAME_FORMAT = 'YYYYMMDD-HHmmss'

type TimeInput = string | number | Date | undefined

function base(input: TimeInput) {
  return input === undefined ? dayjs() : dayjs(input)
}

/** 当前北京时间，ISO 8601 带 +08:00 偏移，如 2026-11-12T21:26:28+08:00 */
export function now(): string {
  return base(undefined).tz(TIME_ZONE).format(ISO_WITH_OFFSET)
}

/** 按北京时间格式化；默认 YYYY-MM-DD HH:mm:ss */
export function format(input?: TimeInput, pattern: string = DISPLAY_FORMAT): string {
  return base(input).tz(TIME_ZONE).format(pattern)
}

/** 解析为北京时间 dayjs 实例 */
export function parse(input: TimeInput) {
  return base(input).tz(TIME_ZONE)
}

/** 用于导出包 / 产物文件名的时间戳 */
export function toFileName(input?: TimeInput): string {
  return base(input).tz(TIME_ZONE).format(FILE_NAME_FORMAT)
}

/** 校验字符串是否带 +08:00 偏移（用于入库前把关） */
export function isBeijingOffset(value: string): boolean {
  return /\+08:00$/.test(value) || /\+0800$/.test(value)
}

/** 解析为毫秒时间戳；无效输入返回 null（统一时间抽离，2026-11-20：各工具勿再散写 Date.parse/手拼字符串） */
export function toMs(input: TimeInput): number | null {
  if (input === undefined) return null
  const d = dayjs(input)
  return d.isValid() ? d.valueOf() : null
}

/**
 * 闭区间毫秒判定（时间范围过滤标准姿势，2026-11-20 列表页规范）：
 * 目标值无效 → 不过滤；范围任一端缺省/无效 → 不限制该端。
 */
export function inMsRange(input: TimeInput, from?: string | number | null, to?: string | number | null): boolean {
  const t = toMs(input)
  if (t === null) return true
  const f = from != null && from !== '' ? toMs(from) : null
  const e = to != null && to !== '' ? toMs(to) : null
  if (f !== null && t < f) return false
  if (e !== null && t > e) return false
  return true
}
