import { app } from 'electron'
import path from 'node:path'
import { existsSync, promises as fs } from 'node:fs'
import { zipSync } from 'fflate'
import { AppError, EDM_OUTPUT_FILES, TOOL_IDS, now } from '@sshk/shared'
import {
  edmOutputRel,
  readOutput,
  writeOutput,
  outputSnapshotOptions,
  type Mail,
  type TemplateVersion,
  type FragmentVersion,
} from '@sshk/repository'

import { compose, type ComposePlacement } from '../../core/compose.js'
import { resolveCssBundle } from '../../core/css-resolve.js'
import type { ActionHandler, EdmIpcContext, Payload } from './context'

/** 邮件域 action（R19 统一组合引擎；产物覆盖式 D19）+ 产物根分享解析（plans/09 ShareHub） */
export function registerMailActions(ctx: EdmIpcContext, handlers: Map<string, ActionHandler>): void {
  const { repo, str, obj } = ctx

  /**
   * 生成/预览共用的 css 解析（plans/14 批次 0）：
   * 按实体 origin 推导解析根（system → 系统根 / custom → 自定义根），
   * 版本目录由确定性 ID + label 推导，支撑 njk 中 `./css/…` 与 `@root/…` 引用；
   * 无 link 时回退播种快照 source.css，与内容页预览同源同序。
   */
  async function resolveEntitiesCss(
    entries: Array<{ entity: FragmentVersion | TemplateVersion; kind: 'fragment' | 'template' }>,
  ): Promise<{ css: string; htmls: string[] }> {
    const sources = entries.map(({ entity, kind }) => {
      const isCustom = entity.origin === 'custom'
      const sourceRoot = ctx.resolveContentRoot(isCustom ? 'custom' : 'system')
      const parts = entity._id.split('_')
      const prefix = kind === 'fragment' ? (isCustom ? 'frgv' : 'frg') : (isCustom ? 'tplv' : 'tpl')
      const pos = parts.indexOf(prefix)
      const start = pos >= 0 ? pos + (isCustom ? 1 : 2) : -1
      const brandCode = start >= 0 ? (parts[start] ?? '') : ''
      const familyCode = start >= 0 ? parts.slice(start + 1).join('_') : ''
      const versionDir = path.join(sourceRoot, brandCode, kind, familyCode, entity.label || 'default')
      if (!brandCode || !familyCode) console.warn(`[edm] 版本 ${entity._id} 无法推导 css 解析目录，回退播种快照`)
      return {
        html: entity.source.html,
        ctx: {
          sourceRoot,
          systemRoot: ctx.resolveContentRoot('system'),
          customRoot: ctx.resolveContentRoot('custom'),
          versionDir,
        },
        fallbackCss: entity.source.cssMode === 'inline' ? entity.source.css : undefined,
      }
    })
    const bundle = await resolveCssBundle({ sources, outputRoot: ctx.outputRoot, unoEnabled: true })
    for (const w of bundle.warnings) console.warn(`[edm] css 引用警告：${w}`)
    return { css: bundle.css, htmls: bundle.htmls }
  }

  /**
   * 跨品牌硬规定（2026-11-23）：片段不得跨品牌搭配模板。
   * 落库 / 生成 / 预览前校验 bindings 片段品牌 === 目标品牌。
   * 只校验"有 brandId 的片段"，历史空 brandId 不误杀、也不做迁移兼容。
   */
  async function assertBindingsSameBrand(brandId: string, bindings: { fragmentVersionId: string }[]): Promise<void> {
    if (!brandId) return
    for (const b of bindings) {
      const fv = await repo.get<FragmentVersion>('fragmentVersions', b.fragmentVersionId)
      if (fv?.brandId && fv.brandId !== brandId) {
        throw new AppError('片段与模板不属于同一品牌，禁止跨品牌混用', 'validation')
      }
    }
  }

  handlers.set('mail:list', async () => repo.list<Mail>('mails', { archived: false }))

  handlers.set('mail:save', async (data: Payload) => {
    const id = str(data, '_id')
    const meta = {
      name: str(data, 'name'),
      brandId: str(data, 'brandId'),
      templateVersionId: str(data, 'templateVersionId'),
      bindings: (data['bindings'] ?? []) as unknown as Mail['bindings'],
      data: obj(data, 'data'),
      status: (id === '' ? 'draft' : 'draft') as Mail['status'],
      outputs: (obj(data, 'outputs') as unknown as Mail['outputs']) ?? {},
    }
    if (!meta.name || !meta.templateVersionId) throw new AppError('邮件名称与模板版本必填')
    // 跨品牌硬规定（第三层 · 落库前）：bindings 中每个片段须与邮件品牌一致
    await assertBindingsSameBrand(meta.brandId, meta.bindings)
    if (id === '') return repo.insert<Mail>('mails', meta)
    return repo.update<Mail>('mails', id, meta)
  })

  handlers.set('mail:remove', async (data: Payload) => {
    const id = str(data, '_id')
    await repo.archive('mails', id)
    return true
  })

  handlers.set('mail:generate', async (data: Payload) => {
    const mail = await repo.get<Mail>('mails', str(data, '_id'))
    if (!mail) throw new AppError('邮件不存在', 'io')
    const tv = await repo.get<TemplateVersion>('templateVersions', mail.templateVersionId)
    if (!tv) throw new AppError('模板版本不存在', 'io')
    // 跨品牌硬规定（第三层 · 生成前）：以模板版本品牌为基准校验所有片段
    await assertBindingsSameBrand(tv.brandId, mail.bindings)
    // R19 统一组合引擎：placements（per-placement data/order/repeat，Q12）→ slot_* → 三阶段
    const fragments: Array<{ fv: FragmentVersion; binding: Mail['bindings'][number] }> = []
    for (const b of mail.bindings) {
      const fv = await repo.get<FragmentVersion>('fragmentVersions', b.fragmentVersionId)
      if (fv) fragments.push({ fv, binding: b })
    }
    const cssResult = await resolveEntitiesCss([{ entity: tv, kind: 'template' }, ...fragments.map((x) => ({ entity: x.fv, kind: 'fragment' as const }))])
    const placements: ComposePlacement[] = fragments.map(({ fv, binding: b }, i) => ({
      html: cssResult.htmls[i + 1] ?? fv.source.html,
      data: (b.data ?? mail.data ?? {}) as Record<string, unknown>,
      slot: b.slot,
      order: b.order,
      repeat: b.repeat,
    }))
    const stages = await compose({
      templateHtml: cssResult.htmls[0] ?? tv.source.html,
      placements,
      data: (mail.data ?? {}) as Record<string, unknown>,
      strict: true,
      resolvedCss: cssResult.css,
    })
    const snap = outputSnapshotOptions(ctx.config, TOOL_IDS.edmStudio, app.getPath('userData'))
    const outputs = {
      assembled: writeOutput(ctx.outputRoot, edmOutputRel(mail._id, 'assembled'), stages.assembled, snap),
      inlined: writeOutput(ctx.outputRoot, edmOutputRel(mail._id, 'inlined'), stages.inlined, snap),
      final: writeOutput(ctx.outputRoot, edmOutputRel(mail._id, 'final'), stages.final, snap),
    }
    return repo.update<Mail>('mails', mail._id, {
      outputs,
      status: 'generated',
      lastGeneratedAt: now(),
      sourceHash: stages.sourceHash,
    })
  })

  handlers.set('mail:preview', async (data: Payload) => {
    // 草稿组合预览（不落库不写产物；R20 编辑页实时预览用）
    const tv = await repo.get<TemplateVersion>('templateVersions', str(data, 'templateVersionId'))
    if (!tv) throw new AppError('模板版本不存在', 'io')
    const raw = Array.isArray(data['placements']) ? (data['placements'] as Payload[]) : []
    // 跨品牌硬规定（第三层 · 预览前）：草稿 placements 的片段须与模板同品牌
    await assertBindingsSameBrand(tv.brandId, raw.map((p) => ({ fragmentVersionId: String(p['fragmentVersionId'] ?? '') })))
    const fragments: Array<{ fv: FragmentVersion; p: Payload }> = []
    for (const p of raw) {
      const fv = await repo.get<FragmentVersion>('fragmentVersions', String(p['fragmentVersionId'] ?? ''))
      if (fv) fragments.push({ fv, p })
    }
    const cssResult = await resolveEntitiesCss([{ entity: tv, kind: 'template' }, ...fragments.map((x) => ({ entity: x.fv, kind: 'fragment' as const }))])
    const placements: ComposePlacement[] = fragments.map(({ fv, p }, i) => ({
      html: cssResult.htmls[i + 1] ?? fv.source.html,
      data: (p['data'] as Record<string, unknown> | undefined) ?? undefined,
      slot: String(p['slot'] ?? ''),
      order: typeof p['order'] === 'number' ? (p['order'] as number) : undefined,
      repeat: typeof p['repeat'] === 'number' ? (p['repeat'] as number) : undefined,
    }))
    const stages = await compose({
      templateHtml: cssResult.htmls[0] ?? tv.source.html,
      placements,
      data: (data['mailData'] as Record<string, unknown>) ?? {},
      strict: false,
      resolvedCss: cssResult.css,
    })
    return { html: stages.assembled }
  })

  // F-03（2026-11-22 复核）：三形态产物读取——requirement.txt 明确要求「复制渲染、juice、压缩后的
  // 最终代码」，此前 mail:readFinal 只读 final 且渲染层零调用（死代码、复制代码功能整体缺失）。
  // form = assembled（组合后原始 HTML）/ inlined（内联资源）/ final（juice 压缩）
  handlers.set('mail:readOutput', async (data: Payload) => {
    const mail = await repo.get<Mail>('mails', str(data, '_id'))
    if (!mail) throw new AppError('邮件不存在')
    const form = String(data['form'] ?? 'final')
    const rel = form === 'assembled' ? mail.outputs.assembled : form === 'inlined' ? mail.outputs.inlined : mail.outputs.final
    if (!rel) throw new AppError('尚未生成产物')
    return readOutput(ctx.outputRoot, rel)
  })

  // ── 导出（约定：单封 .html(final) / 批量 .zip 含各形态 assembled/inlined/final，§6.3） ──
  handlers.set('mail:export', async (data: Payload) => {
    const ids = Array.isArray(data['ids']) ? (data['ids'] as unknown[]).map(String).filter(Boolean) : []
    const outPath = str(data, 'outPath')
    if (ids.length === 0) throw new AppError('ids 必填')
    if (!outPath) throw new AppError('outPath 必填（os.pickSave 结果）')
    const read = async (rel?: string): Promise<string> => (rel ? await readOutput(ctx.outputRoot, rel) : '')
    const items: { id: string; name: string; assembled: string; inlined: string; final: string }[] = []
    for (const id of ids) {
      const mail = await repo.get<Mail>('mails', id)
      if (!mail?.outputs.final) continue
      items.push({
        id,
        name: mail.name,
        assembled: await read(mail.outputs.assembled),
        inlined: await read(mail.outputs.inlined),
        final: await read(mail.outputs.final),
      })
    }
    if (items.length === 0) throw new AppError('所选邮件均无产物，请先生成')
    if (items.length === 1 && !outPath.endsWith('.zip')) {
      await fs.writeFile(outPath, items[0]!.final, 'utf8')
      return { count: 1, outPath }
    }
    // zip 内文件名：名称非法字符替换为 _，空名回退 id；每封含三个形态
    const safe = (s: string): string => s.replace(/[\\/:*?"<>|]/g, '_').trim() || 'mail'
    const enc = (s: string): Uint8Array => new TextEncoder().encode(s)
    const files: Record<string, Uint8Array> = {}
    for (const it of items) {
      if (it.assembled) files[`${safe(it.name)}.${EDM_OUTPUT_FILES.assembled}`] = enc(it.assembled)
      if (it.inlined) files[`${safe(it.name)}.${EDM_OUTPUT_FILES.inlined}`] = enc(it.inlined)
      if (it.final) files[`${safe(it.name)}.${EDM_OUTPUT_FILES.final}`] = enc(it.final)
    }
    await fs.writeFile(outPath, zipSync(files, { level: 6 }))
    return { count: items.length, outPath }
  })

  // ── 分享解析（plans/09 ShareHub）：产物根目录绝对路径，交给 ShareDialog 创建路由 ──
  handlers.set('share:resolve', async () => {
    const root = path.join(ctx.outputRoot, 'outputs')
    if (!existsSync(root)) throw new AppError('尚无产物目录，请先生成邮件', 'io')
    return { root, entry: '', label: '邮件产物' }
  })
}
