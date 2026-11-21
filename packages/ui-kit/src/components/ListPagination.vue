<script setup lang="ts">
/**
 * 分页规范内置（B39-C5 · P2-2）：layout 固定 total, sizes, prev, pager, next, jumper；
 * 中文 total 走全局 zh-cn locale（main.ts 已装配）；页码 CSS 由 theme.css .el-pagination 统一。
 * 页尺寸变化回第一页（防越界）由本组件负责。
 */
const page = defineModel<number>('page', { required: true })
const pageSize = defineModel<number>('pageSize', { required: true })

defineProps<{
  total: number
  /** 页尺寸候选（默认 10/20/50/100） */
  pageSizes?: number[]
}>()

function onSizeChange(size: number): void {
  pageSize.value = size
  page.value = 1
}
</script>

<template>
  <el-pagination
    v-model:current-page="page"
    :page-size="pageSize"
    :page-sizes="pageSizes ?? [10, 20, 50, 100]"
    :total="total"
    layout="total, sizes, prev, pager, next, jumper"
    background
    @size-change="onSizeChange"
  />
</template>
