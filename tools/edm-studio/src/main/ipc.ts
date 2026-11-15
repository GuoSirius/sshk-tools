import { app } from 'electron'
import path from 'node:path'
import { promises as fs } from 'node:fs'
import { zipSync } from 'fflate'
import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import { IPC_CHANNELS, now } from '@sshk/shared'
import { loadEdmModel } from './edm-manifest.js'
import { seedSystemContent, versionNumberOf } from './edm-seed.js'
import type {
  FragmentFamilyNode,
  FragmentVersionMeta,
  TemplateFamilyNode,
  TemplateVersionMeta,
  VersionNode,
} from '../core/edm-types.js'
import { collectSystemCssContent } from '../core/system-css.js'
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
import { compose, type ComposePlacement } from '../core/compose.js'
import { renderSystemPreview, renderSystemCompose, type SystemSelector } from '../core/system-css.js'
import { ShareServer } from './share.js'

export interface EdmIpcDeps {
  repository: Repository
  outputRoot: string
  /** 应用配置（只读）；系统内容编辑门控用（R12：!isPackaged || app.developerMode） */
  config?: { get(key: string): unknown }
}

type Payload = Record<string, unknown>

const ACTIONS = new Set([
  'brand:list', 'brand:save', 'brand:remove',
  'tpl:list',   'tpl:save', 'tpl:remove',
  'tplv:save', 'tplv:saveAsNew', 'tplv:get', 'tplv:list', 'tplv:update', 'tplv:remove',
  'frg:list', 'frg:save', 'frg:remove',
  'frgv:save', 'frgv:saveAsNew', 'frgv:get', 'frgv:list', 'frgv:update', 'frgv:remove',
  'candidates:pick', 'version:render',
  'mail:list', 'mail:save', 'mail:remove', 'mail:generate', 'mail:preview', 'mail:readFinal', 'mail:export',
  'share:start', 'share:stop', 'share:status',
  'system:load', 'system:render', 'system:readFile',
  'system:canEdit', 'system:writeFile', 'system:rename', 'system:remove',
  'system:derive',
])

/** 系统内容文件允许的扩展名（白名单防误写垃圾文件；css 文件名随意） */
const SYSTEM_FILE_EXTS = new Set(['.css', '.yaml', '.yml', '.njk'])

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

  // ── 系统内容编辑门控（R12）：dev 全权；打包版需 developerMode。main 端校验为安全边界 ──
  function systemEditable(): boolean {
    if (!app.isPackaged) return true
    return deps.config?.get('app.developerMode') === true
  }
  function assertSystemEditable(): void {
    if (!systemEditable()) throw new Error('系统内容在当前模式下只读（打包版需开启开发者模式）')
  }
  /** 限制在 edm 根内（越权即拒）；返回绝对路径 */
  function confine(file: string): string {
    const root = resolveEdmRoot()
    const abs = path.resolve(root, file)
    if (abs !== root && !abs.startsWith(root + path.sep)) throw new Error('越权路径')
    return abs
  }
  /** 相对路径规范化（POSIX 分隔，渲染层统一用 /） */
  function relOf(file: string): string {
    return path.resolve(resolveEdmRoot(), file).split(path.sep).join('/')
  }

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
      case 'tplv:list':
        return repo.list<TemplateVersion>('templateVersions', { archived: false })
      // R22b 自定义内容库直编：custom 版本原地更新（版本不可变 D8 仅约束系统内容，自定义副本归用户所有）
      case 'tplv:update': {
        const id = str(data, '_id')
        await assertMutable('templateVersions', id)
        const patch: Record<string, unknown> = {}
        if (data['source'] !== undefined) patch['source'] = obj(data, 'source') as unknown as TemplateVersion['source']
        if (data['label'] !== undefined) patch['label'] = str(data, 'label')
        if (data['sampleData'] !== undefined) patch['sampleData'] = obj(data, 'sampleData')
        if (data['description'] !== undefined) patch['description'] = str(data, 'description') || undefined
        if (data['fields'] !== undefined) patch['fields'] = Array.isArray(data['fields']) ? data['fields'] : undefined
        if (Object.keys(patch).length === 0) throw new Error('无可更新字段')
        return repo.update<TemplateVersion>('templateVersions', id, patch)
      }
      case 'tplv:remove':
        await assertMutable('templateVersions', str(data, '_id'))
        return repo.archive('templateVersions', str(data, '_id'))

      // ── 片段族 / 版本 ──
      case 'frg:list':
        return repo.list<Fragment>('fragments', { archived: false })
      case 'frg:save': {
        const id = str(data, '_id')
        const meta = {
          brandId: str(data, 'brandId'), name: str(data, 'name'),
          description: str(data, 'description') || undefined,
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
      case 'frgv:list':
        return repo.list<FragmentVersion>('fragmentVersions', { archived: false })
      case 'frgv:update': {
        const id = str(data, '_id')
        await assertMutable('fragmentVersions', id)
        const patch: Record<string, unknown> = {}
        if (data['source'] !== undefined) patch['source'] = obj(data, 'source') as unknown as FragmentVersion['source']
        if (data['label'] !== undefined) patch['label'] = str(data, 'label')
        if (data['policy'] !== undefined) patch['policy'] = obj(data, 'policy') as unknown as FragmentVersion['policy']
        if (data['sampleData'] !== undefined) patch['sampleData'] = obj(data, 'sampleData')
        if (data['type'] !== undefined) patch['type'] = str(data, 'type') || 'product'
        if (data['description'] !== undefined) patch['description'] = str(data, 'description') || undefined
        if (data['fields'] !== undefined) patch['fields'] = Array.isArray(data['fields']) ? data['fields'] : undefined
        if (Object.keys(patch).length === 0) throw new Error('无可更新字段')
        return repo.update<FragmentVersion>('fragmentVersions', id, patch)
      }
      case 'frgv:remove':
        await assertMutable('fragmentVersions', str(data, '_id'))
        return repo.archive('fragmentVersions', str(data, '_id'))

      // R22b 版本渲染预览（自定义库）：html+css 就近 inline，示例数据填充，单版本单渲
      case 'version:render': {
        const cat = str(data, 'cat') === 'template' ? 'template' : 'fragment'
        const id = str(data, '_id')
        const v = cat === 'template'
          ? await repo.get<TemplateVersion>('templateVersions', id)
          : await repo.get<FragmentVersion>('fragmentVersions', id)
        if (!v) throw new Error('版本不存在')
        const stages = await compose({
          templateHtml: v.source.html,
          templateCss: v.source.cssMode === 'inline' ? v.source.css : undefined,
          placements: [],
          data: (v.sampleData ?? {}) as Record<string, unknown>,
          strict: false,
          outputRoot: deps.outputRoot,
          unoEnabled: true,
        })
        return { html: stages.assembled }
      }

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
          outputRoot: deps.outputRoot,
          unoEnabled: true,
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
      case 'mail:preview': {
        // 草稿组合预览（不落库不写产物；R20 编辑页实时预览用）
        const tv = await repo.get<TemplateVersion>('templateVersions', str(data, 'templateVersionId'))
        if (!tv) throw new Error('模板版本不存在')
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
          outputRoot: deps.outputRoot,
          unoEnabled: true,
        })
        return { html: stages.assembled }
      }
      case 'mail:readFinal': {
        const mail = await repo.get<Mail>('mails', str(data, '_id'))
        if (!mail?.outputs.final) throw new Error('尚未生成产物')
        return readOutput(deps.outputRoot, mail.outputs.final)
      }
      // ── 导出（约定：单封 .html(final) / 批量 .zip 含各形态 assembled/inlined/final，§6.3） ──
      case 'mail:export': {
        const ids = Array.isArray(data['ids']) ? (data['ids'] as unknown[]).map(String).filter(Boolean) : []
        const outPath = str(data, 'outPath')
        if (ids.length === 0) throw new Error('ids 必填')
        if (!outPath) throw new Error('outPath 必填（os.pickSave 结果）')
        const read = async (rel?: string): Promise<string> => (rel ? await readOutput(deps.outputRoot, rel) : '')
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
        if (items.length === 0) throw new Error('所选邮件均无产物，请先生成')
        if (items.length === 1 && !outPath.endsWith('.zip')) {
          await fs.writeFile(outPath, items[0]!.final, 'utf8')
          return { count: 1, outPath }
        }
        // zip 内文件名：名称非法字符替换为 _，空名回退 id；每封含三个形态
        const safe = (s: string): string => s.replace(/[\\/:*?"<>|]/g, '_').trim() || 'mail'
        const enc = (s: string): Uint8Array => new TextEncoder().encode(s)
        const files: Record<string, Uint8Array> = {}
        for (const it of items) {
          if (it.assembled) files[`${safe(it.name)}.assembled.html`] = enc(it.assembled)
          if (it.inlined) files[`${safe(it.name)}.inlined.html`] = enc(it.inlined)
          if (it.final) files[`${safe(it.name)}.final.html`] = enc(it.final)
        }
        await fs.writeFile(outPath, zipSync(files, { level: 6 }))
        return { count: items.length, outPath }
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

      // ── 系统内容预览渲染（R5 就近 css + R19 组合预览：placements 非空 → 片段/模板统一组合入口） ──
      case 'system:render': {
        const sel = obj(data, 'selector') as unknown as SystemSelector
        if (!sel?.brandCode || !sel?.kind || !sel?.familyCode) throw new Error('selector 需含 brandCode/kind/familyCode')
        const raw = Array.isArray(data['placements']) ? (data['placements'] as Payload[]) : []
        if (raw.length === 0) return await renderSystemPreview(resolveEdmRoot(), sel)
        return await renderSystemCompose(
          resolveEdmRoot(),
          sel,
          raw.map((p) => ({
            selector: p['selector'] as unknown as SystemSelector,
            slot: String(p['slot'] ?? ''),
            order: typeof p['order'] === 'number' ? p['order'] : undefined,
            repeat: typeof p['repeat'] === 'number' ? p['repeat'] : undefined,
            data: (p['data'] as Record<string, unknown> | undefined) ?? undefined,
          })),
        )
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
      // ── 系统内容编辑（R12–R14）：写/改名/删，全部过门控 + 根内限制 ──
      case 'system:canEdit':
        return { canEdit: systemEditable() }
      case 'system:writeFile': {
        assertSystemEditable()
        const file = str(data, 'file')
        if (!SYSTEM_FILE_EXTS.has(path.extname(file))) throw new Error(`不允许的文件类型：${path.extname(file) || '(无扩展名)'}`)
        const abs = confine(file)
        await fs.mkdir(path.dirname(abs), { recursive: true })
        await fs.writeFile(abs, String(data['content'] ?? ''), 'utf8')
        return true
      }
      case 'system:rename': {
        assertSystemEditable()
        const file = str(data, 'file')
        const newName = str(data, 'newName').trim()
        if (!newName || /[/\\]|\.\./.test(newName)) throw new Error('新名称非法（不得含路径分隔符）')
        const abs = confine(file)
        const dst = path.join(path.dirname(abs), newName)
        if (dst !== abs && !dst.startsWith(resolveEdmRoot() + path.sep)) throw new Error('越权路径')
        let exists = false
        try {
          await fs.access(dst)
          exists = true
        } catch {
          /* 不存在即目标可用 */
        }
        if (exists) throw new Error(`「${newName}」已存在，请先处理同名冲突`)
        await fs.rename(abs, dst)
        return relOf(dst)
      }
      case 'system:remove': {
        assertSystemEditable()
        const abs = confine(str(data, 'file'))
        if (abs === resolveEdmRoot()) throw new Error('不能删除 EDM 根目录')
        let exists = false
        try {
          await fs.access(abs)
          exists = true
        } catch {
          /* 不存在即视为已删除（幂等，避免 ENOENT，#7） */
        }
        if (exists) await fs.rm(abs, { recursive: true, force: true })
        return true
      }
      // ── 自定义内容库派生（R21）：assets 系统内容 → NeDB 自定义可编辑副本（origin='custom'，ULID 主键） ──
      // kind: brand=派生品牌下全部族+版本（挂同一品牌，不建重复品牌实体）；family=族+全部版本；
      //       version=族壳+单版本副本。目标品牌取另存落点首段（跨品牌派生），缺省回落源品牌。
      case 'system:derive': {
        const kind = str(data, 'kind')
        const name = str(data, 'name').trim()
        const brandCode = str(data, 'brandCode')
        const cat = str(data, 'cat') === 'template' ? 'template' : 'fragment'
        const familyCode = str(data, 'familyCode')
        const versionDir = str(data, 'versionDir')
        const target = str(data, 'target')
        if (!name) throw new Error('名称必填')
        const root = resolveEdmRoot()
        const model = await loadEdmModel(root)
        const srcBrand = model.brands.find((b) => b.code === brandCode)
        if (!srcBrand) throw new Error(`系统品牌「${brandCode}」不存在`)
        const counts = { brands: 0, fragments: 0, fragmentVersions: 0, templates: 0, templateVersions: 0 }
        const readFileOr = async (p: string): Promise<string> => {
          try {
            return await fs.readFile(p, 'utf8')
          } catch {
            return ''
          }
        }
        const targetBrandCode = (target.split('/')[0] ?? '').trim() || brandCode
        const brandIdOf = async (code: string): Promise<string> => {
          const brands = await repo.list<Brand>('brands', { archived: false })
          const hit = brands.find((b) => b.code === code)
          if (hit) return hit._id
          counts.brands++
          const meta = model.brands.find((b) => b.code === code)
          return (await repo.insert<Brand>('brands', { code, name: meta?.meta.name ?? code, origin: 'custom' }))._id
        }
        const deriveFragmentFamily = async (
          fam: FragmentFamilyNode,
          bid: string,
          only?: VersionNode<FragmentVersionMeta>,
        ): Promise<void> => {
          const frg = await repo.insert<Fragment>('fragments', {
            brandId: bid, name, description: fam.meta.description,
            type: fam.meta.type || 'product', origin: 'custom',
          })
          counts.fragments++
          let latest: { id: string; version: number } | null = null
          for (const v of only ? [only] : fam.versions) {
            const n = versionNumberOf(v.dir, v.meta.version)
            const policy = v.meta.policy ?? fam.meta.policy
            const fv = await repo.insert<FragmentVersion>('fragmentVersions', {
              fragmentId: frg._id, brandId: bid, version: n, label: `v${n}`, type: frg.type,
              source: {
                html: await readFileOr(v.sourcePath),
                css: await collectSystemCssContent(root, { brandCode: srcBrand.code, kind: 'fragment', familyCode: fam.code, versionDir: v.dir }),
                cssMode: 'inline',
              },
              policy: { blacklist: policy?.blacklist ?? [], whitelist: policy?.whitelist ?? [] },
              dataSchema: fam.meta.dataSchema,
              fields: v.meta.fields ?? fam.meta.fields ?? undefined,
              sampleData: v.sample ?? undefined,
              origin: 'custom',
            })
            counts.fragmentVersions++
            if (!latest || n > latest.version) latest = { id: fv._id, version: n }
          }
          if (latest) await repo.update<Fragment>('fragments', frg._id, { latestVersionId: latest.id })
        }
        const deriveTemplateFamily = async (
          fam: TemplateFamilyNode,
          bid: string,
          only?: VersionNode<TemplateVersionMeta>,
        ): Promise<void> => {
          const tpl = await repo.insert<Template>('templates', {
            brandId: bid, name, description: fam.meta.description, origin: 'custom',
          })
          counts.templates++
          let latest: { id: string; version: number } | null = null
          for (const v of only ? [only] : fam.versions) {
            const n = versionNumberOf(v.dir, v.meta.version)
            const tv = await repo.insert<TemplateVersion>('templateVersions', {
              templateId: tpl._id, brandId: bid, version: n, label: `v${n}`,
              source: {
                html: await readFileOr(v.sourcePath),
                css: await collectSystemCssContent(root, { brandCode: srcBrand.code, kind: 'template', familyCode: fam.code, versionDir: v.dir }),
                cssMode: 'inline',
              },
              slots: (fam.meta.slots ?? []).map((s) => ({ key: s.key, type: s.type, required: false, multiple: false })),
              dataSchema: fam.meta.dataSchema,
              fields: v.meta.fields ?? undefined,
              sampleData: v.sample ?? undefined,
              origin: 'custom',
            })
            counts.templateVersions++
            if (!latest || n > latest.version) latest = { id: tv._id, version: n }
          }
          if (latest) await repo.update<Template>('templates', tpl._id, { latestVersionId: latest.id })
        }
        const bid = await brandIdOf(targetBrandCode)
        if (kind === 'brand') {
          for (const fam of srcBrand.fragments) await deriveFragmentFamily(fam, bid)
          for (const fam of srcBrand.templates) await deriveTemplateFamily(fam, bid)
        } else if (kind === 'family') {
          if (cat === 'template') {
            const fam = srcBrand.templates.find((f) => f.code === familyCode)
            if (!fam) throw new Error(`系统模板族「${familyCode}」不存在`)
            await deriveTemplateFamily(fam, bid)
          } else {
            const fam = srcBrand.fragments.find((f) => f.code === familyCode)
            if (!fam) throw new Error(`系统片段族「${familyCode}」不存在`)
            await deriveFragmentFamily(fam, bid)
          }
        } else if (kind === 'version') {
          if (cat === 'template') {
            const fam = srcBrand.templates.find((f) => f.code === familyCode)
            const v = fam?.versions.find((x) => x.dir === versionDir)
            if (!fam || !v) throw new Error(`系统模板版本「${familyCode}/${versionDir || 'default'}」不存在`)
            await deriveTemplateFamily(fam, bid, v)
          } else {
            const fam = srcBrand.fragments.find((f) => f.code === familyCode)
            const v = fam?.versions.find((x) => x.dir === versionDir)
            if (!fam || !v) throw new Error(`系统片段版本「${familyCode}/${versionDir || 'default'}」不存在`)
            await deriveFragmentFamily(fam, bid, v)
          }
        } else {
          throw new Error(`非法 kind: ${kind}`)
        }
        return counts
      }
      default:
        throw new Error(`未实现: ${action}`)
    }
  })

  return { share }
}
