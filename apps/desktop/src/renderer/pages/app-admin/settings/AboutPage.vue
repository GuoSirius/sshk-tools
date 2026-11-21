<script setup lang="ts">
/**
 * 应用管理 > 应用设置 > 关于应用（P4-2 过渡版）：页头 + 直引 AboutTab 原样渲染，Props 不变。
 * 运行环境数据源同时供顶栏「更多 > 关于应用」轻弹框（AboutDialog）复用。
 */
import AboutTab from '../../../components/settings/AboutTab.vue'
</script>

<template>
  <div class="admin-subpage">
    <div class="tool-page-head">
      <strong>关于应用</strong>
      <span class="muted" style="margin-left: 12px">运行环境、配置分层约定</span>
    </div>
    <div class="admin-subpage-body">
      <AboutTab />
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
