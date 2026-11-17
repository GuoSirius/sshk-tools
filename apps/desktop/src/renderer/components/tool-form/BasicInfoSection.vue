<script setup lang="ts">
/**
 * 基本信息（plans/02 T1，两壳共用）：id / 名称 / 描述 / 分类 / 标签 / 可见性；
 * 编辑模式追加 入口菜单 / 图标 / 配置布局 / 启用。布局按 plans/01 全局栅格规范。
 * form 为父级 reactive 对象，就地修改（Vue 响应式直改，不用 emit 逐字段回传）。
 */
import { FormGrid, FormHint } from '@sshk/ui-kit'
import { VISIBILITIES } from './types'

const props = defineProps<{
  form: import('./types').BasicInfoForm
  mode: 'create' | 'edit'
  categories: string[]
  /** create 模式 id 行内错误提示（编辑壳 id 只读无此项） */
  idError?: string
}>()

/** 分类：历史建议下拉 + 自由手输；多分类顿号分隔，选中项替换最后一段并补顿号便于连续选择 */
function queryCategories(query: string, cb: (items: { value: string }[]) => void): void {
  const last = query.split('、').pop()?.trim().toLowerCase() ?? ''
  cb(props.categories.filter((c) => !last || c.toLowerCase().includes(last)).map((value) => ({ value })))
}
function onCategorySelect(value: string): void {
  const parts = props.form.category.split('、').map((s) => s.trim()).filter(Boolean)
  parts.push(value)
  props.form.category = [...new Set(parts)].join('、') + '、'
}
</script>

<template>
  <el-form size="small" label-position="top">
    <FormGrid>
      <el-form-item class="full" label="工具 id" :required="mode === 'create'">
        <el-input clearable
          v-model="form.id"
          :disabled="mode === 'edit'"
          :placeholder="mode === 'create' ? '如 my-tool；= 目录名，创建后不可改' : ''"
        />
        <FormHint v-if="mode === 'edit'">唯一真相源，必须与目录名一致，不可改</FormHint>
        <FormHint v-else-if="idError" class="id-error">{{ idError }}</FormHint>
      </el-form-item>
      <el-form-item label="名称" required><el-input clearable v-model="form.name" placeholder="桌面上显示的工具名" /></el-form-item>
      <el-form-item v-if="mode === 'edit'" label="入口菜单"><el-input clearable v-model="form.entryRoute" /></el-form-item>
      <el-form-item label="分类">
        <el-autocomplete
          v-model="form.category"
          :fetch-suggestions="queryCategories"
          @select="onCategorySelect"
          clearable
          placeholder="选历史分类或直接输入；多个用顿号分隔"
        />
      </el-form-item>
      <el-form-item label="标签">
        <el-input clearable v-model="form.tags" placeholder="逗号分隔；标签内可含空格" />
        <FormHint>标签内可含空格，如 OCR 识别</FormHint>
      </el-form-item>
      <el-form-item v-if="mode === 'edit'" label="图标">
        <el-input clearable v-model="form.icon" placeholder="auto = assets/icon.svg" />
      </el-form-item>
      <el-form-item v-if="mode === 'edit'" label="配置布局">
        <el-select v-model="form.configLayout">
          <el-option label="single（单页）" value="single" />
          <el-option label="tabs（分页）" value="tabs" />
          <el-option label="menu（子菜单）" value="menu" />
        </el-select>
      </el-form-item>
      <el-form-item v-if="mode === 'edit'" label="启用"><el-switch v-model="form.enabled" /></el-form-item>
      <el-form-item label="可见性">
        <el-select v-model="form.visibility">
          <el-option v-for="v in VISIBILITIES" :key="v.value" :label="v.label" :value="v.value" />
        </el-select>
      </el-form-item>
      <el-form-item class="full" label="描述">
        <el-input clearable v-model="form.description" type="textarea" :rows="2" />
      </el-form-item>
    </FormGrid>
  </el-form>
</template>

<style scoped>
.id-error { color: var(--el-color-danger); opacity: 1; }
</style>
