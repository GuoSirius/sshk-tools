<script setup lang="ts">
/**
 * FormGrid 表单栅格（plans/01 F1，用户全局铁律）：
 * - 默认 2 列；cols=3 用于分组项少且都短的宽松场景；窄视口(<900px)自动降为单列
 * - 子项加 class="full" 独占整行（textarea / 代码编辑器 / 路径选择 / 大控件）
 * - 列内控件统一 width:100% 由栅格控宽，禁止手写散乱宽度
 * - 输入框+按钮组合：外层加 class="combo"（flex 等高居中，输入框弹性占满）
 * 样式非 scoped：需作用到插槽内容与 Element Plus 内部类，命名空间 .sshk-form-grid 防冲突
 */
withDefaults(defineProps<{ cols?: 2 | 3 }>(), { cols: 2 })
</script>

<template>
  <div class="sshk-form-grid" :class="{ 'cols-3': cols === 3 }">
    <slot />
  </div>
</template>

<style>
.sshk-form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0 16px;
}
.sshk-form-grid.cols-3 { grid-template-columns: repeat(3, minmax(0, 1fr)); }
@media (max-width: 900px) {
  .sshk-form-grid { grid-template-columns: 1fr; }
}
/* 独占整行 */
.sshk-form-grid > .full { grid-column: 1 / -1; }
/* 列内控件统一由栅格控宽 */
.sshk-form-grid .el-select,
.sshk-form-grid .el-input-number,
.sshk-form-grid .el-cascader,
.sshk-form-grid .el-date-editor {
  width: 100%;
}
.sshk-form-grid .el-form-item { margin-bottom: 14px; }
/* label 与控件顶部对齐 + 禁止换行：
   ① 行内 hint（如 ID 提示）撑高行时，防止 label 文字相对输入框垂直漂移；
   ② 100~120px 栏宽下「主机 / 端口」这类长 label 换行会拉乱行节奏 */
.sshk-form-grid .el-form-item { align-items: flex-start; }
.sshk-form-grid .el-form-item__label { white-space: nowrap; }
/* tip 对齐统一方案（用户 2026-11-16）：列间隙只在同一行内生效——
   同线元素（switch/按钮旁的提示）留 8px 边距；输入框 100% 宽导致提示
   换行到下方时落在行首、无间隙，与输入框精确左对齐。两种场景一次覆盖。
   因此提示 span 自身不要再写 margin-left。 */
.sshk-form-grid .el-form-item__content { column-gap: 8px; }
/* 输入框 + 按钮组合：等高居中 */
.sshk-form-grid .combo { display: flex; align-items: center; gap: 8px; }
.sshk-form-grid .combo > .el-input,
.sshk-form-grid .combo > .el-select { flex: 1; min-width: 0; }
</style>
