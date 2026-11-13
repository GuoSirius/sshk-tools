import { describe, expect, it } from 'vitest'
import { asUtilityMessage, parseChildArgv, pickRegister } from './utility-protocol'

describe('utilityProcess 沙箱协议（#50 切片 1）', () => {
  it('消息守卫：非法载荷拒绝，合法载荷透传', () => {
    expect(asUtilityMessage(null)).toBeNull()
    expect(asUtilityMessage('x')).toBeNull()
    expect(asUtilityMessage({})).toBeNull()
    expect(asUtilityMessage({ t: 'no-such-type' })).toBeNull()
    const ok = asUtilityMessage({ t: 'ipc-invoke', reqId: 1, channel: 'llm:chat', args: [] })
    expect(ok).toEqual({ t: 'ipc-invoke', reqId: 1, channel: 'llm:chat', args: [] })
  })

  it('child argv 解析：取末三位（toolId / packageDir / mainFile）', () => {
    expect(parseChildArgv(['electron', 'x', 'toolId', 'pkgDir', 'main.js'])).toEqual({
      toolId: 'toolId', packageDir: 'pkgDir', mainFile: 'main.js',
    })
  })

  it('外部 main 契约：default / register 均可，其他判失败', () => {
    expect(typeof pickRegister({ default: () => {} })).toBe('function')
    expect(typeof pickRegister({ register: () => {} })).toBe('function')
    expect(pickRegister({ other: 1 })).toBeUndefined()
  })
})
