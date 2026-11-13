import { describe, expect, it } from 'vitest'
import { toPlain } from './plain'

/** 模拟 Vue reactive：访问嵌套对象时继续返回 Proxy */
function reactive<T extends object>(target: T): T {
  return new Proxy(target, {
    get(obj, key, receiver) {
      const value = Reflect.get(obj, key, receiver)
      return value !== null && typeof value === 'object' ? reactive(value as object) : value
    },
  })
}

describe('IPC 参数脱壳（An object could not be cloned 回归）', () => {
  it('Vue 响应式 Proxy 脱壳后可被结构化克隆，且值不变', () => {
    const source = reactive({
      providers: [
        { _id: 'prv_agnes', name: 'Agnes AI', baseURL: 'https://apihub.agnes-ai.com/v1', enabled: true },
        { _id: 'prv_ollama', name: 'Ollama', baseURL: 'http://127.0.0.1:11434/v1', enabled: false },
      ],
      count: 2,
    })

    // 复现原报错：Proxy 无法结构化克隆
    expect(() => structuredClone(source)).toThrow(/could not be cloned/)

    const plain = toPlain(source)
    expect(() => structuredClone(plain)).not.toThrow()
    expect(plain).toEqual({
      providers: [
        { _id: 'prv_agnes', name: 'Agnes AI', baseURL: 'https://apihub.agnes-ai.com/v1', enabled: true },
        { _id: 'prv_ollama', name: 'Ollama', baseURL: 'http://127.0.0.1:11434/v1', enabled: false },
      ],
      count: 2,
    })
  })

  it('数组 / 嵌套对象 / undefined / 函数字段都安全', () => {
    const source = reactive({
      rows: [{ url: 'https://a.com', clicks: 5 }, { url: 'https://b.com', clicks: 'S' }],
      nested: { vision: { provider: 'cloud', model: 'agnes-3.0-flash' } },
      missing: undefined,
      callback: () => 'never cross IPC',
    })
    const plain = toPlain(source)
    expect(() => structuredClone(plain)).not.toThrow()
    expect(plain).toEqual({
      rows: [{ url: 'https://a.com', clicks: 5 }, { url: 'https://b.com', clicks: 'S' }],
      nested: { vision: { provider: 'cloud', model: 'agnes-3.0-flash' } },
    })
  })

  it('循环引用不死循环，原始值原样透传', () => {
    const node: Record<string, unknown> = { name: 'root' }
    node['self'] = node
    expect(() => toPlain(node)).not.toThrow()
    const plain = toPlain(node) as Record<string, unknown>
    expect(plain['name']).toBe('root')
    expect(plain['self']).toBe(plain)
    expect(toPlain(undefined)).toBeUndefined()
    expect(toPlain('hello')).toBe('hello')
    expect(toPlain(42)).toBe(42)
  })
})
