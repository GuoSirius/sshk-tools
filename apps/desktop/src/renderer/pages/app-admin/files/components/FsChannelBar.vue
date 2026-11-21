<script setup lang="ts">
/**
 * 通道切换条（P4-4 自 FileExplorerPage 拆出）：上传通道下拉 + 通道状态提示。
 * 通道 = 文件管理（通道配置）的 remote/cloud profile；密钥只在 main（safeStorage），渲染层零接触。
 */
import type { FsChannelInfo } from '@sshk/shared'

defineProps<{
  channels: FsChannelInfo[]
  activeChannel: FsChannelInfo | null
}>()

const profileId = defineModel<string>('profileId', { default: '' })
</script>

<template>
  <div class="fs-channel-bar">
    <el-select v-model="profileId" size="small" class="fs-channel-select" placeholder="选择上传通道" filterable>
      <el-option v-for="c in channels" :key="c.id" :value="c.id" :label="c.name">
        <span class="fs-channel-opt">
          <el-tag size="small" :type="c.type === 'cloud' ? 'success' : c.type === 'local' ? 'info' : 'warning'" class="fs-opt-tag">
            {{ c.type === 'cloud' ? '云' : c.type === 'local' ? '本地' : (c.protocol ?? '远端').toUpperCase() }}
          </el-tag>
          <span class="fs-opt-name">{{ c.name }}</span>
          <span class="fs-opt-detail">{{ c.detail }}</span>
          <el-tag v-if="c.isDefault" size="small" type="primary" effect="plain" class="fs-opt-tag">默认</el-tag>
        </span>
      </el-option>
    </el-select>
    <span v-if="activeChannel" class="fs-channel-meta">
      <span v-if="!activeChannel.hasSecret" class="fs-warn">密钥未配置，去「通道配置」填写</span>
      <span v-else-if="!activeChannel.writable" class="fs-warn">该厂商仅支持浏览（写操作支持阿里云 OSS / AWS S3）</span>
      <span v-else class="fs-ok">已连接 · {{ activeChannel.detail }}</span>
    </span>
  </div>
</template>

<style scoped>
.fs-channel-bar { display: flex; align-items: center; gap: 10px; }
.fs-channel-select { width: 260px; }
.fs-channel-opt { display: flex; align-items: center; gap: 8px; }
.fs-opt-name { font-weight: 600; }
.fs-opt-detail { font-size: 12px; opacity: .6; }
.fs-channel-meta { font-size: 12px; opacity: .75; }
.fs-warn { color: var(--el-color-warning); }
.fs-ok { color: var(--el-color-success); }
</style>
