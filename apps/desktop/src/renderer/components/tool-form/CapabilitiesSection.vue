<script setup lang="ts">
/**
 * 能力与权限（plans/02 T1，两壳共用）：7 项宿主能力复选 + 宿主通道白名单 + 访问门槛。
 * 数组字段就地变更；requiredGrant 经 defineModel 回传。
 */
import { FormHint } from '@sshk/ui-kit'
import { ACCESS_GRANT, IPC_CHANNELS } from '@sshk/shared'
import { CAPABILITIES_LIST } from './types'

const capabilities = defineModel<string[]>('capabilities', { required: true })
const allowlist = defineModel<string[]>('allowlist', { required: true })
const grant = defineModel<string>('grant', { required: true })

/** 宿主通道可选集 = IPC_CHANNELS 全表 */
const hostChannels: string[] = Object.values(IPC_CHANNELS)
</script>

<template>
  <el-form size="small" label-position="top">
    <el-form-item label="宿主能力">
      <el-checkbox-group v-model="capabilities">
        <el-checkbox v-for="c in CAPABILITIES_LIST" :key="c" :value="c" :label="c" />
      </el-checkbox-group>
      <FormHint detail="按需勾选，权限最小化；全选 = 最高权限形态（外部包分发需有效签名）">按需勾选；权限最小化</FormHint>
    </el-form-item>
    <el-form-item label="宿主通道白名单">
      <el-select v-model="allowlist" multiple filterable collapse-tags clearable style="width: 100%">
        <el-option v-for="c in hostChannels" :key="c" :label="c" :value="c" />
      </el-select>
      <FormHint>可选集 = IPC_CHANNELS 全表；工具自有通道在 plugin.channels 另行声明</FormHint>
    </el-form-item>
    <el-form-item label="访问门槛">
      <el-select v-model="grant" style="width: 100%">
        <el-option label="公开（默认）" value="" />
        <el-option label="需访问密钥" :value="ACCESS_GRANT" />
      </el-select>
    </el-form-item>
  </el-form>
</template>
