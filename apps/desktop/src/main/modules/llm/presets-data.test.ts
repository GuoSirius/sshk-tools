import { describe, expect, it } from 'vitest'
import { collectDefaultProviders } from '@sshk/shared'
import type { ToolDescriptor } from '@sshk/shared'
import { DEFAULT_PROVIDER_SEEDS, MODEL_MANAGER_PRESETS } from './presets-data'

/**
 * P4-8b（D53 · 台账#156）：模型默认预设数据断言（原断言在 shared tool-catalog.test，
 * 耦合 model-console 清单；清单随三工具退役后，数据搬入本文件所在模块，断言随迁）。
 */

describe('DEFAULT_PROVIDER_SEEDS（播种数据）', () => {
  it('默认就是 Agnes AI：合法 prv_ id + http(s) 端点，绝不含密钥字段', () => {
    expect(DEFAULT_PROVIDER_SEEDS.length).toBeGreaterThanOrEqual(1)
    // 与 main/migrations.ts seedDefaultProviders 同一消费形态：collectDefaultProviders 同构校验
    const seeds = collectDefaultProviders([
      { id: 'fixture', defaults: { defaultProviders: DEFAULT_PROVIDER_SEEDS } } as unknown as ToolDescriptor,
    ])
    expect(seeds[0]).toMatchObject({
      _id: 'prv_agnesai',
      baseURL: 'https://apihub.agnes-ai.com/v1',
      model: 'agnes-3.0-flash',
      enabled: true,
    })
    expect(seeds[0]!._id).toMatch(/^prv_[0-9a-z]+$/)
    for (const seed of DEFAULT_PROVIDER_SEEDS) {
      for (const field of Object.keys(seed)) {
        expect(['apiKey', 'token', 'secret', 'password']).not.toContain(field)
      }
    }
  })
})

describe('MODEL_MANAGER_PRESETS（快速预设 7 家）', () => {
  it('含常用端点与可选模型，且不含任何密钥字段', () => {
    expect(MODEL_MANAGER_PRESETS.length).toBeGreaterThanOrEqual(4)
    const agnes = MODEL_MANAGER_PRESETS.find((preset) => preset.id === 'agnes')
    expect(agnes?.baseURL).toBe('https://apihub.agnes-ai.com/v1')
    expect(agnes?.models).toContain('agnes-3.0-flash')
    expect(agnes?.models).toContain('agnes-3.0-pro')
    for (const preset of MODEL_MANAGER_PRESETS) {
      expect(preset.baseURL).toMatch(/^https?:\/\//)
      for (const field of Object.keys(preset)) {
        expect(['apiKey', 'token', 'secret', 'password']).not.toContain(field)
      }
    }
  })
})
