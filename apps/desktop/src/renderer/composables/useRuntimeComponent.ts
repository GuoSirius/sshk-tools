import { computed, markRaw, reactive, watch, type ComputedRef } from 'vue'
import type { Component } from 'vue'
import { ElMessage } from 'element-plus'
import type { ToolRuntimeState } from '@sshk/shared'
import { toolComponent } from '../plugins'

/**
 * 运行时工具组件加载（CR-42 首刀 · P4-1 从 App.vue 抽出）：
 * - 内置工具走构建期组件（toolComponent）；运行时包走 Blob URL 动态 import（编译后 ESM 组件）；
 * - 按 id 记录加载中 / 失败：失败不再自动重试，避免反复弹错刷屏（F5 可整体重试）；
 * - 加载触发独立于 toolView：computed 只做纯渲染推导，副作用放 watch（进工具时拉起一次）。
 *   仅「无构建期内置渲染层」的运行时包才走安装副本加载：manifest 带 package 契约的内建工具
 *   同样会 runtime=true，但内置组件优先，绝不能去请求 runtime:readRenderer（未装外部副本必报错）。
 */
export function useRuntimeComponent(currentTool: ComputedRef<ToolRuntimeState | null>): {
  runtimeLoading: Set<string>
  runtimeFailed: Set<string>
  toolView: ComputedRef<Component | null>
} {
  const runtimeComponents = reactive(new Map<string, Component>())
  const runtimeLoading = reactive(new Set<string>())
  const runtimeFailed = reactive(new Set<string>())

  async function loadRuntimeComponent(id: string): Promise<void> {
    if (runtimeComponents.has(id) || runtimeLoading.has(id) || runtimeFailed.has(id)) return
    runtimeLoading.add(id)
    try {
      const code = await window.api.runtime.readRenderer(id)
      const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }))
      const mod = (await import(/* @vite-ignore */ url)) as { default?: Component }
      URL.revokeObjectURL(url)
      if (!mod.default) throw new Error('渲染层未默认导出组件')
      runtimeComponents.set(id, markRaw(mod.default))
    } catch (err) {
      runtimeFailed.add(id)
      ElMessage.error('运行时组件加载失败：' + (err as Error).message)
    } finally {
      runtimeLoading.delete(id)
    }
  }

  watch(() => {
    const tool = currentTool.value
    return tool?.runtime && !toolComponent(tool.id) ? tool.id : null
  }, (id) => {
    if (id) void loadRuntimeComponent(id)
  }, { immediate: true })

  const toolView = computed<Component | null>(() => {
    const tool = currentTool.value
    if (!tool) return null
    const builtin = toolComponent(tool.id)
    if (builtin) return builtin
    // 运行时包：声明了渲染层且带 package 契约
    if (tool.runtime) return runtimeComponents.get(tool.id) ?? null
    return null
  })

  return { runtimeLoading, runtimeFailed, toolView }
}
