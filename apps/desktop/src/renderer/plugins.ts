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
const ToolMissing = () => h('div', { class: 'tool-load-error' }, [
  h('strong', '未登记的渲染插件'),
  h('p', '该工具没有找到约定的 src/renderer/*Page.vue，请检查工具包结构。'),
])

const cache = new Map<string, Component>()

export function toolComponent(id: string): Component {
  const cached = cache.get(id)
  if (cached) return cached
  const loader = RENDERER_LOADERS[id]
  const component = loader
    ? defineAsyncComponent({
      loader: async () => (await loader() as { default: Component }).default,
      errorComponent: ToolLoadError,
      onError: (err) => console.warn(`[sshk] 渲染插件 ${id} 加载失败：`, err),
    })
    : defineAsyncComponent({ loader: () => Promise.resolve(ToolMissing as Component) })
  cache.set(id, component)
  return component
}
