/**
 * 内容管理服务（plans/11）：文章 CRUD + 字数/摘要入库 + resolver 读库回调。
 * - 数据落 NeDB contents 集合（@sshk/repository），随备份 zip 导出
 * - 字数/摘要在保存时用 rich-text 提纯 HTML 后算好入库，列表直出不解析 HTML
 * - resolver 供 ShareHub 注入（core 不依赖 repository，宿主在此读库）
 */
import type { Repository, ContentDoc } from '@sshk/repository'
import { countHtmlWords, htmlToPlainText, toDisplayHtml } from '@sshk/rich-text/pure'
import { AppError, format, ISO_WITH_OFFSET, toMs } from '@sshk/shared'
import type { ContentSaveInput, ContentRecord, ContentStatus, ShareContentResolverResult } from '@sshk/shared'

const SUMMARY_MAX = 120

function toRecord(doc: ContentDoc): ContentRecord {
  return {
    _id: doc._id,
    name: doc.name,
    html: doc.html,
    summary: doc.summary,
    description: doc.description,
    tags: doc.tags,
    status: doc.status,
    // 空串哨兵 = 无定时（定时到期翻 published 时主进程写 '' 清空），统一归一为 undefined
    publishAt: doc.publishAt ? doc.publishAt : undefined,
    wordCount: doc.wordCount,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    archived: doc.archived,
  }
}

/** 摘要：提纯文本压成单行后截取前 120 字（保存时算好） */
function makeSummary(html: string): string {
  const text = htmlToPlainText(html).replace(/\s+/g, ' ').trim()
  return text.length > SUMMARY_MAX ? `${text.slice(0, SUMMARY_MAX)}…` : text
}

export async function contentList(repo: Repository): Promise<ContentRecord[]> {
  const rows = await repo.list<ContentDoc>('contents', { archived: false })
  return rows.map(toRecord)
}

export async function contentGet(repo: Repository, id: string): Promise<ContentRecord | null> {
  const doc = await repo.get<ContentDoc>('contents', String(id ?? ''))
  return doc && !doc.archived ? toRecord(doc) : null
}

/** 新建或更新：_id 存在且命中则更新，否则新建。字数/摘要强制重算，status 缺省 draft。
 *  status==='scheduled' 时 publishAt 必填且须为未来时刻；到点由定时器自动翻 published（见 startContentScheduler）。 */
export async function contentSave(repo: Repository, input: ContentSaveInput): Promise<ContentRecord> {
  const name = String(input?.name ?? '').trim()
  // 表单类校验失败 = 预期业务失败，走 AppError(validation)（warn 落盘，不刷终端堆栈——#128 用户反馈）
  if (!name) throw new AppError('内容名称不能为空', 'validation')
  const html = String(input?.html ?? '')
  // status 白名单校验（CR-43）：渲染层传入的任意字符串不得直接入库污染列表过滤（C 公用列只认 published）
  const rawStatus = input.status ?? 'draft'
  const ALLOWED_STATUS: ContentStatus[] = ['draft', 'published', 'retracted', 'scheduled']
  if (!ALLOWED_STATUS.includes(rawStatus)) throw new AppError(`未知的内容状态：${rawStatus}`, 'validation')
  const status = rawStatus
  let publishAt: string | undefined
  if (status === 'scheduled') {
    // 兼容数字毫秒（历史调用）与 ISO 字符串两种入参；入库统一 ISO 带 +08:00（项目铁律，禁 toISOString）
    const raw = input.publishAt
    // P0-3：统一走 shared toMs（ISO 带 +08:00 / 数字毫秒均可解析；Date.parse 已 lint 禁用）
    const t = typeof raw === 'number' ? raw : (toMs(String(raw ?? '')) ?? NaN)
    if (!Number.isFinite(t) || t <= Date.now()) throw new AppError('定时发布时间必须晚于当前时间', 'validation')
    publishAt = format(t, ISO_WITH_OFFSET)
  }
  const patch = {
    name,
    html,
    summary: makeSummary(html),
    description: input.description?.trim() || undefined,
    tags: Array.isArray(input.tags) ? input.tags.map((t) => String(t)).filter(Boolean) : [],
    status,
    publishAt,
    wordCount: countHtmlWords(html),
  }
  const id = String(input?._id ?? '')
  if (id) {
    const updated = await repo.update<ContentDoc>('contents', id, patch)
    if (updated) {
      if (status === 'scheduled') startContentScheduler(repo)
      return toRecord(updated)
    }
  }
  const inserted = await repo.insert<ContentDoc>('contents', patch as Omit<ContentDoc, '_id' | 'createdAt' | 'updatedAt' | 'archived'>)
  if (status === 'scheduled') startContentScheduler(repo)
  return toRecord(inserted)
}

/** 删除：默认软删（archived），hard=true 时硬删（调用方须二次确认） */
export async function contentRemove(repo: Repository, id: string, hard = false): Promise<boolean> {
  const docId = String(id ?? '')
  if (!docId) return false
  if (hard) return (await repo.remove('contents', docId)) > 0
  return (await repo.archive('contents', docId)) !== null
}

/**
 * ShareHub 内容 resolver（注入用）：按 contentId 读库，返回展示态 HTML 供内核渲染阅读页。
 * 返回 null 表示内容不存在/已归档 → 内核 404（避免删除后链接悬空出旧内容）。
 * 注意：core 不依赖 repository；此处在宿主层读库并做 toDisplayHtml 协议转换。
 */
export function makeContentResolver(repo: Repository): (contentId: string) => Promise<ShareContentResolverResult | null> {
  return async (contentId: string) => {
    const doc = await repo.get<ContentDoc>('contents', contentId)
    if (!doc || doc.archived) return null
    return {
      title: doc.name,
      html: toDisplayHtml(doc.html),
      summary: doc.summary,
      // #131 分享页新闻详情要显示发布时间：定时发布取 publishAt，普通内容回落创建时刻（types 字段语义保持 publishAt）
      publishAt: doc.publishAt || doc.createdAt,
      updatedAt: doc.updatedAt,
    }
  }
}

// ── 定时发布（plans/11 + 2026-11-19）：status==='scheduled' 的到点自动翻 published ──
// 主进程内单例定时器，轮询扫描 scheduled 记录，命中即翻 published 并清 publishAt。
// F-01（2026-11-22 复核）：启动链（main/index.ts whenReady）无条件调用 startContentScheduler——
// 此前仅 contentSave(scheduled) 时启动，应用重启后定时任务永久失效（到点不翻 published、
// 列表 resolver 只查 published，内容静默消失且无任何报错）。
let schedulerTimer: ReturnType<typeof setInterval> | null = null
export function startContentScheduler(repo: Repository): void {
  if (schedulerTimer) return
  const tick = async () => {
    try {
      const now = Date.now()
      const rows = await repo.list<ContentDoc>('contents', { archived: false, status: 'scheduled' })
      // publishAt 入库为 ISO 带 +08:00 字符串，统一走 shared toMs 解析（P0-3；Number() 对该格式恒 NaN，曾致定时器永不触发）
      const due = rows.filter((d) => {
        if (!d.publishAt) return false
        const t = toMs(d.publishAt)
        return t !== null && t <= now
      })
      for (const doc of due) {
        // 空串为「已清」哨兵（$set 不接受 undefined 清空）；toRecord 对 undefined/'' 统一视为无定时
        await repo.update<ContentDoc>('contents', doc._id, { status: 'published', publishAt: '' })
      }
      if (due.length) console.log(`[content] 定时发布：${due.length} 条已到期翻为已发布`)
    } catch (err) {
      console.error('[content] 定时发布扫描失败', err)
    }
  }
  void tick()
  schedulerTimer = setInterval(() => { void tick() }, 30_000)
}

/** 退出清理：停止轮询定时器（main/index.ts onBeforeQuit 调用） */
export function stopContentScheduler(): void {
  if (schedulerTimer) { clearInterval(schedulerTimer); schedulerTimer = null }
}

/** HTML 转义（列表页标题/摘要防 XSS） */
function esc(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
}

/**
 * ShareHub 方案 C 公用总链的列表页 resolver（plans/11 §四）：宿主查库构造「仅已发布」文章列表页 HTML。
 * core 只输出 HTML 不碰数据；每条链接带 ?id=<cnt>&ak=<accessKey>，点进单篇走同一个 content 路由的 ?id 分支。
 */
export function makeContentListResolver(repo: Repository): (accessKey: string) => Promise<string> {
  return async (accessKey: string) => {
    const docs = await repo.list<ContentDoc>('contents', { archived: false, status: 'published' })
    const ak = accessKey ? `&ak=${encodeURIComponent(accessKey)}` : ''
    const items = docs
      .map((d) => `<li><a href="?id=${encodeURIComponent(d._id)}${ak}">${esc(d.name)}</a>${d.summary ? `<p class="s">${esc(d.summary)}</p>` : ''}<time>${esc(d.updatedAt)}</time></li>`)
      .join('')
    return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>文章列表</title><style>
      body{font:15px/1.7 system-ui,sans-serif;max-width:720px;margin:40px auto;padding:0 20px;color:#1f2430;background:#fff}
      h1{font-size:24px;border-bottom:1px solid #e8eaf0;padding-bottom:12px} ul{list-style:none;padding:0}
      li{padding:12px 0;border-bottom:1px solid #f0f1f5} a{font-size:17px;color:#2563eb;text-decoration:none} a:hover{text-decoration:underline}
      .s{color:#6b7280;font-size:13px;margin:4px 0} time{color:#9ca3af;font-size:12px}
    </style></head><body><h1>文章列表</h1>${items ? `<ul>${items}</ul>` : '<p>暂无已发布内容</p>'}</body></html>`
  }
}
