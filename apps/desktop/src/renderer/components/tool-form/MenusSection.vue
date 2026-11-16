<script setup lang="ts">
/** 菜单与页面（plans/02 T1，两壳共用）：菜单行编辑；create 模式附带派生页面文件名提示。
 *  校验错误按行内联显示在对应行下方（用户反馈 2026-11-16：不要进预览区/底部错误盒）。 */
import { Delete, Plus } from '@element-plus/icons-vue'
import type { MenuRow } from './types'

const props = defineProps<{
  menus: MenuRow[]
  /** 最少保留行数（创建壳首菜单必留） */
  minRows?: number
  /** create 模式：菜单 id → 派生页面文件名（如 pages/HomePage.vue） */
  fileFor?: (id: string) => string
  /** 行内校验：行号 → 错误文案（空串/undefined = 无错误） */
  rowError?: (index: number) => string
}>()

function remove(index: number): void {
  if ((props.minRows ?? 0) >= 1 && props.menus.length <= (props.minRows ?? 0)) return
  props.menus.splice(index, 1)
}

function errorOf(index: number): string {
  return props.rowError?.(index) ?? ''
}
</script>

<template>
  <div>
    <div v-for="(row, i) in menus" :key="i" class="menu-item">
      <div class="menu-row">
        <el-input v-model="row.id" size="small" placeholder="菜单 id（home）" style="width: 170px" />
        <el-input v-model="row.label" size="small" placeholder="显示名称（首页）" style="width: 190px" />
        <code v-if="fileFor" class="file-chip">{{ fileFor(row.id) }}</code>
        <el-button size="small" type="danger" plain :icon="Delete" :disabled="minRows ? menus.length <= minRows : false" @click="remove(i)" />
      </div>
      <div v-if="errorOf(i)" class="row-error">{{ errorOf(i) }}</div>
    </div>
    <el-button size="small" type="primary" plain :icon="Plus" @click="menus.push({ id: '', label: '' })">新增菜单</el-button>
    <slot name="hint" />
  </div>
</template>

<style scoped>
.menu-item { margin-bottom: 8px; }
.menu-row { display: flex; align-items: center; gap: 8px; }
.file-chip { font-size: 11px; opacity: .65; white-space: nowrap; }
.row-error { color: var(--el-color-danger); font-size: 11px; line-height: 1.5; margin-top: 2px; padding-left: 2px; }
</style>
