import { ref, watch, type Ref } from 'vue'
import type { NodeKind } from './useContentTree'

/**
 * 详情 tab 选中态（2026-11-24）：示例/预览/源码/样式是版本专属 pane（v-if）。
 * el-tabs 只在 modelValue 变化时更新 currentName，活动 pane 被 v-if 移除后不会自行回落——
 * 版本节点停在「源码」再切品牌/类目/族，currentName 悬空，仅剩的元数据 pane 也不显示（内容区整块塌陷）。
 * 故选中态由本域显式持有：离开版本节点一律回落元数据（meta）；版本之间切换保持当前 tab。
 * 页面须把它 v-model 到 el-tabs，且各 el-tab-pane 显式写 name。
 */
export function useDetailTab(selected: Ref<{ kind?: NodeKind } | null>): Ref<string> {
  const tab = ref('meta')
  watch(
    () => selected.value?.kind,
    (kind) => {
      if (kind !== 'version') tab.value = 'meta'
    },
  )
  return tab
}
