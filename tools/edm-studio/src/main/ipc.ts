import { app } from 'electron'
import path from 'node:path'
import { promises as fs } from 'node:fs'
import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import { IPC_CHANNELS, now } from '@sshk/shared'
import { loadEdmModel } from './edm-manifest.js'
import { seedSystemContent } from './edm-seed.js'
import {
  edmOutputRel,
  readOutput,
  writeOutput,
  type Brand,
  type Fragment,
  type FragmentVersion,
  type Mail,
  type Repository,
  type Template,
  type TemplateVersion,
} from '@sshk/repository'
import { renderFragment, renderMail } from '../core/render.js'
import { collectCss, type CssSource } from '../core/css-bundle.js'
import { renderSystemPreview, type SystemSelector } from '../core/system-css.js'
import { ShareServer } from './share.js'

export interface EdmIpcDeps {
  repository: Repository
  outputRoot: string
}

type Payload = Record<string, unknown>

const ACTIONS = new Set([
  'brand:list', 'brand:save', 'brand:remove',
  'tpl:list', 'tpl:save', 'tpl:remove',
  'tplv:save', 'tplv:saveAsNew', 'tplv:get',
  'frg:list', 'frg:save', 'frg:remove',
  'frgv:save', 'frgv:saveAsNew', 'frgv:get',
  'candidates:pick',
  'mail:list', 'mail:save', 'mail:remove', 'mail:generate', 'mail:readFinal',
  'share:start', 'share:stop', 'share:status',
  'system:load', 'system:render', 'system:readFile',
])

/**
 * 系统内容根（R6 双模解析）：
 * - 打包态：随包发布于 resources/edm-studio/assets/edm（R11：electron-builder extraResources）。
 * - 开发态：apps/desktop 在仓库根下两级，工具源码位于 <repo>/tools/edm-studio/assets/edm。
 * 外部安装包（plugin.source='external'）模式依赖 runtime-installer 解压落点，待该模块落地后
 * 再按 manifest.plugin.source 切换 baseDir，此处预留 source 入参。
 */
function resolveEdmRoot(_source: string = 'builtin', _baseDir?: string): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'edm-studio', 'assets', 'edm')
  }
  return path.resolve(app.getAppPath(), '../../tools/edm-studio/assets/edm')
}

function str(p: Payload, key: string): string {
  return String(p[key] ?? '')
}

function obj(p: Payload, key: string): Payload {
  return (p[key] as Payload) ?? {}
}

/**
 * EDM Studio IPC（数据契约 §5 edm 命名空间，M4/M5 用 action 白名单单通道）。
 * 版本不可变（D8）；删除一律软删除；产物覆盖式（D19）。
 */
export function registerEdmIpc(ipc: IpcMain, deps: EdmIpcDeps): { share: ShareServer } {
  const repo = deps.repository
  const share = new ShareServer(deps.outputRoot)

  /** 系统内容只读（R8）：origin='system' 的实体禁止在 NeDB 侧编辑/删除/派生新版本，改 = saveAsNew 派生副本 */
  async function assertMutable(name: Parameters<Repository['get']>[0], id: string): Promise<void> {
    const doc = await repo.get(name, id)
    if (doc && (doc as { origin?: string }).origin === 'system') throw new Error('系统内容只读：请用「另存为」派生自定义副本')
  }

  // R8 首次运行播种：系统内容注册进 NeDB 查询索引（逐实体幂等，激活即补种；不阻塞注册）
  seedSystemContent(repo, resolveEdmRoot()).catch((err: unknown) =>
    console.warn('[edm] 系统内容播种失败：', err instanceof Error ? err.message : err),
  )

  ipc.handle(IPC_CHANNELS.edmApi, async (_event: IpcMainInvokeEvent, payload: { action: string; data?: Payload }) => {
    const { action, data = {} as Payload } = payload
    if (!ACTIONS.has(action)) throw new Error(`非法 action: ${action}`)

    switch (action) {
      // ── 品牌（D29：独立管理页） ──
      case 'brand:list':
        return repo.list<Brand>('brands', { archived: false })
      case 'brand:save': {
        const id = str(data, '_id')
        const meta = { code: str(data, 'code'), name: str(data, 'name'), logo: str(data, 'logo') || undefined }
        if (id === '') {
          if (!meta.code || !meta.name) throw new Error('品牌 code 与名称必填')
          return repo.insert<Brand>('brands', meta)
        }
        await assertMutable('brands', id)
        return repo.update<Brand>('brands', id, meta)
      }
      case 'brand:remove':
        await assertMutable('brands', str(data, '_id'))
        return repo.archive('brands', str(data, '_id'))

      // ── 模板族 ──
      case 'tpl:list':
        return repo.list<Template>('templates', { archived: false })
      case 'tpl:save': {
        const id = str(data, '_id')
        const meta = {
          brandId: str(data, 'brandId'), name: str(data, 'name'),
          description: str(data, 'description') || undefined,
          origin: (id === '' ? 'custom' : 'custom') as 'custom',
        }
        if (!meta.brandId || !meta.name) throw new Error('品牌与模板名称必填')
        if (id === '') return repo.insert<Template>('templates', meta)
        await assertMutable('templates', id)
        return repo.update<Template>('templates', id, meta)
      }
      case 'tpl:remove':
        await assertMutable('templates', str(data, '_id'))
        return repo.archive('templates', str(data, '_id'))

      // ── 模板版本（不可变；保存 = 新版本 D8） ──
      case 'tplv:save': {
        const templateId = str(data, 'templateId')
        const prev = str(data, 'prevVersionId')
        if (!templateId) throw new Error('templateId 必填')
        const tpl = await repo.get<Template>('templates', templateId)
        if (!tpl) throw new Error('模板不存在')
        if (tpl.origin === 'system') throw new Error('系统模板只读：请用「另存为」派生自定义副本')
        let version = 1
        if (prev !== '') {
          const prevV = await repo.get<TemplateVersion>('templateVersions', prev)
          if (!prevV) throw new Error('上一版本不存在')
          version = prevV.version + 1
        }
        const inserted = await repo.insert<TemplateVersion>('templateVersions', {
          templateId,
          brandId: tpl.brandId,
          version,
          label: `v${version}`,
          source: obj(data, 'source') as unknown as TemplateVersion['source'],
          slots: (data['slots'] ?? []) as unknown as TemplateVersion['slots'],
          dataSchema: obj(data, 'dataSchema'),
          sampleData: obj(data, 'sampleData'),
          origin: 'custom',
        })
        await repo.update<Template>('templates', templateId, { latestVersionId: inserted._id })
        return inserted
      }
      case 'tplv:saveAsNew': {
        // 复制为另一种模板（brandId 可改，跨品牌 D8）
        const src = await repo.get<TemplateVersion>('templateVersions', str(data, '_id'))
        if (!src) throw new Error('源版本不存在')
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
      }
      case 'tplv:get':
        return repo.get<TemplateVersion>('templateVersions', str(data, '_id'))

      // ── 片段族 / 版本 ──
      case 'frg:list':
        return repo.list<Fragment>('fragments', { archived: false })
      case 'frg:save': {
        const id = str(data, '_id')
        const meta = {
          brandId: str(data, 'brandId'), name: str(data, 'name'),
          type: str(data, 'type') || 'product', origin: 'custom' as const,
        }
        if (!meta.brandId || !meta.name) throw new Error('品牌与片段名称必填')
        if (id === '') return repo.insert<Fragment>('fragments', meta)
        await assertMutable('fragments', id)
        return repo.update<Fragment>('fragments', id, meta)
      }
      case 'frg:remove':
        await assertMutable('fragments', str(data, '_id'))
        return repo.archive('fragments', str(data, '_id'))
      case 'frgv:save': {
        const fragmentId = str(data, 'fragmentId')
        const prev = str(data, 'prevVersionId')
        const frg = await repo.get<Fragment>('fragments', fragmentId)
        if (!frg) throw new Error('片段不存在')
        if (frg.origin === 'system') throw new Error('系统片段只读：请用「另存为」派生自定义副本')
        let version = 1
        if (prev !== '') {
          const prevV = await repo.get<FragmentVersion>('fragmentVersions', prev)
          if (!prevV) throw new Error('上一版本不存在')
          version = prevV.version + 1
        }
        const inserted = await repo.insert<FragmentVersion>('fragmentVersions', {
          fragmentId,
          brandId: frg.brandId,
          version,
          label: `v${version}`,
          type: frg.type,
          source: obj(data, 'source') as unknown as FragmentVersion['source'],
          policy: (obj(data, 'policy') as unknown as FragmentVersion['policy']) ?? { blacklist: [], whitelist: [] },
          dataSchema: obj(data, 'dataSchema'),
          sampleData: obj(data, 'sampleData'),
          origin: 'custom',
        })
        await repo.update<Fragment>('fragments', fragmentId, { latestVersionId: inserted._id })
        return inserted
      }
      case 'frgv:saveAsNew': {
        const src = await repo.get<FragmentVersion>('fragmentVersions', str(data, '_id'))
        if (!src) throw new Error('源版本不存在')
        const brandId = str(data, 'brandId') || src.brandId
        const newFrg = await repo.insert<Fragment>('fragments', {
          brandId, name: str(data, 'name') || `${src.label} 副本`, type: src.type, origin: 'custom',
        })
        const newV = await repo.insert<FragmentVersion>('fragmentVersions', {
          fragmentId: newFrg._id, brandId, version: 1, label: 'v1', type: src.type,
          source: src.source, policy: { blacklist: [], whitelist: [] },
          dataSchema: src.dataSchema, sampleData: src.sampleData, origin: 'custom',
        })
        await repo.update<Fragment>('fragments', newFrg._id, { latestVersionId: newV._id })
        return { fragment: newFrg, version: newV }
      }
      case 'frgv:get':
        return repo.get<FragmentVersion>('fragmentVersions', str(data, '_id'))

      // ── 候选片段（两道过滤下推 Repository，黑名单优先 §2.2） ──
      case 'candidates:pick': {
        const tv = await repo.get<TemplateVersion>('templateVersions', str(data, 'templateVersionId'))
        if (!tv) throw new Error('模板版本不存在')
        return repo.listCandidateFragmentVersions(tv, str(data, 'slotType'))
      }

      // ── 邮件 ──
      case 'mail:list':
        return repo.list<Mail>('mails', { archived: false })
      case 'mail:save': {
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
        if (!meta.name || !meta.templateVersionId) throw new Error('邮件名称与模板版本必填')
        if (id === '') return repo.insert<Mail>('mails', meta)
        return repo.update<Mail>('mails', id, meta)
      }
      case 'mail:remove': {
        const id = str(data, '_id')
        await repo.archive('mails', id)
        return true
      }
      case 'mail:generate': {
        const mail = await repo.get<Mail>('mails', str(data, '_id'))
        if (!mail) throw new Error('邮件不存在')
        const tv = await repo.get<TemplateVersion>('templateVersions', mail.templateVersionId)
        if (!tv) throw new Error('模板版本不存在')
        // 槽位绑定：片段版本渲染 + 槽位声明式注入；同时收集 css 来源与原子类扫描源
        const bindings: Record<string, string> = {}
        const cssSources: CssSource[] = []
        const scanCodes = [tv.source.html]
        for (const b of mail.bindings) {
          const fv = await repo.get<FragmentVersion>('fragmentVersions', b.fragmentVersionId)
          if (!fv) continue
          bindings[b.slot] = renderFragment(fv.source.html, (mail.data ?? {}) as Payload)
          scanCodes.push(fv.source.html)
          cssSources.push({ mode: fv.source.cssMode, content: fv.source.css, file: fv.source.cssFile })
        }
        cssSources.push({ mode: tv.source.cssMode, content: tv.source.css, file: tv.source.cssFile })
        const bundle = await collectCss({
          outputRoot: deps.outputRoot,
          sources: cssSources,
          scanCodes,
          unoEnabled: true,
        })
        for (const warning of bundle.warnings) console.warn(`[edm] css 汇集警告：${warning}`)
        const stages = await renderMail({
          templateHtml: tv.source.html,
          bindings,
          data: (mail.data ?? {}) as Payload,
          render: { strict: true, autoEscape: true },
          cssBundle: bundle.css,
        })
        const outputs = {
          assembled: writeOutput(deps.outputRoot, edmOutputRel(mail._id, 'assembled'), stages.assembled),
          inlined: writeOutput(deps.outputRoot, edmOutputRel(mail._id, 'inlined'), stages.inlined),
          final: writeOutput(deps.outputRoot, edmOutputRel(mail._id, 'final'), stages.final),
        }
        return repo.update<Mail>('mails', mail._id, {
          outputs,
          status: 'generated',
          lastGeneratedAt: now(),
          sourceHash: stages.sourceHash,
        })
      }
      case 'mail:readFinal': {
        const mail = await repo.get<Mail>('mails', str(data, '_id'))
        if (!mail?.outputs.final) throw new Error('尚未生成产物')
        return readOutput(deps.outputRoot, mail.outputs.final)
      }

      // ── 分享（M5 / D15） ──
      case 'share:start': {
        const ttlHours = Number(data['ttlHours'] ?? 72)
        const res = await share.start(ttlHours, 0)
        return res
      }
      case 'share:stop':
        await share.stop()
        return true
      case 'share:status':
        return { running: share.running, urls: share.urls() }

      // ── 系统内容模型（R3）：文件为源真相，构造内存模型供维护 UI 只读浏览 ──
      case 'system:load':
        return await loadEdmModel(resolveEdmRoot())

      // ── 系统内容预览渲染（R5：就近 css 汇集 + 三阶段渲染的 assembled 产物） ──
      case 'system:render': {
        const sel = obj(data, 'selector') as unknown as SystemSelector
        if (!sel?.brandCode || !sel?.kind || !sel?.familyCode) throw new Error('selector 需含 brandCode/kind/familyCode')
        return await renderSystemPreview(resolveEdmRoot(), sel)
      }
      // ── 读取系统内容原文（只读；限制在 edm 根内，越权即拒） ──
      case 'system:readFile': {
        const root = resolveEdmRoot()
        const file = str(data, 'file')
        const abs = path.resolve(root, file)
        if (!abs.startsWith(root)) throw new Error('越权读取系统文件')
        try {
          return await fs.readFile(abs, 'utf8')
        } catch {
          return null
        }
      }
      default:
        throw new Error(`未实现: ${action}`)
    }
  })

  return { share }
}
