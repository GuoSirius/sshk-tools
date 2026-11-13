/// <reference path="../types/vite-glob.d.ts" />
/**
 * 渲染层插件发现：与 main/discovery.ts 同一套约定，扫描各工具包自带的
 * 图标与页面组件。新增工具包放进 tools/ 后无需改宿主代码。
 */
// ?raw 取 SVG 源码：打包后无需处理 file:// 下的资源相对路径，
// ToolIcon 直接转成 data URI，开发态与安装包表现一致。
const iconModules = import.meta.glob('../../../../tools/*/assets/icon.svg', {
  eager: true,
  query: '?raw',
  import: 'default',
})
const rendererModules = import.meta.glob('../../../../tools/*/src/renderer/*Page.vue')

function toolIdOf(path: string): string {
  return path.replace(/\\/g, '/').match(/\/tools\/([^/]+)\//)?.[1] ?? ''
}

/** toolId -> 工具包自带图标 SVG 源码（无效 / 缺失时由 ToolIcon 回退系统默认） */
export const TOOL_ICONS: Record<string, string> = {}
for (const [file, url] of Object.entries(iconModules)) {
  const id = toolIdOf(file)
  if (id && typeof url === 'string') TOOL_ICONS[id] = url
}

/** toolId -> 工具页面异步加载器 */
export const RENDERER_LOADERS: Record<string, () => Promise<unknown>> = {}
for (const [file, loader] of Object.entries(rendererModules)) {
  const id = toolIdOf(file)
  if (id && !RENDERER_LOADERS[id]) RENDERER_LOADERS[id] = loader as () => Promise<unknown>
}
