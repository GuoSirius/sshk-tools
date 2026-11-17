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
/* FormHint inline 自带 12px margin（非栅格场景用），栅格内由 column-gap 统一管间距，避免叠加成 20px */
.sshk-form-grid .sshk-form-hint.inline { margin-left: 0; }
/* 输入框 + 按钮组合：等高居中。
   combo 自身必须伸展填满 content 行（EP content 是 flex 容器，flex 子项默认按内容收缩，
   不补 flex:1 时内部输入框的 flex:1 只能填满一个收缩壳——按钮无法与上方输入框右缘对齐） */
.sshk-form-grid .combo { display: flex; align-items: center; gap: 8px; flex: 1 1 auto; min-width: 0; }
.sshk-form-grid .combo > .el-input,
.sshk-form-grid .combo > .el-select { flex: 1; min-width: 0; }
/* combo 内的数字框：上面的 width:100% 会成为它的 flex-basis（约等于整行宽），
   收缩全部落在 basis 最大的它身上，同排的 el-input（basis 0、min-width:0）
   被挤成 0 宽——只剩 wrapper 溢出的一条圆角残边，看起来就像数字框左边
   有一块补不齐的留白（用户 2026-11-17 截图，主机/端口组合）。
   combo 内退回固定宽度（与 small 档 150px 一致），剩余宽度让给输入框 */
.sshk-form-grid .combo > .el-input-number { width: 150px; flex: 0 1 auto; }
</style>
