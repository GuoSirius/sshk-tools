<script setup lang="ts">
/**
 * 应用管理 > 应用设置 > 常规设置（P4-2 过渡版）：页头 + 直引 GeneralTab 原样渲染，Props 不变。
 * P4-3 迁即重构为规范页（FormGrid/FormHint/留白 token），本页仅保证可路由。
 */
import GeneralTab from '../../../components/settings/GeneralTab.vue'
</script>

<template>
  <div class="admin-subpage">
    <div class="tool-page-head">
      <strong>常规设置</strong>
      <span class="muted" style="margin-left: 12px">主题、产物目录、启动行为</span>
    </div>
    <div class="admin-subpage-body">
      <GeneralTab />
    </div>
  </div>
</template>

<style scoped>
.admin-subpage {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.admin-subpage-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: var(--sshk-page-padding);
  display: flex;
  flex-direction: column;
  gap: 14px;
}
</style>
