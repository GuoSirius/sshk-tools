import { describe, expect, it } from 'vitest'
import { collectControlKeys, compositeDepth, expandFields, normalizeCompositeDepth, DEFAULT_COMPOSITE_DEPTH, UNLIMITED_DEPTH } from './expand'
import { normalizeFields, type FieldDef } from './index'

/** 测试控件库：contact-group（联系人组）与 self-loop（自引用，模拟成环数据） */
const CONTROLS: Record<string, FieldDef> = {
  'contact-group': normalizeFields([{
    key: 'members', label: '成员', type: 'repeater', minRows: 1,
    itemFields: [{ key: 'name', label: '姓名', type: 'input', required: true }],
  }])[0]!,
  'self-loop': { key: 'x', label: '自环', type: 'repeater', itemFields: [{ key: 'y', label: 'Y', type: 'repeater', controlKey: 'self-loop' }] },
}
const resolve = (key: string): FieldDef | undefined => CONTROLS[key]

describe('expandFields（复合控件引用展开）', () => {
  it('controlKey 占位节点展开为控件 root 深拷贝，保留占位的 key/label/required 覆盖', () => {
    const fields = normalizeFields([
      { key: 'team', label: '项目组', type: 'repeater', required: true, controlKey: 'contact-group' },
      { key: 'title', label: '标题', type: 'input' },
    ])
    const out = expandFields(fields, resolve)
    expect(out[0]).toMatchObject({ key: 'team', label: '项目组', required: true, type: 'repeater', minRows: 1 })
    expect(out[0]!.itemFields?.[0]).toMatchObject({ key: 'name', type: 'input' })
    expect(out[0]!.controlKey).toBeUndefined() // 展开后不带引用键
    expect(out[1]).toMatchObject({ key: 'title', type: 'input' })
  })

  it('嵌套 itemFields 内的引用同样展开', () => {
    const fields = normalizeFields([{
      key: 'page', label: '页面', type: 'repeater',
      itemFields: [{ key: 'c', label: '联系人', type: 'repeater', controlKey: 'contact-group' }],
    }])
    const out = expandFields(fields, resolve)
    expect(out[0]!.itemFields?.[0]!.itemFields?.[0]).toMatchObject({ key: 'name' })
  })

  it('控件不存在抛错（悬空引用）', () => {
    const fields = normalizeFields([{ key: 'a', label: 'A', type: 'repeater', controlKey: 'gone' }])
    expect(() => expandFields(fields, resolve)).toThrow('不存在或已被删除')
  })

  it('成环引用：循环引用保护生效（默认与 maxDepth=0 无限制模式均报错，路径可读）', () => {
    const fields = normalizeFields([{ key: 'a', label: 'A', type: 'repeater', controlKey: 'self-loop' }])
    expect(() => expandFields(fields, resolve)).toThrow('循环引用')
    expect(() => expandFields(fields, resolve)).toThrow('self-loop → self-loop')
    expect(() => expandFields(fields, resolve, { maxDepth: 0 })).toThrow('循环引用')
  })

  it('嵌套引用超配置上限抛错；上限可配置（默认 5）', () => {
    const mk = (leaf: string): Record<string, FieldDef> => ({
      c1: { key: 'a', label: 'C1', type: 'repeater', itemFields: [{ key: 'b', label: 'B', type: 'repeater', controlKey: 'c2' }] },
      c2: { key: 'b', label: 'C2', type: 'repeater', itemFields: [{ key: 'c', label: 'C', type: 'repeater', controlKey: 'c3' }] },
      c3: { key: 'c', label: 'C3', type: 'repeater', itemFields: [{ key: 'd', label: 'D', type: 'repeater', controlKey: 'c4' }] },
      c4: { key: 'd', label: 'C4', type: 'repeater', itemFields: [{ key: 'e', label: 'E', type: 'repeater', controlKey: 'c5' }] },
      c5: { key: 'e', label: 'C5', type: 'repeater', itemFields: leaf === 'c5' ? [{ key: 'f', label: 'F', type: 'input' }] : [{ key: 'f', label: 'F', type: 'repeater', controlKey: 'c6' }] },
      c6: { key: 'f', label: 'C6', type: 'repeater', itemFields: [{ key: 'g', label: 'G', type: 'input' }] },
    })
    // 5 层引用链（c1..c5，c5 止于原子子字段）在默认上限内正常展开
    const five = mk('c5')
    const fields = normalizeFields([{ key: 'a', label: 'A', type: 'repeater', controlKey: 'c1' }])
    expect(expandFields(fields, (k) => five[k], { maxDepth: DEFAULT_COMPOSITE_DEPTH })).toHaveLength(1)
    // 6 层（c1..c6）超过默认 5 抛错
    const six = mk('c6')
    expect(() => expandFields(fields, (k) => six[k], { maxDepth: 5 })).toThrow(`超过配置上限（5 层）`)
    // 上限调大 / 无限制（0）时放行
    expect(expandFields(fields, (k) => six[k], { maxDepth: 10 })).toHaveLength(1)
    expect(expandFields(fields, (k) => six[k], { maxDepth: 0 })).toHaveLength(1)
  })
})

describe('normalizeCompositeDepth（表单设计工具配置归一化）', () => {
  it('合法值原样；0 = 无限制（Infinity）', () => {
    expect(normalizeCompositeDepth(5)).toBe(5)
    expect(normalizeCompositeDepth('3')).toBe(3)
    expect(normalizeCompositeDepth(0)).toBe(UNLIMITED_DEPTH)
    expect(normalizeCompositeDepth('0')).toBe(UNLIMITED_DEPTH)
  })
  it('非法 / 负数 / 非数字回落默认 5', () => {
    expect(normalizeCompositeDepth(undefined)).toBe(DEFAULT_COMPOSITE_DEPTH)
    expect(normalizeCompositeDepth(-1)).toBe(DEFAULT_COMPOSITE_DEPTH)
    expect(normalizeCompositeDepth('abc')).toBe(DEFAULT_COMPOSITE_DEPTH)
    expect(normalizeCompositeDepth(1.5)).toBe(1.5)
  })
})

describe('collectControlKeys / compositeDepth', () => {
  it('收集存储树全部引用键（含嵌套，去重）', () => {
    const fields = [{
      key: 'page', type: 'repeater', label: '页面',
      itemFields: [
        { key: 'c1', type: 'repeater', label: 'A', controlKey: 'contact-group' },
        { key: 'c2', type: 'repeater', label: 'B', controlKey: 'contact-group' },
      ],
    }]
    expect(collectControlKeys(fields)).toEqual(['contact-group'])
    expect(collectControlKeys(null)).toEqual([])
  })

  it('展开深度：原子表单 0；含容器/引用 ≥1', () => {
    const atoms = normalizeFields([{ key: 't', label: 'T', type: 'input' }])
    expect(compositeDepth(atoms, resolve)).toBe(0)
    const withRef = normalizeFields([{ key: 'team', label: '组', type: 'repeater', controlKey: 'contact-group' }])
    expect(compositeDepth(withRef, resolve)).toBeGreaterThanOrEqual(1)
  })
})
