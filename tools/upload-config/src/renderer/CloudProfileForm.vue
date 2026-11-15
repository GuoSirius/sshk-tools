<script setup lang="ts">
import { Delete } from '@element-plus/icons-vue'
import type { UploadCloudProfile } from '@sshk/shared'

/** 云 profile 编辑表单：profile 是响应式数组内的对象，直接改属性即可回写父级 */
defineProps<{
  profile: UploadCloudProfile
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
      <span class="hint-inline">密钥按此 ID 关联</span>
    </el-form-item>
    <el-form-item label="云厂商">
      <el-select v-model="profile.provider" style="width: 200px">
        <el-option label="阿里云 OSS（已实现）" value="aliyun-oss" />
        <el-option label="腾讯云 COS（扩展点）" value="tencent-cos" />
        <el-option label="AWS S3（扩展点）" value="aws-s3" />
        <el-option label="七牛 Kodo（扩展点）" value="qiniu" />
      </el-select>
    </el-form-item>
    <el-form-item label="地域"><el-input v-model="profile.region" placeholder="oss-cn-hangzhou" /></el-form-item>
    <el-form-item label="Endpoint"><el-input v-model="profile.endpoint" placeholder="可选，覆盖 SDK 默认" /></el-form-item>
    <el-form-item label="Bucket"><el-input v-model="profile.bucket" /></el-form-item>
    <el-form-item label="AccessKey ID"><el-input v-model="profile.accessKeyId" /></el-form-item>
    <el-form-item label="AccessKey Secret">
      <div class="two">
        <el-input
          :model-value="secretValue"
          type="password"
          show-password
          :placeholder="hasSecret ? '已配置，留空保持不变' : '加密存储，不回显'"
          @update:model-value="(v: unknown) => emit('updateSecret', profile.id, String(v ?? ''))"
        />
        <el-button :icon="Delete" :disabled="!hasSecret" @click="emit('clearSecret', profile.id)">清除</el-button>
      </div>
    </el-form-item>
    <el-form-item label="访问域名"><el-input v-model="profile.baseUrl" placeholder="CDN 域名（可选）" /></el-form-item>
  </el-form>
</template>

<style scoped>
.two { display: flex; gap: 8px; width: 100%; }
.two > :first-child { flex: 1; min-width: 0; }
.hint-inline { display: inline; margin-left: 12px; font-size: 12px; opacity: .6; }
</style>
