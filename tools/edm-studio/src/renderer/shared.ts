import { ElMessageBox } from 'element-plus'

/** EDM 共享类型与底层调用（各页面通用） */
export interface Named { _id: string; name: string; [k: string]: unknown }
export interface BrandRow extends Named { code: string }
export interface VersionRow extends Named { version: number; label?: string; type?: string; source?: { html: string }; templateId?: string; fragmentId?: string; slots?: { key: string; type: string }[]; policy?: { blacklist: string[]; whitelist: string[] }; sampleData?: Record<string, unknown>; fields?: unknown[] }
export interface PlacementRow { slot: string; fragmentVersionId: string; order?: number; repeat?: number; data?: Record<string, unknown> }
export interface MailRow extends Named { origin?: 'system' | 'custom'; brandId: string; templateVersionId: string; bindings?: PlacementRow[]; outputs?: Record<string, string>; lastGeneratedAt?: string; data?: Record<string, unknown> }

/**
 * window.api 由桌面端 preload 注入（全局类型声明在 apps/desktop env.d.ts）。
 * edm-studio 独立 tsc 不引入桌面端 env.d.ts，这里做**本地类型化**：
 * 不全局扩充 Window（避免与桌面端 interface Window 声明合并冲突），仅局部断言。
 */
interface SshkOsApi {
  clipboardWrite(text: string): Promise<unknown>
  shellOpen(target: string): Promise<unknown>
  pickSave(opts?: { fileName?: string; extensions?: string[]; defaultPath?: string }): Promise<string>
}
interface SshkApi {
  edm: { api(action: string, data?: Record<string, unknown>): Promise<unknown> }
  os: SshkOsApi
}
function sshkApi(): SshkApi {
  return (window as unknown as { api: SshkApi }).api
}
export const api = (action: string, data?: Record<string, unknown>): Promise<unknown> => sshkApi().edm.api(action, data)
/** os 通道（剪贴板 / 打开产物 / 导出另存为，MailsPage 用） */
export const osApi = (): SshkOsApi => sshkApi().os

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
