import { describe, expect, it } from 'vitest'
import {
  DISPLAY_FORMAT,
  format,
  isBeijingOffset,
  now,
  parse,
  TIME_ZONE,
  toFileName,
} from './time'

describe('北京时间工具', () => {
  it('now() 输出带 +08:00 偏移，不以 UTC 的 Z 结尾', () => {
    const value = now()
    expect(isBeijingOffset(value)).toBe(true)
    expect(value.endsWith('Z')).toBe(false)
    expect(value).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+08:00$/)
  })

  it('TIME_ZONE 固定为 Asia/Shanghai', () => {
    expect(TIME_ZONE).toBe('Asia/Shanghai')
  })

  it('format() 默认按北京时间输出展示格式', () => {
    const value = format('2026-11-12T21:26:28+08:00')
    expect(value).toBe('2026-11-12 21:26:28')
    expect(format('2026-11-12T21:26:28+08:00', DISPLAY_FORMAT)).toBe(value)
  })

  it('外部 UTC 输入在入口转换为北京时间', () => {
    const value = format('2026-11-12T13:26:28Z')
    expect(value).toBe('2026-11-12 21:26:28')
  })

  it('parse() 与 format() 往返一致且时区正确', () => {
    const source = '2026-11-12T21:26:28+08:00'
    expect(format(parse(source).format())).toBe('2026-11-12 21:26:28')
  })

  it('toFileName() 产出 YYYYMMDD-HHmmss', () => {
    expect(toFileName('2026-11-12T21:26:28+08:00')).toBe('20261112-212628')
    expect(toFileName()).toMatch(/^\d{8}-\d{6}$/)
  })
})
