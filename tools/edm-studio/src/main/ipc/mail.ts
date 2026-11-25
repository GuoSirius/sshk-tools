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
  type Fragment,
} from '@sshk/repository'

import { compose, type ComposePlacement } from '../../core/compose.js'
import { resolveCssBundle } from '../../core/css-resolve.js'
import { resolveRenderMeta, parseVersionEntityId } from '../render-meta.js'
import type { RenderMeta } from '../../core/render-meta.js'
import type { TemplateRoots } from '../../core/template-loader.js'
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
  ): Promise<{ css: string; htmls: string[]; metas: RenderMeta[]; roots?: TemplateRoots }> {
    const points = entries.map(({ entity, kind }) => {
      const isCustom = entity.origin === 'custom'
      const sourceRoot = ctx.resolveContentRoot(isCustom ? 'custom' : 'system')
      // ID 口径统一走 parseVersionEntityId（2026-11-25 修复：旧前缀 'tpl'/'frg' 与实际
      // 'tplv'/'frgv' 不符导致 system 版本目录推导恒失败，css/meta 全部回退播种快照）
      const parsed = parseVersionEntityId(entity._id, kind, entity.origin, entity.label)
      if (!parsed) console.warn(`[edm] 版本 ${entity._id} 无法推导 css 解析目录，回退播种快照`)
      const versionDir = parsed
        ? path.join(sourceRoot, parsed.brandCode, kind, parsed.familyCode, parsed.versionDirName)
        : sourceRoot
      return {
        html: entity.source.html,
        metaPoint: {
          sourceRoot,
          brandCode: parsed?.brandCode ?? '',
          kind,
          familyCode: parsed?.familyCode ?? '',
          versionDir,
        },
        ctx: {
          sourceRoot,
          systemRoot: ctx.resolveContentRoot('system'),
          customRoot: ctx.resolveContentRoot('custom'),
          versionDir,
        },
        fallbackCss: entity.source.cssMode === 'inline' ? entity.source.css : undefined,
      }
    })
    const sources = points.map(({ html, ctx: ctxArg, fallbackCss }) => ({ html, ctx: ctxArg, fallbackCss }))
    const bundle = await resolveCssBundle({ sources, outputRoot: ctx.outputRoot, unoEnabled: true })
    for (const w of bundle.warnings) console.warn(`[edm] css 引用警告：${w}`)
    // 四级 meta 反查（修订 1/13）：真相源在磁盘 meta.yaml，与 css 共用推导出的版本目录
    const metas = await Promise.all(points.map(({ metaPoint }) => resolveRenderMeta(metaPoint)))
    // 模板引用根（需求 2）：首个实体即模板，其 ctx 结构兼容 TemplateRoots
    const tplCtx = points[0]?.ctx
    const roots: TemplateRoots | undefined = tplCtx
      ? { systemRoot: tplCtx.systemRoot, customRoot: tplCtx.customRoot, sourceRoot: tplCtx.sourceRoot, versionDir: tplCtx.versionDir }
      : undefined
    return { css: bundle.css, htmls: bundle.htmls, metas, roots }
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

  // 仅改邮件名（#198 ②）：纯元信息改动，不碰 bindings / 品牌 / 模板，不做跨品牌校验；
  // 跨品牌混用只在组装（mail:generate/mail:preview/mail:save 全量保存）时检测，改名不误伤。
  handlers.set('mail:rename', async (data: Payload) => {
    const id = str(data, '_id')
    const name = str(data, 'name').trim()
    if (!id) throw new AppError('邮件 id 必填', 'validation')
    if (!name) throw new AppError('邮件名称必填', 'validation')
    const mail = await repo.get<Mail>('mails', id)
    if (!mail) throw new AppError('邮件不存在', 'io')
    return repo.update<Mail>('mails', id, { name })
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
    const fragments: Array<{ fv: FragmentVersion; binding: Mail['bindings'][number]; name?: string }> = []
    for (const b of mail.bindings) {
      const fv = await repo.get<FragmentVersion>('fragmentVersions', b.fragmentVersionId)
      if (!fv) continue
      const frag = await repo.get<Fragment>('fragments', fv.fragmentId)
      fragments.push({ fv, binding: b, name: frag?.name })
    }
    // strict 生成兜底（2026-11-25 反馈 5）：placement 未带独立数据且 mail.data 为空时
    // 回落片段 sampleData，避免「用户没填就生成」必然 strict 报错；mail.data 有值时仍优先（用户显式填写）
    const mailData = mail.data && Object.keys(mail.data).length > 0 ? (mail.data as Record<string, unknown>) : undefined
    const cssResult = await resolveEntitiesCss([{ entity: tv, kind: 'template' }, ...fragments.map((x) => ({ entity: x.fv, kind: 'fragment' as const }))])
    const placements: ComposePlacement[] = fragments.map(({ fv, binding: b, name }, i) => ({
      html: cssResult.htmls[i + 1] ?? fv.source.html,
      data: (b.data ?? mailData ?? fv.sampleData ?? {}) as Record<string, unknown>,
      meta: cssResult.metas[i + 1],
      slot: b.slot,
      order: b.order,
      repeat: b.repeat,
      label: `${name ?? fv.fragmentId}（${b.slot}）`,
    }))
    const stages = await compose({
      templateHtml: cssResult.htmls[0] ?? tv.source.html,
      placements,
      data: (mail.data ?? {}) as Record<string, unknown>,
      meta: cssResult.metas[0],
      strict: true,
      resolvedCss: cssResult.css,
      roots: cssResult.roots,
    })
    const snap = outputSnapshotOptions(ctx.config, TOOL_IDS.edmStudio, app.getPath('userData'))
    const outputs = {
      template: stages.assembledTemplate
        ? writeOutput(ctx.outputRoot, edmOutputRel(mail._id, 'template'), stages.assembledTemplate, snap)
        : undefined,
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
      meta: cssResult.metas[i + 1],
      slot: String(p['slot'] ?? ''),
      order: typeof p['order'] === 'number' ? (p['order'] as number) : undefined,
      repeat: typeof p['repeat'] === 'number' ? (p['repeat'] as number) : undefined,
      label: fv.label ?? '片段',
    }))
    const stages = await compose({
      templateHtml: cssResult.htmls[0] ?? tv.source.html,
      placements,
      data: (data['mailData'] as Record<string, unknown>) ?? {},
      meta: cssResult.metas[0],
      strict: false,
      resolvedCss: cssResult.css,
      roots: cssResult.roots,
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
    const rel = form === 'template' ? mail.outputs.template
      : form === 'assembled' ? mail.outputs.assembled
      : form === 'inlined' ? mail.outputs.inlined
      : mail.outputs.final
    if (!rel) throw new AppError('尚未生成该形态产物，请先生成')
    return readOutput(ctx.outputRoot, rel)
  })

  // ── 导出（约定：单封 .html(final) / 批量 .zip 含各形态 assembled/inlined/final，§6.3） ──
  handlers.set('mail:export', async (data: Payload) => {
    const ids = Array.isArray(data['ids']) ? (data['ids'] as unknown[]).map(String).filter(Boolean) : []
    const outPath = str(data, 'outPath')
    if (ids.length === 0) throw new AppError('ids 必填')
    if (!outPath) throw new AppError('outPath 必填（os.pickSave 结果）')
    const read = async (rel?: string): Promise<string> => (rel ? await readOutput(ctx.outputRoot, rel) : '')
    const items: { id: string; name: string; template: string; assembled: string; inlined: string; final: string }[] = []
    for (const id of ids) {
      const mail = await repo.get<Mail>('mails', id)
      if (!mail?.outputs.final) continue
      items.push({
        id,
        name: mail.name,
        template: await read(mail.outputs.template),
        assembled: await read(mail.outputs.assembled),
        inlined: await read(mail.outputs.inlined),
        final: await read(mail.outputs.final),
      })
    }
    if (items.length === 0) throw new AppError('所选邮件均无产物，请先生成')
    // 修订 14：单封与批量统一走 zip（每封一个邮件名目录，含四形态）；单封 .html 由「复制」承接
    // zip 内以邮件名为目录：每封一个 safe(name)/ 目录，含四形态（需求 3.1）
    const safe = (s: string): string => s.replace(/[\\/:*?"<>|]/g, '_').trim() || 'mail'
    const enc = (s: string): Uint8Array => new TextEncoder().encode(s)
    const files: Record<string, Uint8Array> = {}
    for (const it of items) {
      const dir = `${safe(it.name)}/`
      if (it.template) files[`${dir}${EDM_OUTPUT_FILES.template}`] = enc(it.template)
      if (it.assembled) files[`${dir}${EDM_OUTPUT_FILES.assembled}`] = enc(it.assembled)
      if (it.inlined) files[`${dir}${EDM_OUTPUT_FILES.inlined}`] = enc(it.inlined)
      if (it.final) files[`${dir}${EDM_OUTPUT_FILES.final}`] = enc(it.final)
    }
    await fs.writeFile(outPath, zipSync(files, { level: 6 }))
    return { count: items.length, outPath }
  })

  // ── 分享解析（plans/09 ShareHub）：产物根目录绝对路径，交给 ShareDialog 创建路由 ──
  handlers.set('share:resolve', async (data: Payload) => {
    const mailId = str(data, 'mailId')
    // 行级分享：每封独立 root（Q5），TTL/撤销互不干扰；顶层分享=所有列表项（root=outputs）
    const root = mailId
      ? path.join(ctx.outputRoot, 'outputs', mailId)
      : path.join(ctx.outputRoot, 'outputs')
    if (!existsSync(root)) throw new AppError('尚无产物目录，请先生成邮件', 'io')
    return { root, entry: '', label: mailId ? '单封邮件产物' : '邮件产物' }
  })
}
