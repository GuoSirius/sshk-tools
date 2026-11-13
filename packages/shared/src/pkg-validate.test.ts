import { describe, expect, it } from 'vitest'
import type { ToolDescriptor, ToolPackageContract } from './types'
import {
  PACKAGE_FILE_LIMIT,
  assertAllowedFiles,
  checkZipSlip,
  validateToolPackage,
} from './pkg-validate'

describe('.sshktool 导入包校验（阶段一）', () => {
  it('Zip Slip：拒绝绝对路径 / 盘符 / 反斜杠 / 穿越，放行正常条目', () => {
    expect(checkZipSlip('tool.manifest.json')).toBeNull()
    expect(checkZipSlip('src/renderer/Page.vue')).toBeNull()
    expect(checkZipSlip('')).toContain('空条目')
    expect(checkZipSlip('D:/evil.json')).toContain('盘符')
    expect(checkZipSlip('/etc/passwd')).toContain('绝对引用')
    expect(checkZipSlip('src\\evil.vue')).toContain('反斜杠')
    expect(checkZipSlip('../evil.json')).toContain('穿越')
    expect(checkZipSlip('src//evil.vue')).toContain('空路径段')
  })

  it('文件白名单：扩展名 / 文件数 / 单文件与总体积上限', () => {
    expect(assertAllowedFiles([{ name: 'tool.manifest.json', size: 10 }])).toHaveLength(0)
    const errors = assertAllowedFiles([
      { name: 'evil.sh', size: 1 },
      { name: '/abs.json', size: 1 },
      { name: 'big.json', size: 51 * 1024 * 1024 },
      ...Array.from({ length: PACKAGE_FILE_LIMIT + 1 }, (_, i) => ({ name: `f${i}.json`, size: 1 })),
    ])
    expect(errors.some((e) => e.includes('evil.sh'))).toBe(true)
    expect(errors.some((e) => e.includes('绝对引用'))).toBe(true)
    expect(errors.some((e) => e.includes('单文件超 50MB'))).toBe(true)
    expect(errors.some((e) => e.includes('文件数超上限'))).toBe(true)
    expect(assertAllowedFiles([])).toEqual(['包内没有任何文件'])
  })

  it('契约校验：外部包必须带 package，main 必须带签名，通道必须已声明', () => {
    const basePkg: ToolPackageContract = {
      schemaVersion: 1,
      version: '1.0.0',
      requiresHost: { api: '^1.0', capabilities: [] },
      sandbox: 'utility',
      ipcAllowlist: ['llm:providers'],
    }
    const base: Partial<ToolDescriptor> = {
      id: 'third-party',
      name: '第三方',
      description: '外部开发者提供',
      menus: [{ id: 'home', label: '首页' }],
      package: basePkg,
    }
    const joined = (errors: string[]) => errors.join(' | ')
    expect(validateToolPackage(base)).toHaveLength(0)
    expect(joined(validateToolPackage({ ...base, package: undefined }))).toContain('必须声明 package 契约')
    expect(joined(validateToolPackage({ ...base, package: { ...basePkg, schemaVersion: 99 } })))
      .toContain('schemaVersion 99')
    expect(joined(validateToolPackage({ ...base, package: { ...basePkg, sandbox: 'main' } })))
      .toContain('main 权限必须带签名')
    expect(joined(validateToolPackage({ ...base, package: { ...basePkg, ipcAllowlist: ['evil:chan'] } })))
      .toContain('未声明的 IPC 通道: evil:chan')
    expect(validateToolPackage({ id: 'Bad_ID' }).length).toBeGreaterThan(1)
  })
})
