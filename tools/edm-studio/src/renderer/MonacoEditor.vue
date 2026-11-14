<script setup lang="ts">
import { computed } from 'vue'
import { Editor, loader } from '@guolao/vue-monaco-editor'
import { monaco, setupMonaco } from './monaco-setup'

const props = withDefaults(
  defineProps<{
    modelValue: string
    language?: 'njk' | 'html' | 'css' | 'yaml' | 'json'
    readOnly?: boolean
    /** yaml 模式下的 JSON Schema（实时校验 meta.yaml / sample.yaml） */
    schema?: object | null
    height?: string
  }>(),
  { language: 'yaml', readOnly: false, schema: null, height: '320px' },
)

const emit = defineEmits<{ (e: 'update:modelValue', v: string): void }>()

setupMonaco()
// 关键：@guolao 经 @monaco-editor/loader 默认从 CDN 拉 monaco；用本地 monaco 实例，避免断网/CDN 不可达
loader.config({ monaco })

// njk 无原生语言，复用 html 高亮（nunjucks 标签 {{ }}/{% %} 由上游 nunjucks 编译期检测兜底）
const monacoLang = computed(() => (props.language === 'njk' ? 'html' : props.language))
const virtualPath = computed(() => `inmemory://model/${props.language === 'yaml' ? 'meta.yaml' : `source.${props.language}`}`)

const options = computed(() => ({
  readOnly: props.readOnly,
  minimap: { enabled: false },
  automaticLayout: true,
  fontSize: 13,
  scrollBeyondLastLine: false,
  wordWrap: 'on' as const,
  tabSize: 2,
}))

function applySchema(): void {
  if (props.language !== 'yaml' || !props.schema) return
  const y = (monaco.languages as Record<string, any>).yaml
  if (!y?.yamlDefaults?.setDiagnosticsOptions) return
  y.yamlDefaults.setDiagnosticsOptions({
    validate: true,
    enableSchemaRequest: false,
    hover: true,
    completion: true,
    schemas: [{ uri: 'inmemory://schema/edm-meta.json', fileMatch: ['*'], schema: props.schema }],
  })
}

// beforeMount 时在 monaco 实例就绪后注入 schema（monaco-yaml 按 fileMatch 命中虚拟路径）
function onBeforeMount(): void {
  applySchema()
}
</script>

<template>
  <div class="monaco-wrap" :style="{ height }">
    <Editor
      :value="modelValue"
      :language="monacoLang"
      :path="virtualPath"
      theme="vs-dark"
      :options="options"
      @update:value="(v: string | undefined) => emit('update:modelValue', v ?? '')"
      @before-mount="onBeforeMount"
    />
    <span v-if="schema" class="schema-badge">JSON Schema 实时校验</span>
  </div>
</template>

<style scoped>
.monaco-wrap {
  position: relative;
  width: 100%;
  border: 1px solid rgba(128, 128, 128, 0.25);
  border-radius: 6px;
  overflow: hidden;
}
.schema-badge {
  position: absolute;
  top: 6px;
  right: 10px;
  font-size: 11px;
  opacity: 0.55;
  pointer-events: none;
  z-index: 2;
}
</style>
