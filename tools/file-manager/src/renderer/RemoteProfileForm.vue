<script setup lang="ts">
import { FormHint, FormGrid, SecretField, ConnectivityField, SIGN_URL_HINT } from '@sshk/ui-kit'
import type { UploadRemoteProfile } from '@sshk/shared'

/** 远程 profile 编辑表单：profile 是响应式数组内的对象，直接改属性即可回写父级。
 *  P4-4 迁即重构：密钥 combo/连通性区块替换为 ui-kit SecretField/ConnectivityField（P2-4 组件），
 *  签名 URL 说明改用 SIGN_URL_HINT 常量（CR-31）；表单行为/校验/密钥读写流不变。 */
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
        <SecretField
          :model-value="secretValue"
          :has-secret="hasSecret"
          :placeholder="hasSecret ? '点击查看可回显已存口令；留空保持不变' : '加密存储，可点眼睛查看 / 直接输入'"
          @update:model-value="(v: string) => emit('updateSecret', props.profile.id, v)"
          @reveal="emit('revealSecret', props.profile.id)"
          @clear="emit('clearSecret', props.profile.id)"
        />
      </el-form-item>
      <el-form-item label="访问域名"><el-input clearable v-model="profile.baseUrl" placeholder="https://cdn.example.com" /></el-form-item>
      <el-form-item label="被动模式">
        <el-switch v-model="profile.passive" />
        <span class="hint-inline">仅 FTP 生效</span>
      </el-form-item>
      <el-form-item label="签名URL模板">
        <el-input clearable v-model="profile.signUrlTemplate" placeholder="留空=裸链；如 https://cdn/sign?src={url}&token=..." />
        <FormHint inline :detail="SIGN_URL_HINT" />
      </el-form-item>
      <el-form-item label="连通性" class="full">
        <ConnectivityField
          :testing="testing"
          :result="testResult"
          hint="验证主机 / 端口 / 用户名 / 口令 / 远端位置，只连不写"
          @test="emit('test', props.profile.id)"
        />
      </el-form-item>
    </FormGrid>
  </el-form>
</template>

<style scoped>
.hint-inline { display: inline; font-size: 12px; opacity: .6; }
/* 主机/端口 combo 样式由 FormGrid 全局类（.sshk-form-grid .combo）提供，与原状一致 */
</style>
