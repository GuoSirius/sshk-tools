<script setup lang="ts">
/**
 * css 多 tab 编辑容器（P6-4 自 ContentManagePage 拆出）：tab 条切换 + 工具栏 + 单实例 CodeEditor。
 * 隐藏 pane 内挂载 Monaco 会失效，故编辑器常驻、tab 只做切换（原注释迁移）。
 */
import { computed } from 'vue'
import { CodeEditor } from '@sshk/code-editor'
import { FormHint } from '@sshk/ui-kit'
import type { CssTab } from '../composables/useCssTabs'

const props = defineProps<{
  tabs: CssTab[]
  /** 当前激活 tab（v-model） */
  active: string
  canEdit: boolean
}>()

const emit = defineEmits<{
  (e: 'update:active', v: string): void
  (e: 'edit', file: string, v: string): void
  (e: 'save', tab: CssTab): void
  (e: 'save-all'): void
  (e: 'close', file: string): void
}>()

/** 当前激活 tab 对象（tab 条只做切换，编辑器单实例常驻） */
const activeTab = computed(() => props.tabs.find((t) => t.id === props.active) ?? null)

/** 路径末段（与 useContentTree.basename 同实现） */
function basename(p: string): string {
  return p.split(/[/\\]/).pop() ?? p
}
</script>

<template>
  <div class="css-editor">
    <el-tabs :model-value="active" type="card" closable @update:model-value="(v: string | number) => emit('update:active', String(v))" @tab-remove="emit('close', String($event))">
      <el-tab-pane v-for="t in tabs" :key="t.id" :name="t.id" :label="`${t.source === 'custom' ? '自定义·' : '系统·'}${basename(t.file)}${t.dirty ? ' ●' : ''}`" />
    </el-tabs>
    <template v-if="activeTab">
      <div class="editor-toolbar">
        <FormHint inline>外置 css：渲染时 &lt;link&gt; 引入（就近链，越深优先级越高）</FormHint>
        <el-button size="small" type="primary" class="push-right" @click="emit('save', activeTab)">保存</el-button>
        <el-button size="small" type="success" plain :disabled="!tabs.some((x) => x.dirty)" @click="emit('save-all')">保存全部</el-button>
      </div>
      <CodeEditor
        :model-value="activeTab.content"
        :path="activeTab.file"
        language="css"
        :readonly="!canEdit"
        height="calc(100% - 80px)"
        @update:model-value="(v: string) => emit('edit', activeTab!.id, v)"
      />
    </template>
  </div>
</template>

<style scoped>
.css-editor { flex: 1; min-height: 0; display: flex; flex-direction: column; }
.css-editor :deep(.el-tabs__content) { flex: 1; min-height: 0; }
.css-editor :deep(.el-tab-pane) { height: 100%; display: flex; flex-direction: column; }
.editor-toolbar { display: flex; align-items: center; gap: 10px; flex: none; padding-bottom: 6px; }
/* 保存/刷新预览类主按钮居右，描述与其他操作居左 */
.editor-toolbar .push-right { margin-left: auto; }
</style>
