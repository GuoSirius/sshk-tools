import { computed, ref } from 'vue'
import type { ToolCatalogPayload } from '@sshk/shared'

const EMPTY: ToolCatalogPayload = {
  tools: [],
  orphans: [],
  hasAccessKey: false,
  grants: [],
  includeTools: null,
}

// 单窗口单例：所有组件共享一份主进程裁决结果，配置变更后统一刷新
const payload = ref<ToolCatalogPayload>({ ...EMPTY })
const loading = ref(false)
let started = false

async function refresh(): Promise<void> {
  loading.value = true
  try {
    payload.value = await window.api.tools.list()
  } finally {
    loading.value = false
  }
}

/** IPC 变更类接口直接返回新 catalog，省一次往返 */
function accept(next: ToolCatalogPayload): void {
  payload.value = next
}

export function useToolCatalog() {
  if (!started) {
    started = true
    void refresh()
    window.api.config.onChanged(() => { void refresh() })
  }
  return {
    payload,
    loading,
    visibleTools: computed(() => payload.value.tools.filter((tool) => tool.visible)),
    byId: computed(() => new Map(payload.value.tools.map((tool) => [tool.id, tool]))),
    refresh,
    accept,
  }
}
