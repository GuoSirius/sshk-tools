import { ElMessageBox } from 'element-plus'

/** EDM 共享类型与底层调用（各页面通用） */
export interface Named { _id: string; name: string; [k: string]: unknown }
export interface BrandRow extends Named { code: string }
export interface VersionRow extends Named { version: number; label?: string; source?: { html: string }; templateId?: string; fragmentId?: string; slots?: { key: string; type: string }[]; policy?: { blacklist: string[]; whitelist: string[] }; sampleData?: Record<string, unknown> }
export interface MailRow extends Named { templateVersionId: string; bindings?: { slot: string; fragmentVersionId: string }[]; outputs?: Record<string, string>; lastGeneratedAt?: string; data?: Record<string, unknown> }

export const api = (action: string, data?: Record<string, unknown>) => window.api.edm.api(action, data)

/** 系统内容（R8 播种，origin='system'）只读：编辑/删除不可用，派生走「另存为」 */
export function isSystem(row: Named): boolean {
  return row.origin === 'system'
}

/** 统一删除确认（危险操作二次确认） */
export async function confirmRemove(title: string, name: string, run: () => Promise<void>): Promise<void> {
  try {
    await ElMessageBox.confirm(`确定删除「${name}」？记录将归档。`, title, { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' })
  } catch {
    return
  }
  await run()
}
