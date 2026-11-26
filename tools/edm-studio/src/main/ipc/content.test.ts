/**
 * content:* 域门控与示例数据覆盖层测试（2026-11-24 #189）：
 * 只读系统内容（打包版未开 developerMode）——sample.yaml 写落覆盖层、meta 等设计文件拒写、
 * listDir 只读放行、render 读覆盖层示例数据；dev/developerMode 恒直写系统根（行为不变）。
 * ctx 用受控桩（临时目录三根），electron 以 vi.mock 桩阻断（context.ts 顶层 import { app }）。
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppError } from '@sshk/shared'
import { registerContentActions } from './content'
import type { ActionHandler, EdmIpcContext, Payload } from './context'

vi.mock('electron', () => ({ app: { getPath: () => '.' } }))

/** 与 context.ts 同口径的受控桩：str/obj/confine 原样，三根指向临时目录 */
function makeCtx(opts: { editable: boolean; systemRoot: string; customRoot: string; overrideRoot: string }): EdmIpcContext {
  const str = (p: Payload, key: string): string => String(p[key] ?? '')
  const obj = (p: Payload, key: string): Payload => (p[key] as Payload) ?? {}
  return {
    repo: {} as never,
    outputRoot: '',
    config: undefined,
    str,
    obj,
    assertMutable: async () => {},
    systemEditable: () => opts.editable,
    assertSystemEditable: () => {
      if (!opts.editable) throw new AppError('系统内容在当前模式下只读（打包版需开启开发者模式）')
    },
    confine: (root: string, file: string): string => {
      const rootAbs = path.resolve(root)
      const abs = path.resolve(rootAbs, file)
      if (abs !== rootAbs && !abs.startsWith(rootAbs + path.sep)) throw new AppError('越权路径', 'permission')
      return abs
    },
    resolveEdmRoot: () => opts.systemRoot,
    resolveContentRoot: (source: string): string => (source === 'custom' ? opts.customRoot : opts.systemRoot),
    resolveOverrideRoot: () => opts.overrideRoot,
    relOf: (file: string): string => file,
  }
}

const dirs: string[] = []
function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), `sshk-edm-ipc-${prefix}-`))
  dirs.push(dir)
  return dir
}

let roots: { system: string; custom: string; override: string } = { system: '', custom: '', override: '' }

beforeEach(() => {
  roots = { system: tempDir('sys'), custom: tempDir('cus'), override: tempDir('ovr') }
})
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function handlersOf(editable: boolean): Map<string, ActionHandler> {
  const handlers = new Map<string, ActionHandler>()
  registerContentActions(
    makeCtx({ editable, systemRoot: roots.system, customRoot: roots.custom, overrideRoot: roots.override }),
    handlers,
  )
  return handlers
}

const SAMPLE = 'elab/fragment/banner/v1/sample.yaml'

describe('content:writeFile 门控收窄（#189）', () => {
  it('只读系统内容：sample.yaml 落覆盖层，系统根零写入', async () => {
    await handlersOf(false).get('content:writeFile')!({ source: 'system', file: SAMPLE, content: 'title: 改过' })
    expect(readFileSync(path.join(roots.override, SAMPLE), 'utf8')).toBe('title: 改过')
    expect(existsSync(path.join(roots.system, 'elab'))).toBe(false)
  })

  it('只读系统内容：meta.yaml 等设计文件仍拒写（设计只读）', async () => {
    await expect(
      handlersOf(false).get('content:writeFile')!({ source: 'system', file: 'elab/fragment/banner/meta.yaml', content: 'code: banner\nname: 横幅' }),
    ).rejects.toThrow('只读')
    expect(existsSync(path.join(roots.system, 'elab'))).toBe(false)
  })

  it('只读系统内容：非法 YAML 的 sample.yaml 拒写（后端第二层校验）', async () => {
    await expect(
      handlersOf(false).get('content:writeFile')!({ source: 'system', file: SAMPLE, content: 'title: [1, oops' }),
    ).rejects.toThrow('YAML')
    expect(await handlersOf(false).get('content:sampleOverrideState')!({ source: 'system', file: SAMPLE })).toEqual({ overridden: false })
  })

  it('dev/developerMode 可编辑：sample.yaml 仍直写系统根（行为不变，不落覆盖层）', async () => {
    await handlersOf(true).get('content:writeFile')!({ source: 'system', file: SAMPLE, content: 'title: dev 直写' })
    expect(readFileSync(path.join(roots.system, SAMPLE), 'utf8')).toBe('title: dev 直写')
    expect(existsSync(path.join(roots.override, 'elab'))).toBe(false)
  })

  it('自定义根恒可写：meta.yaml 照常落自定义根', async () => {
    await handlersOf(false).get('content:writeFile')!({ source: 'custom', file: 'my/meta.yaml', content: 'code: my\nname: 自定义' })
    expect(readFileSync(path.join(roots.custom, 'my/meta.yaml'), 'utf8')).toContain('code: my')
  })
})

describe('content:readFile 覆盖层优先', () => {
  it('覆盖命中返回覆盖内容；未覆盖文件回落系统根；无文件返回 null', async () => {
    mkdirSync(path.join(roots.system, path.dirname(SAMPLE)), { recursive: true })
    writeFileSync(path.join(roots.system, SAMPLE), 'title: 原始')
    const h = handlersOf(false)
    await h.get('content:writeFile')!({ source: 'system', file: SAMPLE, content: 'title: 改过' })
    expect(await h.get('content:readFile')!({ source: 'system', file: SAMPLE })).toBe('title: 改过')
    expect(await h.get('content:readFile')!({ source: 'system', file: 'elab/fragment/banner/v1/banner.njk' })).toBeNull()
  })

  it('覆盖删除后回落系统根原文（恢复默认生效）', async () => {
    mkdirSync(path.join(roots.system, path.dirname(SAMPLE)), { recursive: true })
    writeFileSync(path.join(roots.system, SAMPLE), 'title: 原始')
    const h = handlersOf(false)
    await h.get('content:writeFile')!({ source: 'system', file: SAMPLE, content: 'title: 改过' })
    await h.get('content:resetSampleOverride')!({ source: 'system', file: SAMPLE })
    expect(await h.get('content:readFile')!({ source: 'system', file: SAMPLE })).toBe('title: 原始')
  })
})

describe('content:listDir 只读放行', () => {
  it('只读系统内容列目录不再要求编辑门控（另存为跨根复制依赖）', async () => {
    mkdirSync(path.join(roots.system, 'elab/fragment/banner/v1/css'), { recursive: true })
    writeFileSync(path.join(roots.system, 'elab/fragment/banner/v1/css/a.css'), '.a{}')
    const files = (await handlersOf(false).get('content:listDir')!({ source: 'system', dir: 'elab/fragment/banner/v1' })) as string[]
    expect(files).toEqual(['css/a.css'])
  })
})

describe('content:render 读覆盖层示例数据（预览反映改动）', () => {
  const sel = { brandCode: 'elab', kind: 'fragment', familyCode: 'banner', versionDir: 'v1' }

  it('单渲：覆盖层 sample 替代系统根 sample', async () => {
    const dir = path.join(roots.system, 'elab/fragment/banner/v1')
    mkdirSync(dir, { recursive: true })
    writeFileSync(path.join(dir, 'banner.njk'), '<div>{{ title }}</div>')
    writeFileSync(path.join(dir, 'sample.yaml'), 'title: 原始')
    const h = handlersOf(false)
    await h.get('content:writeFile')!({ source: 'system', file: SAMPLE, content: 'title: 改过' })
    const res = (await h.get('content:render')!({ source: 'system', selector: sel })) as { html: string }
    expect(res.html).toContain('改过')
    expect(res.html).not.toContain('原始')
  })

  it('组合：placement 无独立数据时用覆盖层 sample', async () => {
    const tplDir = path.join(roots.system, 'elab/template/standard/v1')
    const fragDir = path.join(roots.system, 'elab/fragment/banner/v1')
    mkdirSync(tplDir, { recursive: true })
    mkdirSync(fragDir, { recursive: true })
    writeFileSync(path.join(tplDir, 'standard.njk'), '<table><tr><td>{{ slot_body | safe }}</td></tr></table>')
    writeFileSync(path.join(fragDir, 'banner.njk'), '<p>{{ title }}</p>')
    writeFileSync(path.join(fragDir, 'sample.yaml'), 'title: 原始')
    const h = handlersOf(false)
    await h.get('content:writeFile')!({ source: 'system', file: SAMPLE, content: 'title: 改过' })
    const res = (await h.get('content:render')!({
      source: 'system',
      selector: { brandCode: 'elab', kind: 'template', familyCode: 'standard', versionDir: 'v1' },
      placements: [{ selector: sel, slot: 'body' }],
    })) as { html: string }
    expect(res.html).toContain('改过')
    expect(res.html).not.toContain('原始')
  })

  it('#212 组合：模板示例数据平铺变量与片段 template.* 同时生效', async () => {
    const tplDir = path.join(roots.system, 'elab/template/standard/v1')
    const fragDir = path.join(roots.system, 'elab/fragment/header/v1')
    mkdirSync(tplDir, { recursive: true })
    mkdirSync(fragDir, { recursive: true })
    writeFileSync(path.join(tplDir, 'standard.njk'),
      '<table><colgroup><col width="{{ leftGap }}" /></colgroup><tr><td>{{ slot_header | safe }}</td></tr></table>')
    writeFileSync(path.join(tplDir, 'sample.yaml'), 'leftGap: 12\n')
    writeFileSync(path.join(fragDir, 'header.njk'), '<b>{{ template.leftGap }}</b>')
    const res = (await handlersOf(false).get('content:render')!({
      source: 'system',
      selector: { brandCode: 'elab', kind: 'template', familyCode: 'standard', versionDir: 'v1' },
      placements: [{ selector: { brandCode: 'elab', kind: 'fragment', familyCode: 'header', versionDir: 'v1' }, slot: 'header' }],
    })) as { html: string }
    expect(res.html).toContain('width="12"')
    expect(res.html).toContain('<b>12</b>')
    expect(res.html).not.toContain('{{ leftGap }}')
  })
})

describe('content:sampleOverrideState / resetSampleOverride 闭环', () => {
  it('无覆盖 false → 写入 true → reset true → 再查 false；自定义根恒 false', async () => {
    const h = handlersOf(false)
    expect(await h.get('content:sampleOverrideState')!({ source: 'system', file: SAMPLE })).toEqual({ overridden: false })
    expect(await h.get('content:sampleOverrideState')!({ source: 'custom', file: SAMPLE })).toEqual({ overridden: false })
    await h.get('content:writeFile')!({ source: 'system', file: SAMPLE, content: 'title: 改过' })
    expect(await h.get('content:sampleOverrideState')!({ source: 'system', file: SAMPLE })).toEqual({ overridden: true })
    expect(await h.get('content:resetSampleOverride')!({ source: 'system', file: SAMPLE })).toEqual({ reset: true })
    expect(await h.get('content:sampleOverrideState')!({ source: 'system', file: SAMPLE })).toEqual({ overridden: false })
    expect(await h.get('content:resetSampleOverride')!({ source: 'system', file: SAMPLE })).toEqual({ reset: false })
  })
})
