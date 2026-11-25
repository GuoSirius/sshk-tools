import path from 'node:path'
import { promises as fs } from 'node:fs'
import * as yaml from 'js-yaml'
import { AppError } from '@sshk/shared'
import { loadEdmModel } from '../edm-manifest.js'
import { validateMetaIdentity } from '../../core/meta-contract.js'
import { renderSystemPreview, renderSystemCompose, type SystemSelector, type CssRootOptions } from '../../core/system-css.js'
import { resolveRenderMeta } from '../render-meta.js'
import { hasSampleOverride, isSampleFile, readSampleOverride, readSampleOverrideYaml, resetSampleOverride, writeSampleOverride } from '../sample-overlay.js'
import { SYSTEM_FILE_EXTS, type ActionHandler, type EdmIpcContext, type Payload } from './context'

/** selector → 版本目录相对路径下的 sample.yaml（brand/kind/family[/version]/sample.yaml；折叠版缺省 versionDir） */
function sampleRelOf(sel: SystemSelector): string {
  return `${[sel.brandCode, sel.kind, sel.familyCode, sel.versionDir].filter(Boolean).join('/')}/sample.yaml`
}

/**
 * R24 content:* 域 action：按 source 路由到系统 / 自定义文件根。
 * 门控口径（2026-11-24 收窄，台账 #189）：只读系统内容仅锁「设计」（meta/njk/css 写、改名、删除）；
 * 示例数据 sample.yaml 放开——写落 userData 覆盖层、读与渲染覆盖层优先，恢复默认=删覆盖文件。
 * 自定义根恒可写。
 */
export function registerContentActions(ctx: EdmIpcContext, handlers: Map<string, ActionHandler>): void {
  const { str, obj } = ctx

  handlers.set('content:load', async (data: Payload) => {
    const root = ctx.resolveContentRoot(str(data, 'source') === 'custom' ? 'custom' : 'system')
    return await loadEdmModel(root)
  })

  handlers.set('content:readFile', async (data: Payload) => {
    const source = str(data, 'source') === 'custom' ? 'custom' : 'system'
    const root = ctx.resolveContentRoot(source)
    const file = str(data, 'file')
    const abs = path.resolve(root, file)
    if (!abs.startsWith(root)) throw new AppError('越权读取内容文件', 'permission')
    // 只读系统内容：示例数据覆盖层优先（用户在表单/数据模式改过的 sample.yaml），缺省回落系统根
    if (source === 'system') {
      const over = await readSampleOverride(ctx.resolveOverrideRoot(), file)
      if (over !== null) return over
    }
    try {
      return await fs.readFile(abs, 'utf8')
    } catch {
      return null
    }
  })

  handlers.set('content:writeFile', async (data: Payload) => {
    const source = str(data, 'source') === 'custom' ? 'custom' : 'system'
    const file = str(data, 'file')
    const content = String(data['content'] ?? '')
    // 门控只拦设计写入；sample.yaml（示例数据）放开——只读模式下落覆盖层，系统根保持只读
    // （安装目录 resources/ 普通用户无写权限且升级被覆盖，不能作为用户数据落点）
    if (source === 'system' && !isSampleFile(file)) ctx.assertSystemEditable()
    if (!SYSTEM_FILE_EXTS.has(path.extname(file))) throw new AppError(`不允许的文件类型：${path.extname(file) || '(无扩展名)'}`, 'io')
    // 后端第二层校验（前端表单校验只拦正常路径，IPC 直接调用也必须挡住）：
    // ① 四级 meta.yaml 一律要求非空 code/name；② sample.yaml 必须是合法 YAML（空内容合法）。
    // 校验不过不写盘、不刷 unknown 堆栈。
    if (path.basename(file) === 'meta.yaml') {
      let parsed: unknown
      try {
        parsed = yaml.load(content)
      } catch (err) {
        throw new AppError(`meta.yaml 不是合法 YAML：${(err as Error).message}`, 'validation')
      }
      const errors = validateMetaIdentity(parsed)
      if (errors.length) throw new AppError(`元数据校验未通过：${errors.join('、')}`, 'validation')
    } else if (isSampleFile(file) && content.trim()) {
      try {
        yaml.load(content)
      } catch (err) {
        throw new AppError(`示例数据不是合法 YAML：${(err as Error).message}`, 'validation')
      }
    }
    if (source === 'system' && !ctx.systemEditable()) {
      await writeSampleOverride(ctx.resolveOverrideRoot(), file, content)
      return true
    }
    const root = ctx.resolveContentRoot(source)
    const abs = ctx.confine(root, file)
    await fs.mkdir(path.dirname(abs), { recursive: true })
    await fs.writeFile(abs, content, 'utf8')
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
    // 列目录是只读操作（另存为跨根复制 / 版本整拷需要列系统根），不设编辑门控（2026-11-24 #189：
    // 原实现连带拦掉打包版「版本另存为」的源列目录，属门控过宽）
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
    const source = str(data, 'source') === 'custom' ? 'custom' : 'system'
    const root = ctx.resolveContentRoot(source)
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
    // R28：显式 link 的 @system / @custom 需要两个来源根（密钥/连接信息不涉及，纯路径）
    const cssRoots = {
      systemRoot: ctx.resolveContentRoot('system'),
      customRoot: ctx.resolveContentRoot('custom'),
      outputRoot: ctx.outputRoot,
    }
    // 四级 meta 反查（修订 1/13）：真相源在磁盘 meta.yaml，缺失层级 graceful 降级；root 已按 source 解析
    const metaOf = (s: SystemSelector) => resolveRenderMeta({
      sourceRoot: root,
      brandCode: s.brandCode,
      kind: s.kind,
      familyCode: s.familyCode,
      versionDir: s.versionDir
        ? path.join(root, s.brandCode, s.kind, s.familyCode, s.versionDir)
        : path.join(root, s.brandCode, s.kind, s.familyCode),
    })
    const templateMeta = await metaOf(sel)
    if (raw.length === 0) {
      // 只读系统内容：单渲用覆盖层 sample.yaml（用户改过的示例数据），缺省回落系统根
      const opts: CssRootOptions = { ...cssRoots, meta: templateMeta }
      if (source === 'system') {
        const over = await readSampleOverrideYaml(ctx.resolveOverrideRoot(), sampleRelOf(sel))
        if (over) opts.sampleOverride = over
      }
      return await renderSystemPreview(root, sel, opts)
    }
    const overrideRoot = ctx.resolveOverrideRoot()
    return await renderSystemCompose(
      root,
      sel,
      await Promise.all(
        raw.map(async (p) => {
          const ps = p['selector'] as unknown as SystemSelector
          let d = (p['data'] as Record<string, unknown> | undefined) ?? undefined
          // placement 未带独立数据时，只读系统内容优先用覆盖层 sample（片段自身的示例数据改动参与组合）
          if (!d && source === 'system') d = (await readSampleOverrideYaml(overrideRoot, sampleRelOf(ps))) ?? undefined
          return {
            selector: ps,
            slot: String(p['slot'] ?? ''),
            order: typeof p['order'] === 'number' ? p['order'] : undefined,
            repeat: typeof p['repeat'] === 'number' ? p['repeat'] : undefined,
            data: d,
            meta: await metaOf(ps),
          }
        }),
      ),
      { ...cssRoots, meta: templateMeta },
    )
  })

  // ── 示例数据覆盖层（2026-11-24 #189）：查询 / 恢复系统默认（删除覆盖文件；自定义根无覆盖概念）──
  handlers.set('content:sampleOverrideState', async (data: Payload) => {
    if (str(data, 'source') !== 'system') return { overridden: false }
    return { overridden: await hasSampleOverride(ctx.resolveOverrideRoot(), str(data, 'file')) }
  })

  handlers.set('content:resetSampleOverride', async (data: Payload) => {
    if (str(data, 'source') !== 'system') return { reset: false }
    return { reset: await resetSampleOverride(ctx.resolveOverrideRoot(), str(data, 'file')) }
  })
}
