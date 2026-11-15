<script setup lang="ts">
import { computed } from 'vue'
import { Connection, Delete, View } from '@element-plus/icons-vue'
import {
  uploadVendorMeta,
  uploadVendorOptions,
  type UploadCloudProfile,
} from '@sshk/shared'

/** 云 profile 编辑表单：profile 是响应式数组内的对象，直接改属性即可回写父级 */
const props = defineProps<{
  profile: UploadCloudProfile
  hasSecret: boolean
  secretValue: string
  testing?: boolean
  testResult?: string
}>()
const emit = defineEmits<{
  (e: 'updateSecret', id: string, value: string): void
  (e: 'clearSecret', id: string): void
  (e: 'revealSecret', id: string): void
  (e: 'test', id: string): void
}>()

const vendors = uploadVendorOptions()
const meta = computed(() => uploadVendorMeta(props.profile.provider))
</script>

<template>
  <el-form label-width="120px" size="small">
    <el-form-item label="名称"><el-input v-model="profile.name" /></el-form-item>
    <el-form-item label="ID">
      <el-input :model-value="profile.id" disabled />
      <span class="hint-inline">密钥按此 ID 关联</span>
    </el-form-item>
    <el-form-item label="云厂商">
      <el-select v-model="profile.provider" filterable style="width: 280px">
        <el-option v-for="v in vendors" :key="v.value" :label="v.label" :value="v.value" />
      </el-select>
      <span class="hint-inline">SDK：{{ meta.sdk }}</span>
    </el-form-item>
    <el-form-item label="地域">
      <el-select
        v-model="profile.region"
        filterable
        allow-create
        clearable
        default-first-option
        :placeholder="meta.regionHint"
        style="width: 100%"
      >
        <el-option v-for="r in meta.regions" :key="r.value" :label="r.label" :value="r.value" />
      </el-select>
      <div class="hint-block">{{ meta.regionHint }}；下拉可直接键入未预置的地域</div>
    </el-form-item>
    <el-form-item label="Endpoint">
      <el-select
        v-model="profile.endpoint"
        filterable
        allow-create
        clearable
        default-first-option
        :placeholder="meta.endpointHint"
        style="width: 100%"
      >
        <el-option v-for="e in meta.endpoints" :key="e.value" :label="e.label" :value="e.value" />
      </el-select>
      <div class="hint-block">{{ meta.endpointHint }}；下拉可直接键入未预置的地址</div>
    </el-form-item>
    <el-form-item label="Bucket"><el-input v-model="profile.bucket" /></el-form-item>
    <el-form-item label="AccessKey ID"><el-input v-model="profile.accessKeyId" /></el-form-item>
    <el-form-item label="AccessKey Secret">
      <div class="two">
        <el-input
          :model-value="secretValue"
          type="password"
          show-password
          :placeholder="hasSecret ? '点击查看可回显已存密钥；留空保持不变' : '加密存储，可点眼睛查看 / 直接输入'"
          @update:model-value="(v: unknown) => emit('updateSecret', profile.id, String(v ?? ''))"
        />
        <el-tooltip content="查看 / 回显已保存的密钥" placement="top">
          <el-button size="small" :icon="View" :disabled="!hasSecret" @click="emit('revealSecret', profile.id)">查看</el-button>
        </el-tooltip>
        <el-button size="small" :icon="Delete" :disabled="!hasSecret" @click="emit('clearSecret', profile.id)">清除</el-button>
      </div>
    </el-form-item>
    <el-form-item label="访问域名"><el-input v-model="profile.baseUrl" placeholder="CDN 域名（可选）" /></el-form-item>
    <el-form-item label="连通性">
      <el-button size="small" type="primary" plain :icon="Connection" :loading="testing" @click="emit('test', profile.id)">
        测试连接
      </el-button>
      <span v-if="testResult" class="test-result" :class="{ 'is-error': testResult.startsWith('✗') }">{{ testResult }}</span>
      <span v-else class="hint-inline">验证厂商 / 地域 / Endpoint / AK / Bucket 是否正确，不写任何文件</span>
    </el-form-item>
  </el-form>
</template>

<style scoped>
.two { display: flex; align-items: center; gap: 8px; width: 100%; }
.two > :first-child { flex: 1; min-width: 0; }
.hint-inline { display: inline; margin-left: 12px; font-size: 12px; opacity: .6; }
.hint-block { width: 100%; font-size: 12px; opacity: .6; line-height: 1.5; margin-top: 2px; }
.test-result { margin-left: 12px; font-size: 12px; color: var(--el-color-success); }
.test-result.is-error { color: var(--el-color-danger); }
</style>
