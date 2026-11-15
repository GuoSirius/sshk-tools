<script setup lang="ts">
import { Delete } from '@element-plus/icons-vue'
import type { UploadRemoteProfile } from '@sshk/shared'

/** 远程 profile 编辑表单：profile 是响应式数组内的对象，直接改属性即可回写父级 */
defineProps<{
  profile: UploadRemoteProfile
  hasSecret: boolean
  secretValue: string
}>()
const emit = defineEmits<{
  (e: 'updateSecret', id: string, value: string): void
  (e: 'clearSecret', id: string): void
}>()
</script>

<template>
  <el-form label-width="120px" size="small">
    <el-form-item label="名称"><el-input v-model="profile.name" /></el-form-item>
    <el-form-item label="ID">
      <el-input :model-value="profile.id" disabled />
      <span class="hint-inline">密钥按此 ID 关联，勿随意修改</span>
    </el-form-item>
    <el-form-item label="协议">
      <el-select v-model="profile.protocol" style="width: 160px">
        <el-option label="FTP" value="ftp" />
        <el-option label="SFTP" value="sftp" />
      </el-select>
    </el-form-item>
    <el-form-item label="主机 / 端口">
      <div class="two">
        <el-input v-model="profile.host" placeholder="192.168.1.10" />
        <el-input-number v-model="profile.port" :min="1" :max="65535" />
      </div>
    </el-form-item>
    <el-form-item label="用户名"><el-input v-model="profile.username" /></el-form-item>
    <el-form-item label="密码 / 口令">
      <div class="two">
        <el-input
          :model-value="secretValue"
          type="password"
          show-password
          :placeholder="hasSecret ? '已配置，留空保持不变' : '加密存储，不回显'"
          @update:model-value="(v: unknown) => emit('updateSecret', profile.id, String(v ?? ''))"
        />
        <el-button size="small" :icon="Delete" :disabled="!hasSecret" @click="emit('clearSecret', profile.id)">清除</el-button>
      </div>
    </el-form-item>
    <el-form-item label="远端位置"><el-input v-model="profile.remoteDir" placeholder="/edm/out" /></el-form-item>
    <el-form-item label="访问域名"><el-input v-model="profile.baseUrl" placeholder="https://cdn.example.com" /></el-form-item>
    <el-form-item label="被动模式">
      <el-switch v-model="profile.passive" />
      <span class="hint-inline">仅 FTP 生效</span>
    </el-form-item>
  </el-form>
</template>

<style scoped>
.two { display: flex; align-items: center; gap: 8px; width: 100%; }
.two > :first-child { flex: 1; min-width: 0; }
.hint-inline { display: inline; margin-left: 12px; font-size: 12px; opacity: .6; }
</style>
