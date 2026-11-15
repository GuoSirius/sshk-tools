import { describe, expect, it } from 'vitest'
import { UploadService } from './service'
import { mergeValidation, validateFile } from './validation'
import { mapWithConcurrency, withRetry } from './concurrency'
import type { UploadFile, UploadProgress, UploadProvider } from './types'

const ctx = { targetType: 'local' as const }

function file(name: string, size = 10): UploadFile {
  return { name, size }
}

function echoProvider(): UploadProvider {
  return {
    type: 'local',
    async upload(f) { return { url: `file:///${f.name}`, name: f.name } },
  }
}

describe('校验收紧', () => {
  it('扩展名取交集、大小取更小值，工具不能放宽', () => {
    const rule = mergeValidation(
      { accept: ['.png', '.jpg', '.gif'], maxSize: 1000 },
      { accept: ['.jpg', '.webp'], maxSize: 500 },
    )
    expect(rule.accept).toEqual(['.jpg'])
    expect(rule.maxSize).toBe(500)

    const relaxed = mergeValidation({ accept: ['.png'], maxSize: 100 }, { accept: ['.png', '.exe'], maxSize: 9999 })
    expect(relaxed.accept).toEqual(['.png'])
    expect(relaxed.maxSize).toBe(100)
  })

  it('全局不限制时工具仍可设限', () => {
    const rule = mergeValidation({}, { accept: ['.PNG'], maxSize: 20 })
    expect(rule.accept).toEqual(['.png'])
    expect(rule.maxSize).toBe(20)
    expect(validateFile(file('a.png', 21), rule).ok).toBe(false)
  })

  it('拒绝不合规文件并给出原因', () => {
    const rule = mergeValidation({ accept: ['.png'], maxSize: 100 })
    expect(validateFile(file('a.exe'), rule)).toMatchObject({ ok: false })
    expect(validateFile(file('a.png', 101), rule)).toMatchObject({ ok: false })
    expect(validateFile(file('a.png', 100), rule)).toEqual({ ok: true })
  })
})

describe('并发与重试', () => {
  it('并发不超过上限且保持输入顺序', async () => {
    let active = 0
    let peak = 0
    const results = await mapWithConcurrency([1, 2, 3, 4, 5], 2, async (n) => {
      active++
      peak = Math.max(peak, active)
      await new Promise((r) => setTimeout(r, 5))
      active--
      return n * 2
    })
    expect(results).toEqual([2, 4, 6, 8, 10])
    expect(peak).toBe(2)
  })

  it('按 retries 重试后成功', async () => {
    let calls = 0
    const value = await withRetry(async () => {
      calls++
      if (calls < 3) throw new Error('临时失败')
      return 'ok'
    }, 2)
    expect(value).toBe('ok')
    expect(calls).toBe(3)
  })
})

describe('UploadService', () => {
  it('单文件上传并发出 uploading / success 进度', async () => {
    const events: UploadProgress[] = []
    const service = new UploadService({ onProgress: (p) => events.push(p) })
    service.register(echoProvider())
    const result = await service.upload(file('a.png'), ctx)
    expect(result.url).toBe('file:///a.png')
    expect(events.map((e) => e.status)).toEqual(['uploading', 'success'])
  })

  it('批量整批校验前置：第二个文件不合规时一个都不上传', async () => {
    let uploads = 0
    const provider: UploadProvider = {
      type: 'local',
      async upload(f) { uploads++; return { url: f.name, name: f.name } },
    }
    const service = new UploadService({ validation: { accept: ['.png'] } })
    service.register(provider)
    await expect(service.uploadBatch([file('a.png'), file('b.exe')], ctx)).rejects.toThrow('文件类型不允许')
    expect(uploads).toBe(0)
  })

  it('批量失败重试：第一次失败、第二次成功', async () => {
    let attempts = 0
    const provider: UploadProvider = {
      type: 'local',
      async upload(f) {
        attempts++
        if (attempts === 1) throw new Error('网络抖动')
        return { url: `file:///${f.name}`, name: f.name }
      },
    }
    const events: UploadProgress[] = []
    const service = new UploadService({ retries: 1 })
    service.register(provider)
    const results = await service.uploadBatch([file('a.png')], ctx, { onProgress: (p) => events.push(p) })
    expect(results).toHaveLength(1)
    expect(attempts).toBe(2)
    expect(events.some((e) => e.status === 'success')).toBe(true)
  })

  it('未注册 Provider 时明确报错', async () => {
    const service = new UploadService()
    await expect(service.upload(file('a.png'), ctx)).rejects.toThrow('未注册 local 上传 Provider')
  })
})
