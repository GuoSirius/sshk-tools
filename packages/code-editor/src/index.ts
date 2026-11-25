/**
 * @sshk/code-editor — 共享 Monaco 代码编辑器（R27，B2 已落地）。
 * 各工具 import { CodeEditor } 即可，零重复配置；已知坑 F3–F6 已在 monaco-setup.ts / CodeEditor.vue 固化。
 */
export { default as CodeEditor } from './components/CodeEditor.vue'
export { DEFAULT_LANGUAGE, LANGUAGES, languageForPath, monacoLanguageFor } from './languages'
export type { LanguageDef } from './languages'
export { monaco, setYamlSchema, setupMonaco } from './monaco-setup'
export { formatHtml, formatNjk, formatCss, compactHtml } from './format'
export { bindSaveShortcut, type SaveCommandEditor } from './save-shortcut'
