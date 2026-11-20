<script setup lang="ts">
/**
 * 内容编辑整页壳（plans/11 #8 / S4）：editorMode='page' 时使用，与 dialog 壳共用 ContentEditorCore。
 * dev 铁律：两种模式全量可切；配置只决定打包版默认。切换只换容器，编辑器实现唯一。
 */
import { ref } from 'vue'
import { ArrowLeft } from '@element-plus/icons-vue'
import type { ContentRecord, ContentSaveInput } from '@sshk/shared'
import ContentEditorCore from './ContentEditorCore.vue'

const props = defineProps<{ record: ContentRecord | null; copySource?: ContentRecord | null }>()
const emit = defineEmits<{ save: [input: ContentSaveInput]; cancel: [] }>()

const coreRef = ref<InstanceType<typeof ContentEditorCore> | null>(null)
const title = props.copySource ? `复制内容：${props.copySource.name}` : props.record ? `编辑内容：${props.record.name}` : '新建内容'
</script>

<template>
  <div class="content-editor-page">
    <div class="cep-head">
      <el-button size="small" text :icon="ArrowLeft" @click="emit('cancel')">返回列表</el-button>
      <span class="cep-title">{{ title }}</span>
    </div>
    <div class="cep-body">
      <ContentEditorCore ref="coreRef" :record="record" :copy-source="copySource" @save="emit('save', $event)" />
    </div>
    <div class="cep-foot">
      <el-button size="small" @click="emit('cancel')">取消</el-button>
      <el-button size="small" type="primary" :disabled="!coreRef?.canSave" @click="coreRef?.submit()">保存</el-button>
    </div>
  </div>
</template>

<style scoped>
.content-editor-page { height: 100%; display: flex; flex-direction: column; min-height: 0; }
.cep-head { flex: none; display: flex; align-items: center; gap: 8px; padding-bottom: 8px; border-bottom: 1px solid var(--el-border-color); }
.cep-title { font-weight: 600; }
.cep-body { flex: 1; min-height: 0; padding-top: 10px; padding-bottom: 3px; }
.cep-foot { flex: none; display: flex; justify-content: flex-end; gap: 8px; padding-top: 10px; border-top: 1px solid var(--el-border-color); }
</style>
