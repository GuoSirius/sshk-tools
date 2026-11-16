/**
 * Monaco 环境初始化（从 edm-studio 原样迁入，R27 B2）。迁移时已解决的坑：
 * F3 monaco-editor@0.57 的 exports 把 `./*` 映射到 `./esm/vs/*`，worker 导入必须去掉 `esm/vs/` 前缀，
 *    否则 rolldown 构建期路径翻倍无法解析。
 * F4 @guolao 默认经 @monaco-editor/loader 从 CDN 拉 monaco，必须 loader.config({ monaco }) 指向本地实例。
 * F5 monaco-yaml 存在 v5 setupMonacoYaml / v4 yamlDefaults 两套 API，双分支兼容避免版本漂移静默失效。
 */
import * as monaco from 'monaco-editor'
// @ts-ignore - Vite 注入 worker
import editorWorker from 'monaco-editor/editor/editor.worker.js?worker'
// @ts-ignore - Vite 注入 worker
import jsonWorker from 'monaco-editor/language/json/json.worker.js?worker'
// @ts-ignore - Vite 注入 worker
import cssWorker from 'monaco-editor/language/css/css.worker.js?worker'
// @ts-ignore - Vite 注入 worker
import htmlWorker from 'monaco-editor/language/html/html.worker.js?worker'
import * as monacoYaml from 'monaco-yaml'

interface YamlLangExt {
  yamlDefaults?: { setDiagnosticsOptions?: (options: Record<string, unknown>) => void }
}

let initialized = false

function yamlExt(): YamlLangExt | undefined {
  return (monaco.languages as unknown as Record<string, YamlLangExt>).yaml
}

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

  const y = monacoYaml as unknown as { setupMonacoYaml?: (options: Record<string, unknown>) => void }
  if (typeof y.setupMonacoYaml === 'function') {
    y.setupMonacoYaml({ languages: { yaml: { enableSchemaRequest: false, hover: true, completion: true, validate: true } } })
  } else {
    yamlExt()?.yamlDefaults?.setDiagnosticsOptions?.({
      validate: true,
      enableSchemaRequest: false,
      hover: true,
      completion: true,
    })
  }
  registerDelimitedLanguages()
  return monaco
}

/** csv / tsv：Monaco 无内置，注册轻量 Monarch（字符串 / 分隔符 / 数字 / URL 四类 token） */
function registerDelimitedLanguages(): void {
  const delimited = (id: string, separator: RegExp): void => {
    if (monaco.languages.getLanguages().some((l) => l.id === id)) return
    monaco.languages.register({ id })
    monaco.languages.setMonarchTokensProvider(id, {
      tokenizer: {
        root: [
          [/"([^"]|"")*"/, 'string'],
          [separator, 'delimiter'],
          [/-?\d+(?:\.\d+)?/, 'number'],
          [/https?:\/\/[^\s,"]+/, 'type.identifier'],
        ],
      },
    })
  }
  delimited('csv', /,|;/)
  delimited('tsv', /\t/)
}

/** yaml 模式注入 JSON Schema（实时校验 meta.yaml / sample.yaml） */
export function setYamlSchema(schema: object | null, fileMatch = '*'): void {
  yamlExt()?.yamlDefaults?.setDiagnosticsOptions?.({
    validate: true,
    enableSchemaRequest: false,
    hover: true,
    completion: true,
    schemas: schema
      ? [{ uri: 'inmemory://schema/sshk-meta.json', fileMatch: [fileMatch], schema }]
      : [],
  })
}

export { monaco }
