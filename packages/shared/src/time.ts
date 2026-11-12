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
