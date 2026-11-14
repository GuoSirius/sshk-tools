/**
 * Monaco 环境初始化（R4/R9，D49 优先第三方包）。
 * - worker 用 Vite `?worker` 注入（editor/json/css/html）；yaml 诊断由 monaco-yaml 在主线程提供。
 * - monaco-yaml 同时兼容 v5（setupMonacoYaml）与 v4（yamlDefaults），避免版本漂移导致静默失效。
 * 渲染层只需 import 本模块并调用 setupMonaco()；组件用 @guolao/vue-monaco-editor 承载。
 */
import * as monaco from 'monaco-editor'
// @ts-ignore - Vite 注入 worker
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
// @ts-ignore
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker'
// @ts-ignore
import cssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker'
// @ts-ignore
import htmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker'
import * as monacoYaml from 'monaco-yaml'

let initialized = false

export function setupMonaco(): typeof monaco {
  if (initialized) return monaco
  initialized = true

  // @ts-ignore - 全局 worker 入口
  self.MonacoEnvironment = {
    getWorker(_: unknown, label: string) {
      if (label === 'json') return new jsonWorker()
      if (label === 'css' || label === 'scss' || label === 'less') return new cssWorker()
      if (label === 'html' || label === 'handlebars' || label === 'razor') return new htmlWorker()
      return new editorWorker()
    },
  }

  const y = monacoYaml as any
  if (typeof y.setupMonacoYaml === 'function') {
    y.setupMonacoYaml({ languages: { yaml: { enableSchemaRequest: false, hover: true, completion: true, validate: true } } })
  } else if ((monaco.languages as any).yaml?.yamlDefaults) {
    ;(monaco.languages as any).yaml.yamlDefaults.setDiagnosticsOptions({
      validate: true,
      enableSchemaRequest: false,
      hover: true,
      completion: true,
    })
  }
  return monaco
}

export { monaco }
