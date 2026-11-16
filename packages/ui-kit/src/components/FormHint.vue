<script setup lang="ts">
/**
 * FormHint 表单说明文案（plans/01 F5/F10，用户硬规则）：
 * - 默认上下放置：独占一行、左对齐（el-form-item 内容区自动换行）
 * - inline：与控件同行左右放置，固定留 12px 间距
 * - detail：问号弹出完整说明（hint 本体一句话 ≤20 字，长解释一律进 tooltip）
 */
withDefaults(defineProps<{ inline?: boolean; detail?: string }>(), { inline: false, detail: '' })
</script>

<template>
  <div class="sshk-form-hint" :class="{ inline }">
    <span class="txt"><slot /></span>
    <el-tooltip v-if="detail" :content="detail" placement="top" :show-after="150">
      <span class="q">?</span>
    </el-tooltip>
  </div>
</template>

<style>
.sshk-form-hint {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 4px;
  text-align: left;
  font-size: 12px;
  opacity: 0.62;
  line-height: 1.5;
}
/* 左右放置：与控件同行，固定间距 12px（用户硬规则） */
.sshk-form-hint.inline { width: auto; display: inline-flex; margin-left: 12px; }
/* 问号触发器：CSS 圆圈问号（ui-kit 未声明 icons-vue 依赖，避免越权引包） */
.sshk-form-hint .q {
  flex: none;
  width: 14px;
  height: 14px;
  border: 1px solid currentColor;
  border-radius: 50%;
  font-size: 10px;
  line-height: 12px;
  text-align: center;
  cursor: help;
  opacity: 0.8;
}
</style>
