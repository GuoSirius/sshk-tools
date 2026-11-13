import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import { parseCsvText, parseDatasource } from './datasource'
import { parseVisionResult, toCsvText, buildVisionMessages } from './vision'

describe('数据源解析（D10 四种）', () => {
  it('csv：表头宽松匹配 url/clicks/totalClicks', () => {
    const rows = parseCsvText('链接地址,点击次数,总点击次数\nhttps://a.com,3,10\nhttps://b.com,0,0\n')
    expect(rows).toEqual([
      { url: 'https://a.com', clicks: 3, totalClicks: 10 },
      { url: 'https://b.com', clicks: 0, totalClicks: 0 },
    ])
  })

  it('csv：缺表头列明确报错', () => {
    expect(() => parseCsvText('foo,bar\n1,2')).toThrow('缺少')
  })

  it('json：对象数组', async () => {
    const parsed = await parseDatasource('json', '[{"url":"https://a.com","clicks":"5"}]')
    expect(parsed.rows[0]?.clicks).toBe(5)
  })

  it('json：非数组拒绝', async () => {
    await expect(parseDatasource('json', '{"url":"x"}')).rejects.toThrow('对象数组')
  })

  it('xlsx：buffer 解析（SheetJS 内存构造）', async () => {
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([{ url: 'https://c.com', clicks: 7 }]))
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer
    const parsed = await parseDatasource('xlsx', buf)
    expect(parsed.rows).toEqual([{ url: 'https://c.com', clicks: 7, totalClicks: 7 }])
  })

  it('image：人工校对文本 + warning 提示', async () => {
    const parsed = await parseDatasource('image', 'url,clicks\nhttps://a.com,2\n')
    expect(parsed.rows).toHaveLength(1)
    expect(parsed.warnings.some((w) => w.includes('人工校对'))).toBe(true)
  })
})

describe('图片识别结果归一（云端视觉 / 本机 PaddleOCR 共用）', () => {
  it('带 Markdown 代码块的 JSON 数组也能解析出标准 StatRow', () => {
    const text = '识别结果如下：\n```json\n[{"url":"https://a.com/p","clicks":7,"totalClicks":20}]\n```'
    const warnings: string[] = []
    const rows = parseVisionResult(text, warnings)
    expect(rows).toEqual([{ url: 'https://a.com/p', clicks: 7, totalClicks: 20 }])
    expect(warnings.some((w) => w.includes('人工核对'))).toBe(true)
    expect(toCsvText(rows)).toContain('https://a.com/p,7,20')
  })

  it('PaddleOCR 适配器输出 CSV 时走同一套清洗规则', () => {
    const rows = parseVisionResult('url,clicks,totalClicks\nhttps://b.com,3,9\n')
    expect(rows).toEqual([{ url: 'https://b.com', clicks: 3, totalClicks: 9 }])
  })

  it('构建多模态消息：system + text/image_url 分片', () => {
    const messages = buildVisionMessages('data:image/png;base64,AAAA')
    expect(messages[0]?.role).toBe('system')
    const parts = messages[1]?.content
    expect(Array.isArray(parts)).toBe(true)
    expect(parts).toContainEqual({ type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } })
  })

  it('空结果明确报错，不让空数据静默进生成链路', () => {
    expect(() => parseVisionResult('  ')).toThrow('识别结果为空')
  })
})
