import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import { now } from '@sshk/shared'
import {
  edmOutputRel,
  entityId,
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
])

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

  ipc.handle('edm:api', async (_event: IpcMainInvokeEvent, payload: { action: string; data?: Payload }) => {
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
        return repo.update<Brand>('brands', id, meta)
      }
      case 'brand:remove':
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
        return repo.update<Template>('templates', id, meta)
      }
      case 'tpl:remove':
        return repo.archive('templates', str(data, '_id'))

      // ── 模板版本（不可变；保存 = 新版本 D8） ──
      case 'tplv:save': {
        const templateId = str(data, 'templateId')
        const prev = str(data, 'prevVersionId')
        if (!templateId) throw new Error('templateId 必填')
        const tpl = await repo.get<Template>('templates', templateId)
        if (!tpl) throw new Error('模板不存在')
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
        return repo.update<Fragment>('fragments', id, meta)
      }
      case 'frg:remove':
        return repo.archive('fragments', str(data, '_id'))
      case 'frgv:save': {
        const fragmentId = str(data, 'fragmentId')
        const prev = str(data, 'prevVersionId')
        const frg = await repo.get<Fragment>('fragments', fragmentId)
        if (!frg) throw new Error('片段不存在')
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
        // 槽位绑定：片段版本渲染 + 槽位声明式注入
        const bindings: Record<string, string> = {}
        for (const b of mail.bindings) {
          const fv = await repo.get<FragmentVersion>('fragmentVersions', b.fragmentVersionId)
          if (fv) bindings[b.slot] = renderFragment(fv.source.html, (mail.data ?? {}) as Payload)
        }
        const stages = await renderMail({
          templateHtml: tv.source.html,
          bindings,
          data: (mail.data ?? {}) as Payload,
          render: { strict: true, autoEscape: true },
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
      default:
        throw new Error(`未实现: ${action}`)
    }
  })

  return { share }
}
