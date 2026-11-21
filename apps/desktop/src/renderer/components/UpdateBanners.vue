<script setup lang="ts">
import type { UpdateState } from '../composables/useUpdateBanner'

/**
 * 顶部横幅簇（P6-8 CR-42 终拆自 App.vue）：更新三态横幅（下载进度/完成安装/失败重试，均可关闭）
 * + dev 新工具发现横幅。状态由壳层 composables 持有，本组件纯展示 + 事件上抛。
 */
defineProps<{
  /** 更新横幅三态（null=不显示更新横幅） */
  kind: 'downloading' | 'downloaded' | 'error' | null
  /** 更新状态（useUpdateBanner 单例） */
  updater: UpdateState
  /** dev 新工具发现横幅开关与名单（useNewToolScan 单例） */
  showNewTools: boolean
  newTools: { name: string }[]
}>()

const emit = defineEmits<{
  (e: 'dismiss-update'): void
  (e: 'install-update'): void
  (e: 'retry-update'): void
  (e: 'dismiss-new-tools'): void
}>()
</script>

<template>
  <!-- 更新横幅：下载中显示进度条 / 完成提示安装 / 失败重试；均可关闭（项10：允许用户忽略，稍后自行重启） -->
  <div v-if="kind === 'downloading'" class="update-banner update-banner--progress">
    <span class="update-banner-progress">
      正在下载新版本 v{{ updater.version }} · {{ updater.percent ?? 0 }}%
      <el-progress :percentage="updater.percent ?? 0" :stroke-width="6" :show-text="false" style="width: 180px; display: inline-block; vertical-align: middle; margin-left: 8px" />
    </span>
    <el-button size="small" text type="info" title="关闭提示（下载仍在后台继续）" @click="emit('dismiss-update')">关闭</el-button>
  </div>
  <div
    v-else-if="kind === 'downloaded'"
    class="update-banner update-banner--ok"
  >
    <span>新版本 v{{ updater.version }} 已下载完成，重启即可生效</span>
    <span class="update-banner-actions">
      <el-button size="small" type="primary" @click="emit('install-update')">立即重启安装</el-button>
      <el-button size="small" text type="info" title="关闭提示（稍后可点顶栏按钮安装）" @click="emit('dismiss-update')">关闭</el-button>
    </span>
  </div>
  <div
    v-else-if="kind === 'error'"
    class="update-banner update-banner--err"
  >
    <span>更新出错：{{ updater.error }}</span>
    <span class="update-banner-actions">
      <el-button size="small" text @click="emit('retry-update')">重试</el-button>
      <el-button size="small" text type="info" title="关闭提示" @click="emit('dismiss-update')">关闭</el-button>
    </span>
  </div>

  <div
    v-else-if="showNewTools"
    class="update-banner update-banner--ok"
  >
    <span>检测到新工具：{{ newTools.map((t) => t.name).join('、') }} —— 重启 pnpm dev 后即可加载（渲染层组件需构建期发现）</span>
    <el-button size="small" text @click="emit('dismiss-new-tools')">知道了</el-button>
  </div>
</template>
