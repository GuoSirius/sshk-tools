<script setup lang="ts">
/**
 * 配置分组（plans/02 T1，两壳共用）：分组/字段行编辑；
 * create 壳附带形态 radio（single|menu）与形态 2 配置页编辑；编辑壳只传 groups。
 * groups / pages 为父级数组，就地 push/splice 修改。
 */
import { computed } from 'vue'
import { Delete, Plus } from '@element-plus/icons-vue'
import { FIELD_TYPES, emptyField } from './types'
import type { GroupRow, PageRow } from './types'

const props = defineProps<{
  groups: GroupRow[]
  /** 提供则渲染形态 2（二级菜单分页）的配置页编辑 */
  pages?: PageRow[]
  /** 显示形态 radio（create 壳）；编辑壳的布局在基本信息页维护 */
  showLayoutRadio?: boolean
}>()

const layout = defineModel<string>('layout')
const showPages = computed(() => Boolean(props.pages) && layout.value === 'menu')
const groupOptions = computed(() =>
  props.groups.map((group) => ({ label: `${group.label}（${group.id}）`, value: group.id })))

function addGroup(): void { props.groups.push({ id: `config-${props.groups.length + 1}`, label: '', fields: [emptyField()] }) }
function addField(group: GroupRow): void { group.fields.push(emptyField()) }
function addPage(): void { props.pages?.push({ id: `config-page-${props.pages.length + 1}`, label: '', groups: [] }) }
</script>

<template>
  <div class="config-groups">
    <el-form v-if="showLayoutRadio" size="small" label-position="top" class="layout-form">
      <el-form-item label="配置形态">
        <el-radio-group v-model="layout">
          <el-radio value="single">形态 1：单菜单 + 左右布局</el-radio>
          <el-radio value="menu">形态 2：二级菜单分页</el-radio>
        </el-radio-group>
      </el-form-item>
    </el-form>

    <div v-for="(group, gi) in groups" :key="gi" class="group-card">
      <div class="row-item">
        <el-input v-model="group.id" size="small" placeholder="分组 id" style="width: 160px" />
        <el-input v-model="group.label" size="small" placeholder="分组名称" style="width: 170px" />
        <el-button size="small" type="danger" plain :icon="Delete" @click="groups.splice(gi, 1)">删除分组</el-button>
      </div>
      <div v-for="(field, fi) in group.fields" :key="fi" class="row-item field-row">
        <el-input v-model="field.key" size="small" placeholder="key（a.b.c）" style="width: 150px" />
        <el-input v-model="field.label" size="small" placeholder="名称" style="width: 120px" />
        <el-select v-model="field.type" size="small" style="width: 130px">
          <el-option v-for="t in FIELD_TYPES" :key="t.value" :label="t.label" :value="t.value" />
        </el-select>
        <el-input v-if="field.type === 'select'" v-model="field.optionsText" size="small" placeholder="选项 标签:值, 标签:值" style="width: 170px" />
        <el-input v-else-if="field.type === 'number'" v-model.number="field.min" size="small" placeholder="最小值" style="width: 110px" />
        <el-input v-model="field.hint" size="small" placeholder="提示语" style="flex: 1; min-width: 120px" />
        <el-button size="small" type="danger" plain :icon="Delete" @click="group.fields.splice(fi, 1)" />
      </div>
      <el-button size="small" plain :icon="Plus" @click="addField(group)">加字段</el-button>
    </div>
    <el-button size="small" type="primary" plain :icon="Plus" @click="addGroup">新增配置分组</el-button>

    <template v-if="showPages && pages">
      <div class="pages-hint">形态 2：配置页（二级菜单），每页引用多个分组；id 以 config- 开头。</div>
      <div v-for="(page, pi) in pages" :key="pi" class="row-item">
        <el-input v-model="page.id" size="small" placeholder="config-model" style="width: 160px" />
        <el-input v-model="page.label" size="small" placeholder="页名称" style="width: 140px" />
        <el-select v-model="page.groups" multiple collapse-tags size="small" placeholder="引用分组" style="flex: 1">
          <el-option v-for="g in groupOptions" :key="g.value" :label="g.label" :value="g.value" />
        </el-select>
        <el-button size="small" type="danger" plain :icon="Delete" @click="pages.splice(pi, 1)" />
      </div>
      <el-button size="small" type="primary" plain :icon="Plus" @click="addPage">新增配置页</el-button>
    </template>
  </div>
</template>

<style scoped>
.row-item { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; flex-wrap: wrap; }
.field-row { margin-left: 14px; }
.group-card { border: 1px dashed var(--el-border-color); border-radius: 8px; padding: 10px; margin-bottom: 10px; }
.layout-form { margin-bottom: 12px; }
.pages-hint { font-size: 12px; opacity: .6; line-height: 1.7; margin: 10px 0 6px; }
</style>
