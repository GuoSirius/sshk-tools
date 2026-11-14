import { computed, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'

/**
 * 模板工具共享状态（模块级单例）：各页面共享调用通道与日志。
 * toolId 由宿主注入（单一来源 = manifest.id → 宿主目录裁决 → :tool-id prop），
 * 源码不硬编码任何工具 id；shell 在 setup 阶段同步注入，页面生命周期晚于注入。
 */
export const toolId = ref('')

function assertId(): string {
  if (!toolId.value) throw new Error('toolId 未由宿主注入（shell 必须先注入 toolId 再渲染页面）')
  return toolId.value
}
const PREFIX = computed(assertId)

export function invoke(name: string, ...args: unknown[]): Promise<unknown> {
  return window.api.ipc.invoke(`${PREFIX.value}:${name}`, ...args)
}

// ── 通用调用日志（演示可观测性） ──
export interface LogRow { t: string; ok: boolean; name: string; detail: string }
export const logs = reactive<LogRow[]>([])
function note(ok: boolean, name: string, detail: string): void {
  logs.unshift({ t: new Date().toLocaleTimeString(), ok, name, detail: detail.slice(0, 240) })
  if (logs.length > 60) logs.pop()
}

export async function call<T = unknown>(name: string, ...args: unknown[]): Promise<T | undefined> {
  try {
    const r = await invoke(name, ...args) as T
    note(true, name, JSON.stringify(r))
    return r
  } catch (e) {
    const msg = (e as Error).message
    note(false, name, msg)
    ElMessage.error(`「${name}」调用失败：${msg}`)
    return undefined
  }
}
