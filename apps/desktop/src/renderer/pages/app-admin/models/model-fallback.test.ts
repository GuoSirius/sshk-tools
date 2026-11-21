import { describe, expect, it } from 'vitest'
import { applyFallbackModels } from './model-fallback'

/** D-T1：锁死 401 回退行为——预设命中合并、未命中原样、空模型补默认，绝不抛错 */
describe('applyFallbackModels（/models 401 预设回退）', () => {
  const preset = { models: ['model-a', 'model-b'], defaultModel: 'model-a' }

  it('预设命中：合并模型（去重）+ 空模型补默认', () => {
    const res = applyFallbackModels(['model-a', 'model-x'], '', preset)
    expect(res.modelOptions).toEqual(['model-a', 'model-x', 'model-b'])
    expect(res.model).toBe('model-a')
  })

  it('已填模型保持不变，只合并选项', () => {
    const res = applyFallbackModels([], 'my-model', preset)
    expect(res.modelOptions).toEqual(['model-a', 'model-b'])
    expect(res.model).toBe('my-model')
  })

  it('无 defaultModel 时回退第一个预设模型', () => {
    const res = applyFallbackModels([], '', { models: ['m1', 'm2'] })
    expect(res.model).toBe('m1')
  })

  it('未命中预设：原样返回不改动（手填路径不受影响）', () => {
    const res = applyFallbackModels(['kept'], 'kept', undefined)
    expect(res).toEqual({ modelOptions: ['kept'], model: 'kept' })
  })

  it('空预设也不抛错', () => {
    expect(applyFallbackModels([], '', { models: [] })).toEqual({ modelOptions: [], model: '' })
  })
})
