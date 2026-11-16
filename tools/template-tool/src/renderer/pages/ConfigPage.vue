<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { toolId } from '../state'
import { host } from '../host'

/** 配置回显页：演示 configGroups 契约被宿主读取 */
const config = ref<Record<string, unknown> | null>(null)
async function loadConfig(): Promise<void> {
  config.value = (await host.config.get(`tools.${toolId.value}`)) as Record<string, unknown> | null
}
onMounted(() => { void loadConfig() })
</script>

<template>
  <div>
    <el-alert type="success" :closable="false" show-icon style="margin-bottom:12px">
      以下配置由本工具 manifest 的 <code>configGroups</code> 声明，宿主自动生成表单，开发者无需手填 JSON。
      本工具是<b>形态 2 示例</b>：<code>configLayout: menu</code> + <code>configPages</code> 把 4 个分组拆成
      「模型与调用」「路径与输出」两个二级页，每页含多个分组，页内仍用左右布局；其它工具用形态 1（单菜单 + 左右布局）。
    </el-alert>
    <el-button type="success" @click="loadConfig">读取本工具配置</el-button>
    <pre class="result">{{ config ? JSON.stringify(config, null, 2) : '读取中…' }}</pre>
  </div>
</template>

<style scoped>
.result { background: var(--el-fill-color-light); border-radius: 6px; padding: 8px; margin-top: 8px; max-height: 320px; overflow: auto; white-space: pre-wrap; font-size: 12px; }
</style>
