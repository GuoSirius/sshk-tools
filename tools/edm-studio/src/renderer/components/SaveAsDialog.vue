<script setup lang="ts">
/**
 * 另存为弹框（P6-4 自 ContentManagePage 拆出）：一屏简化版——实体（品牌/族/版本）走名称/目录/目标根，
 * css（目录/文件）走目标 css 目录 + 新文件名；state 对象由 useSaveAs 域持有（含 visible 与确认逻辑）。
 */
import { computed } from 'vue'
import { FormHint } from '@sshk/ui-kit'
import { isEntityKind } from '../composables/save-as-routing'
import type { SaveAsState } from '../composables/useSaveAs'

const props = defineProps<{
  /** 另存为状态对象（useSaveAs 域持有；visible 控制显隐，confirm 确认逻辑在域内） */
  state: SaveAsState
  /** 另存为目标位置（按类型过滤：片段→片段类目/族，模板→模板类目/族；仅列目标根，避免跨根错位） */
  targetOptions: { path: string; label: string }[]
  /** 全部 css 目录（css 另存为目标下拉；携带 source 以便定位根） */
  cssDirs: { path: string; label: string; source: string }[]
}>()

const emit = defineEmits<{
  (e: 'confirm'): void
}>()

const isEntity = computed(() => isEntityKind(props.state.node?.kind ?? ''))
const isCssFile = computed(() => props.state.node?.kind === 'cssFile')
</script>

<template>
  <el-dialog :model-value="state.visible" title="另存为" width="480px" :close-on-click-modal="false" :close-on-press-escape="false" @update:model-value="(v: boolean) => (state.visible = v)">
    <el-form label-width="auto">
      <template v-if="isEntity">
        <el-form-item label="新名称"><el-input clearable v-model="state.name" placeholder="默认带 -copy 后缀" /></el-form-item>
        <el-form-item v-if="state.node?.kind !== 'version' && state.origin === 'system'" label="code（目录名）">
          <el-input clearable v-model="state.code" placeholder="留空则用新名称" />
        </el-form-item>
        <el-form-item v-if="state.node?.kind === 'family' || state.node?.kind === 'version'" label="目标位置">
          <el-select v-model="state.target" filterable style="width: 100%">
            <el-option v-for="t in targetOptions" :key="t.path" :value="t.path" :label="t.label" />
          </el-select>
        </el-form-item>
        <el-form-item label="保存目标">
          <el-radio-group v-model="state.origin">
            <el-radio value="system">系统自带（文件域）</el-radio>
            <el-radio value="custom">自定义（文件域）</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item v-if="state.origin === 'custom' && state.node?.data.source === 'system'" label="携带内容">
          <FormHint>派生为自定义副本：整棵内容（meta/源码/示例/css）写入自定义文件根，可在邮件编辑器直接使用</FormHint>
        </el-form-item>
        <el-form-item v-if="state.node?.kind === 'version'" label="携带内容">
          <FormHint>版本内全部文件 + 版本级 css 目录（品牌/族级 css 与元数据不跟）</FormHint>
        </el-form-item>
      </template>
      <template v-else>
        <el-form-item label="保存目标">
          <el-radio-group v-model="state.origin">
            <el-radio value="system">系统自带</el-radio>
            <el-radio value="custom">自定义</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="目标 css 目录">
          <el-select v-model="state.target" filterable style="width: 100%">
            <el-option v-for="d in cssDirs.filter((x) => x.source === state.origin)" :key="d.path" :value="d.path" :label="d.label" />
          </el-select>
        </el-form-item>
        <el-form-item v-if="isCssFile" label="新文件名"><el-input clearable v-model="state.name" /></el-form-item>
        <el-form-item v-else label="携带内容"><FormHint>目录下全部 css 文件（目录名恒为 css，文件名不变，冲突时询问）</FormHint></el-form-item>
      </template>
    </el-form>
    <template #footer>
      <el-button @click="state.visible = false">取消</el-button>
      <el-button type="primary" @click="emit('confirm')">确定</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
/* #2 表单 label 防换行：长 label（如「code（目录名）」）不再折行破坏行对齐 */
:deep(.el-form-item__label) { white-space: nowrap; }
</style>
