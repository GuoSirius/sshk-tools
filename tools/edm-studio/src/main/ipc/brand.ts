import { AppError } from '@sshk/shared'
import { unifiedBrandId } from '../edm-brand-identity.js'
import type { Brand } from '@sshk/repository'
import type { ActionHandler, EdmIpcContext, Payload } from './context'

/** 品牌（D29：独立管理页）域 action：brand:list / brand:save / brand:remove */
export function registerBrandActions(ctx: EdmIpcContext, handlers: Map<string, ActionHandler>): void {
  const { repo, str } = ctx

  // 防御性去重：早期随机 id 品牌与系统播种的确定性 id 品牌同 code 时只保留确定性那条（present 下拉不出现重复）
  handlers.set('brand:list', async () => {
    const all = await repo.list<Brand>('brands', { archived: false })
    const byCode = new Map<string, Brand>()
    for (const b of all) {
      const canonical = unifiedBrandId(b.code)
      const prev = byCode.get(b.code)
      // 确定性 id 优先；同 code 两条都非确定性时保留先出现的（播种会在启动阶段归档旧 id）
      if (!prev || b._id === canonical) byCode.set(b.code, b)
    }
    return [...byCode.values()]
  })

  handlers.set('brand:save', async (data: Payload) => {
    const id = str(data, '_id')
    const meta = { code: str(data, 'code'), name: str(data, 'name'), logo: str(data, 'logo') || undefined }
    if (id === '') {
      if (!meta.code || !meta.name) throw new AppError('品牌 code 与名称必填')
      return repo.insert<Brand>('brands', meta)
    }
    await ctx.assertMutable('brands', id)
    return repo.update<Brand>('brands', id, meta)
  })

  handlers.set('brand:remove', async (data: Payload) => {
    await ctx.assertMutable('brands', str(data, '_id'))
    return repo.archive('brands', str(data, '_id'))
  })
}
