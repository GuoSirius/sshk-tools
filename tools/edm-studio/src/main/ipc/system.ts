import path from 'node:path'
import { promises as fs } from 'node:fs'
import * as yaml from 'js-yaml'
import { AppError } from '@sshk/shared'
import { loadEdmModel } from '../edm-manifest.js'
import { versionNumberOf } from '../edm-seed.js'
import { renderSystemPreview, renderSystemCompose, type SystemSelector } from '../../core/system-css.js'
import { SYSTEM_FILE_EXTS, type ActionHandler, type EdmIpcContext, type Payload } from './context'

/** 系统内容域 action（R3 只读模型 / R5·R19 预览渲染 / R12–R14 编辑门控 / R24 system:derive 派生） */
export function registerSystemActions(ctx: EdmIpcContext, handlers: Map<string, ActionHandler>): void {
  const { str, obj } = ctx

  // ── 系统内容模型（R3）：文件为源真相，构造内存模型供维护 UI 只读浏览 ──
  handlers.set('system:load', async () => loadEdmModel(ctx.resolveEdmRoot()))

  // ── 系统内容预览渲染（R5 就近 css + R19 组合预览：placements 非空 → 片段/模板统一组合入口） ──
  handlers.set('system:render', async (data: Payload) => {
    const sel = obj(data, 'selector') as unknown as SystemSelector
    if (!sel?.brandCode || !sel?.kind || !sel?.familyCode) throw new AppError('selector 需含 brandCode/kind/familyCode')
    const raw = Array.isArray(data['placements']) ? (data['placements'] as Payload[]) : []
    if (raw.length === 0) return await renderSystemPreview(ctx.resolveEdmRoot(), sel)
    return await renderSystemCompose(
      ctx.resolveEdmRoot(),
      sel,
      raw.map((p) => ({
        selector: p['selector'] as unknown as SystemSelector,
        slot: String(p['slot'] ?? ''),
        order: typeof p['order'] === 'number' ? p['order'] : undefined,
        repeat: typeof p['repeat'] === 'number' ? p['repeat'] : undefined,
        data: (p['data'] as Record<string, unknown> | undefined) ?? undefined,
      })),
    )
  })

  // ── 读取系统内容原文（只读；限制在 edm 根内，越权即拒） ──
  handlers.set('system:readFile', async (data: Payload) => {
    const root = ctx.resolveEdmRoot()
    const file = str(data, 'file')
    const abs = path.resolve(root, file)
    if (!abs.startsWith(root)) throw new AppError('越权读取系统文件', 'permission')
    try {
      return await fs.readFile(abs, 'utf8')
    } catch {
      return null
    }
  })

  // ── 系统内容编辑（R12–R14）：写/改名/删，全部过门控 + 根内限制 ──
  handlers.set('system:canEdit', async () => ({ canEdit: ctx.systemEditable() }))

  handlers.set('system:writeFile', async (data: Payload) => {
    ctx.assertSystemEditable()
    const root = ctx.resolveEdmRoot()
    const file = str(data, 'file')
    if (!SYSTEM_FILE_EXTS.has(path.extname(file))) throw new AppError(`不允许的文件类型：${path.extname(file) || '(无扩展名)'}`, 'io')
    const abs = ctx.confine(root, file)
    await fs.mkdir(path.dirname(abs), { recursive: true })
    await fs.writeFile(abs, String(data['content'] ?? ''), 'utf8')
    return true
  })

  handlers.set('system:rename', async (data: Payload) => {
    ctx.assertSystemEditable()
    const root = ctx.resolveEdmRoot()
    const file = str(data, 'file')
    const newName = str(data, 'newName').trim()
    if (!newName || /[/\\]|\.\./.test(newName)) throw new AppError('新名称非法（不得含路径分隔符）', 'io')
    const abs = ctx.confine(root, file)
    const dst = path.join(path.dirname(abs), newName)
    if (dst !== abs && !dst.startsWith(root + path.sep)) throw new AppError('越权路径', 'permission')
    let exists = false
    try {
      await fs.access(dst)
      exists = true
    } catch {
      /* 不存在即目标可用 */
    }
    if (exists) throw new AppError(`「${newName}」已存在，请先处理同名冲突`, 'io')
    await fs.rename(abs, dst)
    return ctx.relOf(dst)
  })

  handlers.set('system:remove', async (data: Payload) => {
    ctx.assertSystemEditable()
    const root = ctx.resolveEdmRoot()
    const abs = ctx.confine(root, str(data, 'file'))
    if (abs === root) throw new AppError('不能删除 EDM 根目录', 'io')
    let exists = false
    try {
      await fs.access(abs)
      exists = true
    } catch {
      /* 不存在即视为已删除（幂等，避免 ENOENT，#7） */
    }
    if (exists) await fs.rm(abs, { recursive: true, force: true })
    return true
  })

  // ── R24 system:derive：系统内容 → 自定义文件根（custom-edm）整棵拷贝，文件为真相源 ──
  // kind: brand=品牌下全部族+版本；family=单族+版本；version=单版本。
  // 目标品牌代码取 name（brand 级）/ target 首段（family/version 级，缺省回落源品牌）。
  handlers.set('system:derive', async (data: Payload) => {
    const source = 'system'
    const targetSource = 'custom'
    const kind = str(data, 'kind')
    const name = str(data, 'name').trim()
    const brandCode = str(data, 'brandCode')
    const cat = str(data, 'cat') === 'template' ? 'template' : 'fragment'
    const familyCode = str(data, 'familyCode')
    const versionDir = str(data, 'versionDir')
    const target = str(data, 'target')
    if (!name) throw new AppError('名称必填')
    const root = ctx.resolveContentRoot(source)
    const customRoot = ctx.resolveContentRoot(targetSource)
    const model = await loadEdmModel(root)
    const srcBrand = model.brands.find((b) => b.code === brandCode)
    if (!srcBrand) throw new AppError(`系统品牌「${brandCode}」不存在`, 'io')
    const counts = { brands: 0, fragments: 0, fragmentVersions: 0, templates: 0, templateVersions: 0 }
    const copyTree = async (srcRel: string, dstRel: string): Promise<void> => {
      const srcAbs = path.resolve(root, srcRel)
      let st: Awaited<ReturnType<typeof fs.stat>> | null = null
      try {
        st = await fs.stat(srcAbs)
      } catch {
        return
      }
      if (st.isDirectory()) {
        const entries = await fs.readdir(srcAbs)
        for (const e of entries) await copyTree(`${srcRel}/${e}`, `${dstRel}/${e}`)
      } else {
        const dstAbs = path.resolve(customRoot, dstRel)
        await fs.mkdir(path.dirname(dstAbs), { recursive: true })
        await fs.copyFile(srcAbs, dstAbs)
      }
    }
    const patchMeta = async (rel: string, patch: Record<string, unknown>): Promise<void> => {
      const abs = path.resolve(customRoot, `${rel}/meta.yaml`)
      let meta: Record<string, unknown> = {}
      try {
        meta = (yaml.load(await fs.readFile(abs, 'utf8')) as Record<string, unknown>) ?? {}
      } catch {
        /* 无 meta 则基于补丁新建 */
      }
      await fs.mkdir(path.dirname(abs), { recursive: true })
      await fs.writeFile(abs, yaml.dump({ ...meta, ...patch }, { lineWidth: -1 }), 'utf8')
    }
    const targetBrandCode = (target.split('/')[0] ?? '').trim() || brandCode
    if (kind === 'brand') {
      const dstBrand = name
      await copyTree(`${brandCode}/fragment`, `${dstBrand}/fragment`)
      await copyTree(`${brandCode}/template`, `${dstBrand}/template`)
      await copyTree(`${brandCode}/css`, `${dstBrand}/css`)
      await copyTree(`${brandCode}/meta.yaml`, `${dstBrand}/meta.yaml`)
      await patchMeta(dstBrand, { code: dstBrand, name })
      counts.brands++
    } else if (kind === 'family') {
      const dstBrand = targetBrandCode
      const fam = (cat === 'template' ? srcBrand.templates : srcBrand.fragments).find((f) => f.code === familyCode)
      if (!fam) throw new AppError(`系统${cat === 'template' ? '模板' : '片段'}族「${familyCode}」不存在`, 'io')
      await copyTree(`${brandCode}/${cat}/${familyCode}`, `${dstBrand}/${cat}/${name}`)
      await patchMeta(`${dstBrand}/${cat}/${name}`, { code: name, name })
      if (cat === 'template') counts.templates++
      else counts.fragments++
    } else if (kind === 'version') {
      const dstBrand = targetBrandCode
      const fam = (cat === 'template' ? srcBrand.templates : srcBrand.fragments).find((f) => f.code === familyCode)
      const v = fam?.versions.find((x) => x.dir === versionDir)
      if (!fam || !v) throw new AppError(`系统${cat === 'template' ? '模板' : '片段'}版本「${familyCode}/${versionDir || 'default'}」不存在`, 'io')
      await copyTree(`${brandCode}/${cat}/${familyCode}/${versionDir}`, `${dstBrand}/${cat}/${familyCode}/${name}`)
      await patchMeta(`${dstBrand}/${cat}/${familyCode}/${name}`, { code: name, name, version: versionNumberOf(name, v.meta.version) })
      if (cat === 'template') counts.templateVersions++
      else counts.fragmentVersions++
    } else {
      throw new AppError(`非法 kind: ${kind}`)
    }
    return counts
  })
}
