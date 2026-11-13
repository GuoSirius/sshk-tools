import { defineAsyncComponent, h, type Component } from 'vue'
import { RENDERER_LOADERS } from './discovery'

/**
 * 渲染层插件加载：按构建期自动发现的入口逐个异步加载。
 * 每个工具有独立错误边界：组件缺失 / 抛错只显示占位页，不会白屏、不影响其它工具。
 */
const ToolLoadError = () => h('div', { class: 'tool-load-error' }, [
  h('strong', '工具插件加载失败'),
  h('p', '该工具页面未能加载，应用与其它工具不受影响。可在「设置 → 工具与权限」查看插件状态。'),
])

const cache = new Map<string, Component>()

/**
 * 仅服务「构建期内置」工具：RENDERER_LOADERS 由 import.meta.glob 在编译期扫描各工具包
 * src/renderer 目录下的 *Page.vue 组件。找不到对应 loader 时返回 null —— 让 App.vue 回落到
 * 运行时分支（tool.runtime）或通用空态，不再误返回「未登记的渲染插件」，否则运行时包
 * （dist/page.js）永远进不了 runtime 分支。
 */
export function toolComponent(id: string): Component | null {
  const cached = cache.get(id)
  if (cached) return cached
  const loader = RENDERER_LOADERS[id]
  if (!loader) return null
  const component = defineAsyncComponent({
    loader: async () => (await loader() as { default: Component }).default,
    errorComponent: ToolLoadError,
    onError: (err) => console.warn(`[sshk] 渲染插件 ${id} 加载失败：`, err),
  })
  cache.set(id, component)
  return component
}
