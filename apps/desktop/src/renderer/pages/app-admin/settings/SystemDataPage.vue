<script setup lang="ts">
/**
 * 应用管理 > 应用设置 > 系统与数据（P4-3 页化 · 迁即重构，吸收原 SystemTab 454 行）：
 * 更新 / 数据目录与备份 / 配置预设 / 运行时工具包 / 回滚快照 / 诊断 六个分区卡。
 * 各分区独立子组件（parts/），自管加载与二次确认流（语义不变）；页面只取版本号下发给前两卡。
 */
import { onMounted, ref } from 'vue'
import UpdateSection from './parts/UpdateSection.vue'
import DataBackupSection from './parts/DataBackupSection.vue'
import PresetSection from './parts/PresetSection.vue'
import RuntimePackageSection from './parts/RuntimePackageSection.vue'
import SnapshotSection from './parts/SnapshotSection.vue'
import DiagnosisSection from './parts/DiagnosisSection.vue'

const version = ref('0.1.0')
onMounted(() => {
  void window.api.app.version().then((v) => { version.value = v }).catch(() => { /* 保持默认 */ })
})
</script>

<template>
  <div class="admin-subpage">
    <div class="tool-page-head">
      <strong>系统与数据</strong>
      <span class="muted" style="margin-left: 12px">版本更新、数据目录与备份、配置预设、运行时工具包、回滚快照、诊断</span>
    </div>
    <div class="admin-subpage-body">
      <UpdateSection :version="version" />
      <DataBackupSection :version="version" />
      <PresetSection />
      <RuntimePackageSection />
      <SnapshotSection />
      <DiagnosisSection />
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
/* 留白 token（规范 §2.1）：页面内边距 var(--sshk-page-padding)，卡片间距 var(--sshk-gap-md) */
.admin-subpage-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: var(--sshk-page-padding);
  display: flex;
  flex-direction: column;
  gap: var(--sshk-gap-md);
}
</style>
