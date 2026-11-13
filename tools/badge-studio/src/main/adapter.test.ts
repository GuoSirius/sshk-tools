import { describe, expect, it } from 'vitest'
import { ADAPTER_SCRIPTS, withAdapterArgs } from './adapter'

describe('PaddleOCR 适配器宿主托管', () => {
  it('适配器脚本在构建期被打包为文本，随应用分发', () => {
    expect(Object.keys(ADAPTER_SCRIPTS)).toContain('paddleocr_adapter.py')
    expect(ADAPTER_SCRIPTS['paddleocr_adapter.py']).toContain('rows_from_lines')
  })

  it('用户参数未写 .py 脚本时自动前置适配器路径（修复：图片被当成源码执行）', () => {
    expect(withAdapterArgs(['{image}'], 'C:/u/adapters/paddleocr_adapter.py'))
      .toEqual(['C:/u/adapters/paddleocr_adapter.py', '{image}'])
    expect(withAdapterArgs([], 'C:/u/a.py')).toEqual(['C:/u/a.py'])
    // 用户显式写了脚本则尊重用户配置
    expect(withAdapterArgs(['D:/my/adapter.py', '{image}'], 'C:/u/a.py'))
      .toEqual(['D:/my/adapter.py', '{image}'])
  })
})
