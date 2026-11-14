/// <reference path="../types/vite-glob.d.ts" />
import { readFileSync } from 'node:fs'
import type { ToolDescriptor } from '@sshk/shared'

/**
 * 主进程构建期插件发现：扫描 tools/* 下每个工具包自带的清单与主进程入口。
 * 新增工具包只要放进 tools/ 并带 tool.manifest.json，宿主零改动即可构建使用。
 * 图标只由渲染层 renderer/discovery.ts 发现，主进程不关心资源。
 *
 * 约定（写进 docs）：
 * - 目录名 = manifest.id
 * - manifest 自带 menus / configGroups / defaults / plugin.channels
 * - 主进程入口固定 src/main/index.ts，**默认导出**注册函数
 * - 渲染入口固定 src/renderer/*Page.vue
 * - 图标固定 assets/icon.svg（manifest.icon = auto 时启用）
 */
const manifestModules = import.meta.glob('../../../../tools/*/tool.manifest.json', {
  eager: true,
  import: 'default',
})
const mainModules = import.meta.glob('../../../../tools/*/src/main/index.ts')

function toolIdOf(path: string): string {
  return path.replace(/\\/g, '/').match(/\/tools\/([^/]+)\//)?.[1] ?? ''
}

export const MANIFESTS: ToolDescriptor[] = Object.entries(manifestModules).flatMap(([file, raw]) => {
  const manifest = raw as ToolDescriptor | null
  const dirId = toolIdOf(file)
  if (!manifest?.id || manifest.id !== dirId) {
    console.warn(`[sshk] 跳过无效工具清单 ${file}（id 必须存在且与目录名一致）`)
    return []
  }
  return [manifest]
})

/** toolId -> 主进程插件动态加载器 */
export const MAIN_LOADERS: Record<string, () => Promise<unknown>> = {}
for (const [file, loader] of Object.entries(mainModules)) {
  const id = toolIdOf(file)
  if (id) MAIN_LOADERS[id] = loader as () => Promise<unknown>
}

/**
 * 运行时重载单个内建工具清单（开发者模式改 manifest 后原地覆盖内存快照，
 * 随后 buildCatalog 即可反映新可见性/菜单等，无需重启）。
 * 仅接受 tools/<id>/ 路径且 id 与目录名一致；成功返回 true。
 */
export function reloadManifestFile(file: string): boolean {
  try {
    const manifest = JSON.parse(readFileSync(file, 'utf8')) as ToolDescriptor
    const dirId = file.replace(/\\/g, '/').match(/\/tools\/([^/]+)\//)?.[1] ?? ''
    if (!manifest?.id || manifest.id !== dirId) return false
    const idx = MANIFESTS.findIndex((m) => m.id === manifest.id)
    if (idx >= 0) MANIFESTS[idx] = manifest
    else MANIFESTS.push(manifest)
    return true
  } catch {
    return false
  }
}
