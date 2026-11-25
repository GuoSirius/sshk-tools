import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { TemplateLoader, memTemplateName, resolveTemplatePath, type TemplateRoots } from './template-loader'
import { renderMail } from './render'

const dirs: string[] = []
function tmp(): string {
  const d = mkdtempSync(path.join(tmpdir(), 'sshk-tpl-loader-'))
  dirs.push(d)
  return d
}
function put(file: string, content: string): void {
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, content)
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

function rootsOf(root: string): TemplateRoots {
  return {
    systemRoot: path.join(root, 'system'),
    customRoot: path.join(root, 'custom'),
    sourceRoot: path.join(root, 'custom'),
    versionDir: path.join(root, 'custom/elab/template/std/v1'),
  }
}

describe('模板 loader 逻辑 URI（需求 2）', () => {
  it('@system/@custom/@root/./ 前缀解析到对应根', () => {
    const root = tmp()
    const r = rootsOf(root)
    expect(resolveTemplatePath('@system/base/master.njk', r)).toBe(path.join(r.systemRoot, 'base/master.njk'))
    expect(resolveTemplatePath('@custom/x.njk', r)).toBe(path.join(r.customRoot, 'x.njk'))
    expect(resolveTemplatePath('@root/y.njk', r)).toBe(path.join(r.sourceRoot, 'y.njk'))
    expect(resolveTemplatePath('./css/z.njk', r)).toBe(path.join(r.versionDir, 'css/z.njk'))
  })

  it('允许 .. 上溯但兜底限根内；越界拒绝；外链拒绝', () => {
    const root = tmp()
    const r = rootsOf(root)
    expect(resolveTemplatePath('@system/base/../master.njk', r)).toBe(path.join(r.systemRoot, 'master.njk'))
    expect(() => resolveTemplatePath('@system/../../outside.njk', r)).toThrow('越出')
    expect(resolveTemplatePath('https://x/y.njk', r)).toBeNull()
  })

  it('磁盘优先、内存回落（Q2）', () => {
    const root = tmp()
    const r = rootsOf(root)
    const mem = new Map<string, string>()
    const key = memTemplateName('child')
    mem.set('child', '<b>from-memory</b>')
    const loader = new TemplateLoader(r, mem)
    // 内存命中
    expect(loader.getSource(key)?.src).toBe('<b>from-memory</b>')
    // 磁盘命中
    const disk = path.join(r.systemRoot, 'disk.njk')
    put(disk, '<i>from-disk</i>')
    expect(loader.getSource('@system/disk.njk')?.src).toBe('<i>from-disk</i>')
    // 都不存在 → nunjucks Loader 契约抛 Template not found
    expect(() => loader.getSource('@system/nope.njk')).toThrow('Template not found')
  })
})

describe('extends / include 跨文件渲染（需求 2）', () => {
  it('extends 母版 + block 覆盖走 loader 解析 @system 路径', async () => {
    const root = tmp()
    const r = rootsOf(root)
    put(path.join(r.systemRoot, 'base/master.njk'), '<html><head>{{ meta.favicon }}</head><body>{% block content %}默认{% endblock %}</body></html>')
    const stages = await renderMail({
      templateHtml: "{% extends '@system/base/master.njk' %}{% block content %}子模板内容{% endblock %}",
      bindings: {},
      data: {},
      render: { strict: false, autoEscape: true },
      roots: r,
      meta: { brand: { code: 'b', name: 'B', favicon: 'x.ico' } },
    })
    expect(stages.assembled).toContain('x.ico')
    expect(stages.assembled).toContain('子模板内容')
    expect(stages.assembled).not.toContain('默认')
  })

  it('磁盘优先：templateName 提供时以磁盘源码为准', async () => {
    const root = tmp()
    const r = rootsOf(root)
    put(path.join(r.customRoot, 'main.njk'), '<p>磁盘源码</p>')
    const stages = await renderMail({
      templateHtml: '<p>内存源码</p>',
      bindings: {},
      data: {},
      render: { strict: false, autoEscape: true },
      roots: r,
      templateName: '@root/main.njk',
    })
    expect(stages.assembled).toContain('磁盘源码')
    expect(stages.assembled).not.toContain('内存源码')
  })

  it('include 嵌套解析（内存注册子模板）', async () => {
    const root = tmp()
    const r = rootsOf(root)
    const mem = new Map<string, string>()
    mem.set('frag', '<em>{{ title }}</em>')
    const stages = await renderMail({
      templateHtml: `<div>{% include '${memTemplateName('frag')}' %}</div>`,
      bindings: {},
      data: { title: '嵌套' },
      render: { strict: false, autoEscape: true },
      roots: r,
      memoryTemplates: mem,
    })
    expect(stages.assembled).toContain('<em>嵌套</em>')
  })
})
