/**
 * @sshk/form-schema/ui 组件子入口（plans/13 B0）：设计器与递归渲染器。
 * 仅渲染层可引；main/preload 禁止（rolldown 解析 .vue 会炸，见 @sshk/rich-text 根入口教训）。
 */
export { default as FieldSchemaDesigner } from './FieldSchemaDesigner.vue'
export { default as FieldPropsPanel } from './FieldPropsPanel.vue'
export { default as FormFieldRenderer } from './FormFieldRenderer.vue'
export { default as ImageField } from './ImageField.vue'
export { default as AiPolishDialog } from './AiPolishDialog.vue'
export { useAiChat, type AiChatChannels, type UseAiChatOptions } from './use-ai-chat'
export type { CompositeControlOption } from './types'
