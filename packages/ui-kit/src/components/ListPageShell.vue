<script setup lang="ts">
/**
 * 列表页四段式外壳（B8/CR-30 · P2-1 建库）：筛选栏 → 操作栏 → 表格 → 分页。
 * 布局与间距 CSS 上收 theme.css（.lp-* 全局类），本组件只管结构——
 * 各列表页不再各自维护三段式 scoped CSS（CR-30：11+ 页逐字重复的根因）。
 * 空态：表格自身为空时由调用方渲染 <EmptyState>（保留三类空态文案自主权），
 * 或直接把 EmptyState 放 default slot 与 el-table v-if 互斥。
 * flush（P6-1）：页面嵌在已有留白容器（如 ToolPageLayout .tool-page-body）内时去根 padding，
 * 避免「宿主 20px + .lp-page 20px」双重留白。
 */
withDefaults(defineProps<{
  /** v-loading 绑定值（表格区） */
  loading?: boolean
  /** 嵌套在已带页面留白的容器内时置 true（根 .lp-page 去 padding） */
  flush?: boolean
}>(), { loading: false, flush: false })
</script>

<template>
  <div class="lp-page" :class="{ 'lp-page--flush': flush === true }">
    <!-- 筛选栏：label+控件包 .f-item 整体换行不错开；末尾统一 查询+重置 -->
    <div v-if="$slots.filter" class="lp-filter">
      <slot name="filter" />
    </div>
    <!-- 操作栏：单独一行居右、紧凑口径 -->
    <div v-if="$slots.ops" class="lp-ops">
      <slot name="ops" />
    </div>
    <!-- 表格：撑满剩余高度（EmptyState 与 el-table 由页面互斥渲染） -->
    <div class="lp-table" v-loading="loading === true">
      <slot />
    </div>
    <!-- 分页：total, sizes, prev, pager, next, jumper 固定布局 -->
    <div v-if="$slots.footer" class="lp-foot">
      <slot name="footer" />
    </div>
  </div>
</template>
