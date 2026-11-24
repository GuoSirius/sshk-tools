import { describe, expect, it } from 'vitest'
import { nextTick, ref } from 'vue'
import { useDetailTab } from './useDetailTab'
import type { NodeKind } from './useContentTree'

describe('useDetailTab：版本专属 tab 在离开版本节点后回落元数据', () => {
  it('初始停在元数据', () => {
    expect(useDetailTab(ref({ kind: 'version' })).value).toBe('meta')
  })

  it('停在版本专属 tab 时切到品牌/类目/族，回落元数据', async () => {
    for (const kind of ['brand', 'category', 'family'] as const) {
      const selected = ref<{ kind?: NodeKind } | null>({ kind: 'version' })
      const tab = useDetailTab(selected)
      tab.value = 'source'
      selected.value = { kind }
      await nextTick()
      expect(tab.value).toBe('meta')
    }
  })

  it('版本之间切换保持当前 tab', async () => {
    const selected = ref<{ kind?: NodeKind } | null>({ kind: 'version' })
    const tab = useDetailTab(selected)
    tab.value = 'style'
    selected.value = { kind: 'version' }
    await nextTick()
    expect(tab.value).toBe('style')
  })

  it('取消选中同样回落', async () => {
    const selected = ref<{ kind?: NodeKind } | null>({ kind: 'version' })
    const tab = useDetailTab(selected)
    tab.value = 'preview'
    selected.value = null
    await nextTick()
    expect(tab.value).toBe('meta')
  })
})
