<script setup lang="ts">
import { Connection, Delete, View } from '@element-plus/icons-vue'
import { FormHint, FormGrid } from '@sshk/ui-kit'
import type { UploadRemoteProfile } from '@sshk/shared'

/** 远程 profile 编辑表单：profile 是响应式数组内的对象，直接改属性即可回写父级 */
const props = defineProps<{
  profile: UploadRemoteProfile
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
</script>

<template>
  <el-form label-width="auto" size="small">
    <FormGrid>
      <el-form-item label="名称" required><el-input clearable v-model="profile.name" /></el-form-item>
      <el-form-item label="ID">
        <el-input clearable :model-value="profile.id" disabled />
        <span class="hint-inline">密钥按此 ID 关联，勿随意修改</span>
      </el-form-item>
      <el-form-item label="协议">
        <el-select v-model="profile.protocol">
          <el-option label="FTP" value="ftp" />
          <el-option label="SFTP" value="sftp" />
        </el-select>
      </el-form-item>
      <el-form-item label="主机 / 端口" required>
        <div class="combo">
          <el-input clearable v-model="profile.host" placeholder="192.168.1.10" />
          <el-input-number v-model="profile.port" :min="1" :max="65535" />
        </div>
      </el-form-item>
      <el-form-item label="用户名" required><el-input clearable v-model="profile.username" /></el-form-item>
      <el-form-item label="远端位置"><el-input clearable v-model="profile.remoteDir" placeholder="/edm/out" /></el-form-item>
      <el-form-item label="密码 / 口令">
        <div class="combo">
          <el-input
            :model-value="secretValue"
            type="password"
            show-password
            :placeholder="hasSecret ? '点击查看可回显已存口令；留空保持不变' : '加密存储，可点眼睛查看 / 直接输入'"
            @update:model-value="(v: unknown) => emit('updateSecret', props.profile.id, String(v ?? ''))"
          />
          <el-tooltip content="查看 / 回显已保存的口令" placement="top">
            <el-button :icon="View" :disabled="!hasSecret" @click="emit('revealSecret', props.profile.id)">查看</el-button>
          </el-tooltip>
          <el-button :icon="Delete" :disabled="!hasSecret" @click="emit('clearSecret', props.profile.id)">清除</el-button>
        </div>
      </el-form-item>
      <el-form-item label="访问域名"><el-input clearable v-model="profile.baseUrl" placeholder="https://cdn.example.com" /></el-form-item>
      <el-form-item label="被动模式">
        <el-switch v-model="profile.passive" />
        <span class="hint-inline">仅 FTP 生效</span>
      </el-form-item>
      <el-form-item label="签名URL模板">
        <el-input clearable v-model="profile.signUrlTemplate" placeholder="留空=裸链；如 https://cdn/sign?src={url}&token=..." />
        <FormHint inline detail="视频/音频预览优先用「访问域名 + 文件路径」直链，免下载。若直链需签名鉴权，在此填模板，用 {url} 占位符代表拼好的原始直链（如 https://cdn/x?token=abc&src={url}）。留空则直接用裸链。签名过期导致播放失败时会自动回退为下载后播放。" />
      </el-form-item>
      <el-form-item label="连通性" class="full">
        <div class="combo">
          <el-button type="primary" plain :icon="Connection" :loading="testing" @click="emit('test', props.profile.id)">
            测试连接
          </el-button>
          <span v-if="testResult" class="test-result" :class="{ 'is-error': testResult.startsWith('✗') }">{{ testResult }}</span>
          <span v-else class="hint-inline">验证主机 / 端口 / 用户名 / 口令 / 远端位置，只连不写</span>
        </div>
      </el-form-item>
    </FormGrid>
  </el-form>
</template>

<style scoped>
.hint-inline { display: inline; font-size: 12px; opacity: .6; }
.test-result { margin-left: 0; font-size: 12px; color: var(--el-color-success); }
.test-result.is-error { color: var(--el-color-danger); }
</style>
