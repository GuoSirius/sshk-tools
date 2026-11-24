import path from 'node:path'
import { promises as fs } from 'node:fs'
import * as yaml from 'js-yaml'
import { AppError } from '@sshk/shared'
import { loadEdmModel } from '../edm-manifest.js'
import { validateMetaIdentity } from '../../core/meta-contract.js'
import { renderSystemPreview, renderSystemCompose, type SystemSelector } from '../../core/system-css.js'
import { SYSTEM_FILE_EXTS, type ActionHandler, type EdmIpcContext, type Payload } from './context'

/** R24 content:* 域 action：按 source 路由到系统 / 自定义文件根（自定义恒可写；系统根受 dev 门控） */
export function registerContentActions(ctx: EdmIpcContext, handlers: Map<string, ActionHandler>): void {
  const { str, obj } = ctx

  handlers.set('content:load', async (data: Payload) => {
    const root = ctx.resolveContentRoot(str(data, 'source') === 'custom' ? 'custom' : 'system')
    return await loadEdmModel(root)
  })

  handlers.set('content:readFile', async (data: Payload) => {
    const root = ctx.resolveContentRoot(str(data, 'source') === 'custom' ? 'custom' : 'system')
    const file = str(data, 'file')
    const abs = path.resolve(root, file)
    if (!abs.startsWith(root)) throw new AppError('越权读取内容文件', 'permission')
    try {
      return await fs.readFile(abs, 'utf8')
    } catch {
      return null
    }
  })

  handlers.set('content:writeFile', async (data: Payload) => {
    const source = str(data, 'source') === 'custom' ? 'custom' : 'system'
    if (source === 'system') ctx.assertSystemEditable()
    const root = ctx.resolveContentRoot(source)
    const file = str(data, 'file')
    if (!SYSTEM_FILE_EXTS.has(path.extname(file))) throw new AppError(`不允许的文件类型：${path.extname(file) || '(无扩展名)'}`, 'io')
    // 后端第二层校验（前端表单校验只拦正常路径，IPC 直接调用也必须挡住）：
    // 四级 meta.yaml 一律要求非空 code/name，缺一即 validation 类错误，不写盘、不刷 unknown 堆栈。
    if (path.basename(file) === 'meta.yaml') {
      const content = String(data['content'] ?? '')
      let parsed: unknown
      try {
        parsed = yaml.load(content)
      } catch (err) {
        throw new AppError(`meta.yaml 不是合法 YAML：${(err as Error).message}`, 'validation')
      }
      const errors = validateMetaIdentity(parsed)
      if (errors.length) throw new AppError(`元数据校验未通过：${errors.join('、')}`, 'validation')
    }
    const abs = ctx.confine(root, file)
    await fs.mkdir(path.dirname(abs), { recursive: true })
    await fs.writeFile(abs, String(data['content'] ?? ''), 'utf8')
    return true
  })

  handlers.set('content:rename', async (data: Payload) => {
    const source = str(data, 'source') === 'custom' ? 'custom' : 'system'
    if (source === 'system') ctx.assertSystemEditable()
    const root = ctx.resolveContentRoot(source)
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
    return path.resolve(root, dst).split(path.sep).join('/')
  })

  handlers.set('content:remove', async (data: Payload) => {
    const source = str(data, 'source') === 'custom' ? 'custom' : 'system'
    if (source === 'system') ctx.assertSystemEditable()
    const root = ctx.resolveContentRoot(source)
    const abs = ctx.confine(root, str(data, 'file'))
    if (abs === root) throw new AppError('不能删除内容根目录', 'io')
    let exists = false
    try {
      await fs.access(abs)
      exists = true
    } catch {
      /* 不存在即视为已删除（幂等，#7） */
    }
    if (exists) await fs.rm(abs, { recursive: true, force: true })
    return true
  })

  handlers.set('content:listDir', async (data: Payload) => {
    const source = str(data, 'source') === 'custom' ? 'custom' : 'system'
    if (source === 'system') ctx.assertSystemEditable()
    const root = ctx.resolveContentRoot(source)
    const dir = str(data, 'dir').replace(/[\\/]+/g, '/').replace(/^\/+|\/+$/g, '')
    const abs = ctx.confine(root, dir)
    type DirEnt = { name: string; isDirectory(): boolean; isFile(): boolean }
    const out: string[] = []
    const walk = async (rel: string): Promise<void> => {
      let entries: DirEnt[]
      try {
        entries = await fs.readdir(path.resolve(abs, rel), { withFileTypes: true })
      } catch {
        return
      }
      for (const e of entries) {
        const childRel = rel ? `${rel}/${e.name}` : e.name
        if (e.isDirectory()) await walk(childRel)
        else if (e.isFile()) out.push(childRel)
      }
    }
    await walk('')
    return out
  })

  handlers.set('content:render', async (data: Payload) => {
    const root = ctx.resolveContentRoot(str(data, 'source') === 'custom' ? 'custom' : 'system')
    const sel = obj(data, 'selector') as unknown as SystemSelector
    if (!sel?.brandCode || !sel?.kind || !sel?.familyCode) throw new AppError('selector 需含 brandCode/kind/familyCode')
    const raw = Array.isArray(data['placements']) ? (data['placements'] as Payload[]) : []
    // 跨品牌硬规定（第三层 · 渲染前）：组合预览的片段 selector.brandCode 必须与模板一致
    for (const p of raw) {
      const ps = p['selector'] as unknown as SystemSelector
      if (ps?.brandCode && ps.brandCode !== sel.brandCode) {
        throw new AppError('片段与模板不属于同一品牌，禁止跨品牌混用', 'validation')
      }
    }
    // R28：显式 link 的 @shared / @system / @custom 需要两个来源根（密钥/连接信息不涉及，纯路径）
    const cssRoots = {
      systemRoot: ctx.resolveContentRoot('system'),
      customRoot: ctx.resolveContentRoot('custom'),
      outputRoot: ctx.outputRoot,
    }
    if (raw.length === 0) return await renderSystemPreview(root, sel, cssRoots)
    return await renderSystemCompose(
      root,
      sel,
      raw.map((p) => ({
        selector: p['selector'] as unknown as SystemSelector,
        slot: String(p['slot'] ?? ''),
        order: typeof p['order'] === 'number' ? p['order'] : undefined,
        repeat: typeof p['repeat'] === 'number' ? p['repeat'] : undefined,
        data: (p['data'] as Record<string, unknown> | undefined) ?? undefined,
      })),
      cssRoots,
    )
  })
}
