<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { toolId } from '../state'

/** 配置回显页：演示 configGroups 契约被宿主读取 */
const config = ref<Record<string, unknown> | null>(null)
async function loadConfig(): Promise<void> {
  config.value = (await window.api.config.get(`tools.${toolId.value}`)) as Record<string, unknown> | null
}
onMounted(() => { void loadConfig() })
</script>

<template>
  <div>
    <el-alert type="success" :closable="false" show-icon style="margin-bottom:12px">
      以下配置由本工具 manifest 的 <code>configGroups</code> 声明，宿主在「工具与权限」中自动生成表单。
      开发者无需手填 JSON；发布态下用户编辑会持久化并在重导入时保留。
    </el-alert>
    <el-button type="success" @click="loadConfig">读取本工具配置</el-button>
    <pre class="result">{{ config ? JSON.stringify(config, null, 2) : '读取中…' }}</pre>
  </div>
</template>

<style scoped>
.result { background: var(--el-fill-color-light); border-radius: 6px; padding: 8px; margin-top: 8px; max-height: 320px; overflow: auto; white-space: pre-wrap; font-size: 12px; }
</style>
