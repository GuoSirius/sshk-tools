import { onBeforeUnmount, onMounted, ref } from 'vue'
import { SSHK_DEV } from '@sshk/shared'

/**
 * U1-1 L1 提示层（仅 dev，CR-42 首刀 · P4-1 从 App.vue 抽出）：
 * 窗口 focus / 30s 定时轻扫描 tools/，发现新工具出横幅引导重启（渲染层组件需构建期发现）。
 * dev 判据只用 @sshk/shared 的 SSHK_DEV（D55 铁律），打包版整体不启动。
 */
export interface NewToolItem { id: string; name: string }

const newTools = ref<NewToolItem[]>([])
const newToolsDismissed = ref(false)

async function scanNewTools(): Promise<void> {
  if (!SSHK_DEV || newToolsDismissed.value || newTools.value.length > 0) return
  try {
    const res = await window.api.dev.toolScan()
    newTools.value = res.newTools ?? []
  } catch { /* 打包版 / 旧宿主快照：静默跳过 */ }
}

function dismissNewTools(): void {
  newToolsDismissed.value = true
  newTools.value = []
}

export function useNewToolScan(): {
  newTools: typeof newTools
  scanNewTools: () => Promise<void>
  dismissNewTools: () => void
} {
  let scanTimer: number | undefined
  let offFocus: (() => void) | undefined

  onMounted(() => {
    if (!SSHK_DEV) return
    void scanNewTools()
    const onFocus = (): void => { void scanNewTools() }
    window.addEventListener('focus', onFocus)
    offFocus = () => window.removeEventListener('focus', onFocus)
    scanTimer = window.setInterval(() => { void scanNewTools() }, 30_000)
  })
  onBeforeUnmount(() => {
    if (scanTimer !== undefined) window.clearInterval(scanTimer)
    offFocus?.()
  })

  return { newTools, scanNewTools, dismissNewTools }
}
