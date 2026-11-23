<script setup lang="ts">
import { computed, getCurrentInstance, shallowRef } from 'vue'
import { Editor, loader } from '@guolao/vue-monaco-editor'
import { monaco, setupMonaco, setYamlSchema } from '../monaco-setup'
import { monacoLanguageFor } from '../languages'
import { bindSaveShortcut, type SaveCommandEditor } from '../save-shortcut'

const props = withDefaults(
  defineProps<{
    modelValue: string
    /** 显式语言；省略时按 path 的扩展名自动判定 */
    language?: string
    /** 文件/虚拟路径：决定语言与唯一 model URI（多实例共存必须唯一，F6） */
    path?: string
    readonly?: boolean
    /** yaml 模式下的 JSON Schema（实时校验 meta.yaml / sample.yaml） */
    schema?: object | null
    height?: string
    dark?: boolean
    minimap?: boolean
  }>(),
  { language: '', path: '', readonly: false, schema: null, height: '320px', dark: true, minimap: false },
)

const emit = defineEmits<{
  (e: 'update:modelValue', v: string): void
  /** Ctrl/Cmd+S：宿主若有保存动作请接此事件；无监听时仅拦截浏览器默认保存框 */
  (e: 'save'): void
}>()

// F4：必须用本地 monaco 实例，避免 loader 默认从 CDN 拉取（断网不可达）
setupMonaco()
loader.config({ monaco })

// F6：每个组件实例生成唯一 model URI，避免隐藏 tab / 多实例共享 model 导致内容错乱或不可输入
const instanceId = getCurrentInstance()?.uid ?? 0
const monacoLang = computed(() => monacoLanguageFor({ language: props.language, path: props.path }))
const virtualPath = computed(() => `inmemory://model/${props.path || `editor-${instanceId}`}`)
const theme = computed(() => (props.dark ? 'vs-dark' : 'vs'))
const options = computed(() => ({
  readOnly: props.readonly,
  minimap: { enabled: props.minimap },
  automaticLayout: true,
  fontSize: 13,
  scrollBeyondLastLine: false,
  wordWrap: 'on' as const,
  tabSize: 2,
  // 代码折叠（2026-11-16 用户反馈）：chevron 悬停 gutter 才显示（IDE 常见行为，不常显抢视觉）
  folding: true,
  showFoldingControls: 'mouseover' as const,
  unfoldOnClickAfterEndOfLine: true,
  // 压缩后的 HTML 常是单行超长文本：Monaco 默认 stopRenderingLineAfter=10000 会暂停该行渲染，
  // 表现为「压缩 HTML 没有高亮 + 顶部提示 Rendering paused for long line」。设为 -1 关闭限制。
  stopRenderingLineAfter: -1,
  // 关键（用户复核）：即使渲染不暂停，Monaco 默认 maxTokenizationLineLength=20000 会跳过超长行的
  // 语法着色（tokenize），压缩 HTML 单行常几十万字符 → 整行纯白无高亮。
  // ⚠️ 此项不能设 -1：Monarch lexer 的判断是 `line.length >= maxTokenizationLineLength`，
  // -1 会让**所有行**（长度≥0 恒 > -1）都被 nullTokenize → 整个文件无高亮（2026-11-18 事故）。
  // -1 是「关闭限制」的语义仅对 stopRenderingLineAfter 成立；此处只能用大数值上限，
  // MAX_SAFE_INTEGER = 不限制（Monaco 源码只做比较不参与运算；压缩 HTML 内嵌 base64 时
  // 单行可超 200 万字符，固定数值上限会留隐性截断）。
  maxTokenizationLineLength: Number.MAX_SAFE_INTEGER,
  // 大文件优化默认会在超大内容上关闭 tokenization / 折叠等特性，压缩产物场景需关闭以保证高亮
  largeFileOptimizations: false,
}))

/** 编辑器实例暴露：供页面级搜索定位（setSelection / revealRangeInCenter）等高级用法 */
const editorInstance = shallowRef<unknown>(null)
function onMount(instance: unknown): void {
  editorInstance.value = instance
  // Ctrl/Cmd+S：统一在共享编辑器层注册，所有宿主自动获得；宿主通过 @save 接自己的保存函数
  bindSaveShortcut(instance as SaveCommandEditor | null, monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => emit('save'))
}
defineExpose({ getEditor: () => editorInstance.value })

function onBeforeMount(): void {
  if (props.schema) setYamlSchema(props.schema)
}
</script>

<template>
  <div class="code-editor" :style="{ height }">
    <Editor
      :value="modelValue"
      :language="monacoLang"
      :path="virtualPath"
      :theme="theme"
      :options="options"
      @mount="onMount"
      @update:value="(v: string | undefined) => emit('update:modelValue', v ?? '')"
      @before-mount="onBeforeMount"
    />
    <span v-if="schema" class="schema-badge">JSON Schema 实时校验</span>
  </div>
</template>

<style scoped>
.code-editor {
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
