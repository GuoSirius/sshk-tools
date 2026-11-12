import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import { parseCsvText, parseDatasource } from './datasource'

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
