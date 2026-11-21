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
import type { ActionHandler, EdmIpcContext, Payload } from './context'

/** 邮件域 action（R19 统一组合引擎；产物覆盖式 D19）+ 产物根分享解析（plans/09 ShareHub） */
export function registerMailActions(ctx: EdmIpcContext, handlers: Map<string, ActionHandler>): void {
  const { repo, str, obj } = ctx

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
    // R19 统一组合引擎：placements（per-placement data/order/repeat，Q12）→ slot_* → 三阶段
    const placements: ComposePlacement[] = []
    for (const b of mail.bindings) {
      const fv = await repo.get<FragmentVersion>('fragmentVersions', b.fragmentVersionId)
      if (!fv) continue
      placements.push({
        html: fv.source.html,
        css: fv.source.cssMode === 'inline' ? fv.source.css : undefined,
        data: (b.data ?? mail.data ?? {}) as Record<string, unknown>,
        slot: b.slot,
        order: b.order,
        repeat: b.repeat,
      })
    }
    const stages = await compose({
      templateHtml: tv.source.html,
      templateCss: tv.source.cssMode === 'inline' ? tv.source.css : undefined,
      placements,
      data: (mail.data ?? {}) as Record<string, unknown>,
      strict: true,
      outputRoot: ctx.outputRoot,
      unoEnabled: true,
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
    const placements: ComposePlacement[] = []
    for (const p of raw) {
      const fv = await repo.get<FragmentVersion>('fragmentVersions', String(p['fragmentVersionId'] ?? ''))
      if (!fv) continue
      placements.push({
        html: fv.source.html,
        css: fv.source.cssMode === 'inline' ? fv.source.css : undefined,
        data: (p['data'] as Record<string, unknown> | undefined) ?? undefined,
        slot: String(p['slot'] ?? ''),
        order: typeof p['order'] === 'number' ? p['order'] : undefined,
        repeat: typeof p['repeat'] === 'number' ? p['repeat'] : undefined,
      })
    }
    const stages = await compose({
      templateHtml: tv.source.html,
      templateCss: tv.source.cssMode === 'inline' ? tv.source.css : undefined,
      placements,
      data: (data['mailData'] as Record<string, unknown>) ?? {},
      strict: false,
      outputRoot: ctx.outputRoot,
      unoEnabled: true,
    })
    return { html: stages.assembled }
  })

  handlers.set('mail:readFinal', async (data: Payload) => {
    const mail = await repo.get<Mail>('mails', str(data, '_id'))
    if (!mail?.outputs.final) throw new AppError('尚未生成产物')
    return readOutput(ctx.outputRoot, mail.outputs.final)
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
