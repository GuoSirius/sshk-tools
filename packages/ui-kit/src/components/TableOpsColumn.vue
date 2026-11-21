<script setup lang="ts">
import { MoreFilled } from '@element-plus/icons-vue'
import type { OpsAction } from '../table-ops'

/**
 * 操作列统一组件（B8/C7 · P2-1 建库）：≤3 个内联按钮，其余收进「更多▾」下拉。
 * 用法：放在 el-table 内——<TableOpsColumn :actions="inline" :more="overflow" @action="onAction" />
 * 事件：(key, row)；row 由 el-table-column 的 scoped slot 透出。
 */
const props = withDefaults(defineProps<{
  /** 内联按钮（≤3；超出自动进更多▾） */
  actions: OpsAction[]
  /** 额外动作：始终进「更多▾」（语义化次要项，如危险操作） */
  more?: OpsAction[]
  /** 内联按钮上限（默认 3，列表页规范） */
  max?: number
  /** 列宽（默认按内容自适应） */
  width?: number | string
  /** fixed 列（长表格操作列通常 fixed='right'） */
  fixed?: 'left' | 'right' | boolean
}>(), { max: 3, more: () => [], width: undefined, fixed: undefined })

const emit = defineEmits<{
  (e: 'action', key: string, row: Record<string, unknown>): void
}>()

function onCommand(cmd: string | number | object, row: Record<string, unknown>): void {
  if (typeof cmd === 'string') emit('action', cmd, row)
}
</script>

<template>
  <el-table-column label="操作" :width="width" :fixed="fixed" align="center">
    <template #default="{ row }">
      <div class="op-row">
        <el-button
          v-for="a in actions.slice(0, max)"
          :key="a.key" size="small" :type="a.type ?? 'primary'" text
          :icon="a.icon" :disabled="a.disabled === true"
          @click="emit('action', a.key, row as Record<string, unknown>)"
        >{{ a.label }}</el-button>
        <el-dropdown
          v-if="actions.length > max || more.length > 0"
          trigger="click" @command="(cmd: string | number | object) => onCommand(cmd, row as Record<string, unknown>)"
        >
          <el-button size="small" type="info" text :icon="MoreFilled" title="更多操作" />
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item
                v-for="a in [...actions.slice(max), ...more]"
                :key="a.key" :command="a.key" :disabled="a.disabled === true"
                :icon="a.icon"
              >{{ a.label }}</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
      </div>
    </template>
  </el-table-column>
</template>
