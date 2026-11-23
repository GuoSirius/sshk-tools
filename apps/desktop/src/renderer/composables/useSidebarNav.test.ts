import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ref, nextTick } from 'vue'
import type { ToolMenu } from '@sshk/shared'
// onBeforeUnmount 在无组件实例的单测环境仅产生 Vue warn（无害），保持 composable 纯净不做生产代码妥协
import { useSidebarNav } from './useSidebarNav'

/**
 * 侧栏收起/展开状态回归：收起态 hover 全展开是临时视觉态，离开/手动展开后
 * 必须还原「收起前」的分组开合（用户口径：收起前什么样，展开后还什么样）。
 */
const MENUS: ToolMenu[] = [
  { id: 'files', label: '文件', icon: 'folder' },
  { id: 'models', label: '模型', icon: 'cpu', children: [{ id: 'providers', label: '配置' }] },
  { id: 'share', label: '分享', icon: 'share', children: [{ id: 'mounts', label: '挂载' }] },
] as ToolMenu[]

function setup() {
  const collapsed = ref(false)
  const nav = useSidebarNav({ menus: () => MENUS, collapsed })
  return { collapsed, ...nav }
}

describe('useSidebarNav 收起/还原', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('window', { setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout })
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('收起前只展开 models → 收起 hover 全展开 → 离开还原为只 models', async () => {
    const { collapsed, openIds, onEnter, onLeave } = setup()
    openIds.value = new Set(['models']) // 收起前状态
    collapsed.value = true // 收起：快照 {models}
    await nextTick()

    onEnter() // hover 全展开
    expect(openIds.value.has('share')).toBe(true)
    onLeave()
    vi.advanceTimersByTime(200) // 越过 140ms 延时
    expect([...openIds.value]).toEqual(['models'])
  })

  it('手动展开（footer 钮）还原收起前状态，不残留 hover 的全展开', async () => {
    const { collapsed, openIds, onEnter } = setup()
    openIds.value = new Set(['models'])
    collapsed.value = true
    await nextTick()

    onEnter() // hover 全展开（含 share）
    expect(openIds.value.has('share')).toBe(true)
    collapsed.value = false // 手动展开
    await nextTick()
    expect([...openIds.value]).toEqual(['models'])
  })

  it('收起态多次 hover 不覆盖原始快照', async () => {
    const { collapsed, openIds, onEnter, onLeave } = setup()
    openIds.value = new Set(['share']) // 收起前只展开 share
    collapsed.value = true
    await nextTick()

    onEnter()
    openIds.value = new Set(['models']) // hover 期间手动改了开合（临时）
    onLeave()
    vi.advanceTimersByTime(200)
    expect([...openIds.value]).toEqual(['share']) // 还原最初的 share，而非 hover 期间改的 models

    onEnter() // 再次 hover 应基于已还原的 share 重新快照
    onLeave()
    vi.advanceTimersByTime(200)
    expect([...openIds.value]).toEqual(['share'])
  })
})
