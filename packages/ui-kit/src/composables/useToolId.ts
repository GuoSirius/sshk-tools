import { computed, inject, provide, toValue, type ComputedRef, type MaybeRefOrGetter } from 'vue'

/**
 * 工具 ID 单一来源：宿主以 :tool-id="currentTool.id" 注入工具根组件，
 * 根组件 provide，深层组件 inject —— 工具源码里不再出现任何字面量 toolId。
 *
 * 之前每个工具各自硬编码（如 const TOOL_ID = 'edm-studio'），改清单 id 时极易漏改；
 * 这里一次实现，所有工具（含运行时导入包）共用。
 */
const TOOL_ID_KEY = Symbol('sshk:toolId')

/** 在工具根组件 setup 中调用；传 props.toolId 的 getter 即可保持响应 */
export function provideToolId(source: MaybeRefOrGetter<string>): void {
  provide(TOOL_ID_KEY, source)
}

/** 任意深层组件读取当前工具 id；未注入时返回空串（main 会退化为只用全局上传配置） */
export function useToolId(): ComputedRef<string> {
  const source = inject<MaybeRefOrGetter<string>>(TOOL_ID_KEY, '')
  return computed(() => String(toValue(source) ?? '').trim())
}
