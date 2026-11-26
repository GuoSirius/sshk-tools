import { AppError } from '@sshk/shared'
import type { Template, TemplateVersion } from '@sshk/repository'
import { compose } from '../../core/compose.js'
import { extractSlotKeysFromSource } from '../../core/slots.js'
import { resolveMetaByVersionId } from '../render-meta.js'
import type { ActionHandler, EdmIpcContext, Payload } from './context'

/** 模板族 / 模板版本域 action（版本不可变 D8；tplv:update 为 R22b 自定义库直编豁免） */
export function registerTemplateActions(ctx: EdmIpcContext, handlers: Map<string, ActionHandler>): void {
  const { repo, str, obj } = ctx

  handlers.set('tpl:list', async () => repo.list<Template>('templates', { archived: false }))

  handlers.set('tpl:save', async (data: Payload) => {
    const id = str(data, '_id')
    const meta = {
      brandId: str(data, 'brandId'), name: str(data, 'name'),
      description: str(data, 'description') || undefined,
      origin: (id === '' ? 'custom' : 'custom') as 'custom',
    }
    if (!meta.brandId || !meta.name) throw new AppError('品牌与模板名称必填')
    if (id === '') return repo.insert<Template>('templates', meta)
    await ctx.assertMutable('templates', id)
    return repo.update<Template>('templates', id, meta)
  })

  handlers.set('tpl:remove', async (data: Payload) => {
    await ctx.assertMutable('templates', str(data, '_id'))
    return repo.archive('templates', str(data, '_id'))
  })

  // ── 模板版本（不可变；保存 = 新版本 D8） ──
  handlers.set('tplv:save', async (data: Payload) => {
    const templateId = str(data, 'templateId')
    const prev = str(data, 'prevVersionId')
    if (!templateId) throw new AppError('templateId 必填')
    const tpl = await repo.get<Template>('templates', templateId)
    if (!tpl) throw new AppError('模板不存在', 'io')
    if (tpl.origin === 'system') throw new AppError('系统模板只读：请用「另存为」派生自定义副本')
    let version = 1
    if (prev !== '') {
      const prevV = await repo.get<TemplateVersion>('templateVersions', prev)
      if (!prevV) throw new AppError('上一版本不存在', 'io')
      version = prevV.version + 1
    }
    const inserted = await repo.insert<TemplateVersion>('templateVersions', {
      templateId,
      brandId: tpl.brandId,
      version,
      label: `v${version}`,
      source: obj(data, 'source') as unknown as TemplateVersion['source'],
      // #213：slots 由 njk 源码唯一决定，不再从入参落库
      slots: extractSlotKeysFromSource(String(obj(data, 'source')?.['html'] ?? '')).map((key) => ({ key, type: '', required: false, multiple: false })),
      dataSchema: obj(data, 'dataSchema'),
      sampleData: obj(data, 'sampleData'),
      origin: 'custom',
    })
    await repo.update<Template>('templates', templateId, { latestVersionId: inserted._id })
    return inserted
  })

  handlers.set('tplv:saveAsNew', async (data: Payload) => {
    // 复制为另一种模板（brandId 可改，跨品牌 D8）
    const src = await repo.get<TemplateVersion>('templateVersions', str(data, '_id'))
    if (!src) throw new AppError('源版本不存在', 'io')
    const brandId = str(data, 'brandId') || src.brandId
    const newTpl = await repo.insert<Template>('templates', {
      brandId,
      name: str(data, 'name') || `${src.label} 副本`,
      origin: 'custom',
    })
    const newV = await repo.insert<TemplateVersion>('templateVersions', {
      templateId: newTpl._id,
      brandId,
      version: 1,
      label: 'v1',
      source: src.source,
      slots: src.slots,
      dataSchema: src.dataSchema,
      sampleData: src.sampleData,
      origin: 'custom',
    })
    await repo.update<Template>('templates', newTpl._id, { latestVersionId: newV._id })
    return { template: newTpl, version: newV }
  })

  handlers.set('tplv:get', async (data: Payload) => repo.get<TemplateVersion>('templateVersions', str(data, '_id')))
  handlers.set('tplv:list', async () => repo.list<TemplateVersion>('templateVersions', { archived: false }))

  // R22b 自定义内容库直编：custom 版本原地更新（版本不可变 D8 仅约束系统内容，自定义副本归用户所有）
  handlers.set('tplv:update', async (data: Payload) => {
    const id = str(data, '_id')
    await ctx.assertMutable('templateVersions', id)
    const patch: Record<string, unknown> = {}
    if (data['source'] !== undefined) patch['source'] = obj(data, 'source') as unknown as TemplateVersion['source']
    if (data['label'] !== undefined) patch['label'] = str(data, 'label')
    if (data['sampleData'] !== undefined) patch['sampleData'] = obj(data, 'sampleData')
    if (data['description'] !== undefined) patch['description'] = str(data, 'description') || undefined
    if (data['fields'] !== undefined) patch['fields'] = Array.isArray(data['fields']) ? data['fields'] : undefined
    if (Object.keys(patch).length === 0) throw new AppError('无可更新字段')
    return repo.update<TemplateVersion>('templateVersions', id, patch)
  })

  handlers.set('tplv:remove', async (data: Payload) => {
    await ctx.assertMutable('templateVersions', str(data, '_id'))
    return repo.archive('templateVersions', str(data, '_id'))
  })

  // R22b 版本渲染预览（自定义库）：html+css 就近 inline，示例数据填充，单版本单渲
  // （双类目共用：cat=template|fragment，随版本域相邻放置）
  handlers.set('version:render', async (data: Payload) => {
    const cat = str(data, 'cat') === 'template' ? 'template' : 'fragment'
    const id = str(data, '_id')
    const v = cat === 'template'
      ? await repo.get<TemplateVersion>('templateVersions', id)
      : await repo.get<import('@sshk/repository').FragmentVersion>('fragmentVersions', id)
    if (!v) throw new AppError('版本不存在', 'io')
    const meta = await resolveMetaByVersionId(v._id, cat, v.origin, v.label, (s) => ctx.resolveContentRoot(s))
    const stages = await compose({
      templateHtml: v.source.html,
      templateCss: v.source.cssMode === 'inline' ? v.source.css : undefined,
      placements: [],
      data: (v.sampleData ?? {}) as Record<string, unknown>,
      meta,
      strict: false,
      outputRoot: ctx.outputRoot,
      unoEnabled: true,
    })
    return { html: stages.assembled }
  })
}
