import { computed, ref, watch, type ComputedRef, type Ref } from 'vue'
import { ElMessage } from 'element-plus'
import { useUpdater, type UpdateState } from './useUpdater'

/**
 * 更新横幅 + 更新动作（CR-42 首刀 · P4-1 从 App.vue 抽出）：
 * - 状态真相源仍是 useUpdater 单例（主进程推送），本 composable 只补横幅侧状态；
 * - 横幅三态判定（下载中 / 已下载 / 出错）与「用户本轮关闭」记忆都在这里；
 * - checkUpdate / installUpdate 是顶栏更新簇与横幅共用的两个动作，随本 composable 一并导出，
 *   AppHeader 与 App.vue 各取所需，不重复实现。
 */
export type UpdateBannerKind = 'downloading' | 'downloaded' | 'error'

function createBanner(): {
  updater: Ref<UpdateState>
  updateBannerDismissed: Ref<boolean>
  bannerKind: ComputedRef<UpdateBannerKind | null>
  dismissUpdateBanner: () => void
  checkUpdate: () => Promise<void>
  installUpdate: () => Promise<void>
} {
  const { state: updater } = useUpdater()
  /** 更新横幅是否被用户关闭（项10）：仅对当前这一轮版本生效，下次发现新版自动重置 */
  const updateBannerDismissed = ref(false)
  const dismissedForVersion = ref('')
  watch(updater, (u) => {
    if (u.version && u.version !== dismissedForVersion.value) {
      dismissedForVersion.value = u.version
      updateBannerDismissed.value = false
    }
  })

  function dismissUpdateBanner(): void { updateBannerDismissed.value = true }

  /** 三态横幅判定：null = 不显示横幅（含用户已关闭本轮提示） */
  const bannerKind = computed<UpdateBannerKind | null>(() => {
    if (updateBannerDismissed.value) return null
    if (updater.value.phase === 'downloading') return 'downloading'
    if (updater.value.phase === 'downloaded') return 'downloaded'
    if (updater.value.phase === 'error') return 'error'
    return null
  })

  async function checkUpdate(): Promise<void> {
    if (updater.value.phase === 'checking' || updater.value.phase === 'downloading' || updater.value.phase === 'available') return
    const result = await window.api.update.check().catch(() => ({}) as { disabled?: boolean; dev?: boolean; updateAvailable?: boolean; version?: string | null; error?: string })
    if (result.disabled) {
      ElMessage.info('自动更新已禁用（SSHK_APP_AUTO_UPDATE=0）')
    } else if (result.dev) {
      ElMessage.info('开发环境不检查更新')
    } else if (result.error) {
      ElMessage.error('检查更新失败：' + String(result.error))
    } else if (result.updateAvailable) {
      ElMessage.success(`发现新版本 ${String(result.version ?? '')}，已开始下载`)
    } else {
      ElMessage.success('当前已是最新版本')
    }
  }

  /** 下载完成后点击触发退出并安装（electron-updater 在下次启动时落地） */
  async function installUpdate(): Promise<void> {
    const r = await window.api.update.quitAndInstall().catch((err: unknown) => {
      ElMessage.error('安装失败：' + (err as Error).message)
      return null
    })
    if (r && typeof r === 'object' && 'dev' in r) {
      ElMessage.info('dev 更新测试模式：已拦截安装，仅验证下载流程；请手动重启后改回版本号')
    }
  }

  return { updater, updateBannerDismissed, bannerKind, dismissUpdateBanner, checkUpdate, installUpdate }
}

// 模块级单例：横幅关闭记忆全局共享一份，AppHeader / App.vue 谁先调用谁生效。
// 必须惰性创建——本模块随 main.ts 的 import 链在 installPlainApi() 之前求值
// （ESM import 提升），顶层直接 useUpdater() 会读到尚未组装的 window.api，
// dev 启动即抛 TypeError（2026-11-22 修复，4094bbd 引入）。
type UpdateBanner = ReturnType<typeof createBanner>
let banner: UpdateBanner | null = null

export function useUpdateBanner(): UpdateBanner {
  if (!banner) banner = createBanner()
  return banner
}

export type { UpdateState }
