import { AppError } from '@sshk/shared'
import type { Fragment, FragmentVersion, TemplateVersion } from '@sshk/repository'
import type { ActionHandler, EdmIpcContext, Payload } from './context'

/** 片段族 / 片段版本域 action（版本不可变 D8；frgv:update 为 R22b 自定义库直编豁免）+ 候选片段下推 */
export function registerFragmentActions(ctx: EdmIpcContext, handlers: Map<string, ActionHandler>): void {
  const { repo, str, obj } = ctx

  handlers.set('frg:list', async () => repo.list<Fragment>('fragments', { archived: false }))

  handlers.set('frg:save', async (data: Payload) => {
    const id = str(data, '_id')
    const meta = {
      brandId: str(data, 'brandId'), name: str(data, 'name'),
      description: str(data, 'description') || undefined,
      type: str(data, 'type') || 'product', origin: 'custom' as const,
    }
    if (!meta.brandId || !meta.name) throw new AppError('品牌与片段名称必填')
    if (id === '') return repo.insert<Fragment>('fragments', meta)
    await ctx.assertMutable('fragments', id)
    return repo.update<Fragment>('fragments', id, meta)
  })

  handlers.set('frg:remove', async (data: Payload) => {
    await ctx.assertMutable('fragments', str(data, '_id'))
    return repo.archive('fragments', str(data, '_id'))
  })

  handlers.set('frgv:save', async (data: Payload) => {
    const fragmentId = str(data, 'fragmentId')
    const prev = str(data, 'prevVersionId')
    const frg = await repo.get<Fragment>('fragments', fragmentId)
    if (!frg) throw new AppError('片段不存在', 'io')
    if (frg.origin === 'system') throw new AppError('系统片段只读：请用「另存为」派生自定义副本')
    let version = 1
    if (prev !== '') {
      const prevV = await repo.get<FragmentVersion>('fragmentVersions', prev)
      if (!prevV) throw new AppError('上一版本不存在', 'io')
      version = prevV.version + 1
    }
    const inserted = await repo.insert<FragmentVersion>('fragmentVersions', {
      fragmentId,
      brandId: frg.brandId,
      version,
      label: `v${version}`,
      type: '' /* #213：片段无 type */,
      source: obj(data, 'source') as unknown as FragmentVersion['source'],
      policy: (obj(data, 'policy') as unknown as FragmentVersion['policy']) ?? { blacklist: [], whitelist: [] },
      dataSchema: obj(data, 'dataSchema'),
      sampleData: obj(data, 'sampleData'),
      origin: 'custom',
    })
    await repo.update<Fragment>('fragments', fragmentId, { latestVersionId: inserted._id })
    return inserted
  })

  handlers.set('frgv:saveAsNew', async (data: Payload) => {
    const src = await repo.get<FragmentVersion>('fragmentVersions', str(data, '_id'))
    if (!src) throw new AppError('源版本不存在', 'io')
    const brandId = str(data, 'brandId') || src.brandId
    const newFrg = await repo.insert<Fragment>('fragments', {
      brandId, name: str(data, 'name') || `${src.label} 副本`, type: '' /* #213：片段无 type */, origin: 'custom',
    })
    const newV = await repo.insert<FragmentVersion>('fragmentVersions', {
      fragmentId: newFrg._id, brandId, version: 1, label: 'v1', type: '' /* #213：片段无 type */,
      source: src.source, policy: { blacklist: [], whitelist: [] },
      dataSchema: src.dataSchema, sampleData: src.sampleData, origin: 'custom',
    })
    await repo.update<Fragment>('fragments', newFrg._id, { latestVersionId: newV._id })
    return { fragment: newFrg, version: newV }
  })

  handlers.set('frgv:get', async (data: Payload) => repo.get<FragmentVersion>('fragmentVersions', str(data, '_id')))
  handlers.set('frgv:list', async () => repo.list<FragmentVersion>('fragmentVersions', { archived: false }))

  handlers.set('frgv:update', async (data: Payload) => {
    const id = str(data, '_id')
    await ctx.assertMutable('fragmentVersions', id)
    const patch: Record<string, unknown> = {}
    if (data['source'] !== undefined) patch['source'] = obj(data, 'source') as unknown as FragmentVersion['source']
    if (data['label'] !== undefined) patch['label'] = str(data, 'label')
    if (data['policy'] !== undefined) patch['policy'] = obj(data, 'policy') as unknown as FragmentVersion['policy']
    if (data['sampleData'] !== undefined) patch['sampleData'] = obj(data, 'sampleData')
    if (data['type'] !== undefined) patch['type'] = str(data, 'type') || 'product'
    if (data['description'] !== undefined) patch['description'] = str(data, 'description') || undefined
    if (data['fields'] !== undefined) patch['fields'] = Array.isArray(data['fields']) ? data['fields'] : undefined
    if (Object.keys(patch).length === 0) throw new AppError('无可更新字段')
    return repo.update<FragmentVersion>('fragmentVersions', id, patch)
  })

  handlers.set('frgv:remove', async (data: Payload) => {
    await ctx.assertMutable('fragmentVersions', str(data, '_id'))
    return repo.archive('fragmentVersions', str(data, '_id'))
  })

  // ── 候选片段（两道过滤下推 Repository，黑名单优先 §2.2） ──
  handlers.set('candidates:pick', async (data: Payload) => {
    const tv = await repo.get<TemplateVersion>('templateVersions', str(data, 'templateVersionId'))
    if (!tv) throw new AppError('模板版本不存在', 'io')
    // #213：片段类型已取消，候选只按品牌 + 黑白名单过滤
    return repo.listCandidateFragmentVersions(tv)
  })
}
