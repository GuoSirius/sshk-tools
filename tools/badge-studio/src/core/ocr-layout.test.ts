import { describe, expect, it } from 'vitest'
import { DEFAULT_OCR_LAYOUT, parseOcrLines } from './ocr-layout'
import { parseCsvText, rowsToCsv, toStatRows } from './datasource'
import { metricValue } from './badge'
import { parseVisionResult, toCsvText } from './vision'

describe('OCR 版式配置驱动解析（不替用户猜版式）', () => {
  it('同行 + 千分位 + 跳过合计行', () => {
    const text = [
      'https://a.com/p 1,234 40',
      'https://b.com/p 12 20',
      '合计 1,246 60',
    ].join('\n')
    const rows = parseOcrLines(text, DEFAULT_OCR_LAYOUT)
    expect(rows).toEqual([
      { url: 'https://a.com/p', clicks: 1234, totalClicks: 40 },
      { url: 'https://b.com/p', clicks: 12, totalClicks: 20 },
    ])
  })

  it('两行版式：URL 行的下一行才是数字', () => {
    const text = 'https://c.com/p\n7 9'
    const rows = parseOcrLines(text, { ...DEFAULT_OCR_LAYOUT, linkNumberSameLine: false })
    expect(rows).toEqual([{ url: 'https://c.com/p', clicks: 7, totalClicks: 9 }])
  })

  it('关闭千分位后逗号按列分隔处理', () => {
    const text = 'https://d.com/p 12,40'
    const rows = parseOcrLines(text, { ...DEFAULT_OCR_LAYOUT, thousandsSeparator: false })
    expect(rows[0]).toMatchObject({ clicks: 12, totalClicks: 40 })
  })

  it('自定义列顺序进入 metrics，不认识的列不猜', () => {
    const text = 'https://e.com/p 5 8'
    const rows = parseOcrLines(text, { ...DEFAULT_OCR_LAYOUT, columnOrder: 'url,clicks,uv' })
    expect(rows[0]).toEqual({ url: 'https://e.com/p', clicks: 5, totalClicks: 5, metrics: { uv: 8 } })
  })

  it('无表头的 OCR 原始文本会回退到版式解析', () => {
    const rows = parseVisionResult('https://f.com/p 6 6', [], { layout: DEFAULT_OCR_LAYOUT })
    expect(rows[0]).toMatchObject({ url: 'https://f.com/p', clicks: 6 })
  })
})

describe('自定义数值列与可编辑表格数据契约', () => {
  it('CSV / JSON / 表格往返保留自定义列', () => {
    const rows = parseCsvText('url,clicks,totalClicks,uv\nhttps://g.com,1,2,3')
    expect(rows[0]?.metrics?.uv).toBe(3)
    const csv = rowsToCsv(rows)
    expect(csv).toContain('uv')
    expect(parseCsvText(csv)[0]?.metrics?.uv).toBe(3)
    expect(toCsvText(rows)).toBe(csv)
    expect(toStatRows([{ url: 'https://g.com', clicks: 1, uv: 3 }], [])[0]?.metrics?.uv).toBe(3)
  })

  it('角标可取自定义数值列，缺失时回退 clicks', () => {
    const row = { url: 'https://g.com', clicks: 1, totalClicks: 2, metrics: { uv: 9 } }
    expect(metricValue(row, 'uv')).toBe(9)
    expect(metricValue(row, 'clicks')).toBe(1)
    expect(metricValue(row, 'totalClicks')).toBe(2)
    expect(metricValue(row, 'unknown')).toBe(1)
  })
})
