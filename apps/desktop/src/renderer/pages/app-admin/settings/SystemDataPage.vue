<script setup lang="ts">
/**
 * 应用管理 > 应用设置 > 系统与数据（P4-2 过渡版）：页头 + 直引 SystemTab 原样渲染，Props 不变。
 * P4-3 迁即重构为规范页，本页仅保证可路由。
 */
import SystemTab from '../../../components/settings/SystemTab.vue'
</script>

<template>
  <div class="admin-subpage">
    <div class="tool-page-head">
      <strong>系统与数据</strong>
      <span class="muted" style="margin-left: 12px">版本、数据目录、密钥与备份策略</span>
    </div>
    <div class="admin-subpage-body">
      <SystemTab />
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
