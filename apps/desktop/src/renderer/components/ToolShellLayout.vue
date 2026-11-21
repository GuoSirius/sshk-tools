<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch, type Ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { DArrowLeft } from '@element-plus/icons-vue'
import type { ToolMenu, ToolRuntimeState } from '@sshk/shared'
import SidebarMenu from './SidebarMenu.vue'
import ToolIcon from './ToolIcon.vue'

/**
 * 工具侧栏壳（P6-8 CR-42 终拆自 App.vue）：左侧功能菜单栏——头部（图标+分类跑马灯）
 * + 多级菜单（SidebarMenu）+ 收起/展开。收起态 hover 就地平滑展开（不弹独立浮层）；
 * 进入时全部分组预展开（与原 openTool 行为一致）；菜单选择走路由（/tool/:toolId/:menu）。
 * 收起态（collapsed）由壳层 v-model 持有——跨工具切换保持收起/展开偏好（与原壳级 ref 语义一致）。
 */
const props = defineProps<{
  /** 当前工具（路由裁决；非空才渲染侧栏——v-if 在壳层） */
  tool: ToolRuntimeState
  /** 菜单树（configLayout=menu 时 config 菜单已挂二级，由壳层构造） */
  menus: ToolMenu[]
  /** 激活菜单 id */
  active: string
  /** 收起态（壳层持有，v-model:collapsed） */
  collapsed: boolean
}>()

const emit = defineEmits<{
  (e: 'update:collapsed', v: boolean): void
  (e: 'select', id: string): void
}>()

const route = useRoute()
const router = useRouter()
const activeToolId = computed(() => (route.params.toolId as string | undefined) ?? null)

/** 收起态 hover：侧栏本体平滑展开，不再弹独立浮层 */
const sidebarHover = ref(false)
const sideOpenIds = ref<Set<string>>(new Set())
const sidebarExpanded = computed(() => !props.collapsed || sidebarHover.value)
let hoverTimer: number | undefined

/** 找出 active 所在的分组链，保证激活项在任何层级都可见 */
function pathTo(items: ToolMenu[], active: string, parents: string[] = []): string[] | null {
  for (const item of items) {
    if (item.id === active) return parents
    if (item.children?.length) {
      const found = pathTo(item.children, active, [...parents, item.id])
      if (found) return found
    }
  }
  return null
}
function collectGroupIds(items: ToolMenu[]): string[] {
  const ids: string[] = []
  for (const item of items) {
    if (item.children?.length) ids.push(item.id, ...collectGroupIds(item.children))
  }
  return ids
}
function toggleIn(target: Ref<Set<string>>, id: string): void {
  const next = new Set(target.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  target.value = next
}

// 侧栏分类行自动循环滚动（内容超宽才启动；hover 暂停）
const sidebarMarqueeRef = ref<HTMLElement | null>(null)
const sidebarMarqueeRun = ref(false)
function measureMarquee(): void {
  void nextTick(() => {
    const el = sidebarMarqueeRef.value
    if (!el) { sidebarMarqueeRun.value = false; return }
    sidebarMarqueeRun.value = el.scrollWidth > el.clientWidth + 2
  })
}
watch([(): ToolRuntimeState => props.tool, (): boolean => props.collapsed], () => measureMarquee(), { immediate: true })
onMounted(() => { void nextTick(measureMarquee) })

// ── 侧栏交互：同一棵菜单树，收起后 hover 让侧栏本体平滑变宽 ──
function onSidebarEnter(): void {
  if (!props.collapsed) return
  if (hoverTimer !== undefined) { window.clearTimeout(hoverTimer); hoverTimer = undefined }
  // hover 时把分组全部展开，多级菜单一眼可见；移开后自动收成图标轨
  sideOpenIds.value = new Set(collectGroupIds(props.menus))
  sidebarHover.value = true
}
function onSidebarLeave(): void {
  if (hoverTimer !== undefined) window.clearTimeout(hoverTimer)
  hoverTimer = window.setTimeout(() => { sidebarHover.value = false }, 140)
}
function toggleSideGroup(id: string): void { toggleIn(sideOpenIds, id) }
function selectMenu(id: string): void {
  if (!activeToolId.value) return
  sideOpenIds.value = new Set([...sideOpenIds.value, ...(pathTo(props.menus, id) ?? [])])
  void router.push('/tool/' + activeToolId.value + '/' + id)
}

// 进入工具（挂载）即全部分组预展开：与原 openTool 导航前展开的语义一致（桌面卡片进入必经挂载）
sideOpenIds.value = new Set(collectGroupIds(props.menus))

watch((): boolean => props.collapsed, (collapsed) => { if (!collapsed) sidebarHover.value = false })
onBeforeUnmount(() => { if (hoverTimer !== undefined) window.clearTimeout(hoverTimer) })

function toggleCollapsed(): void {
  emit('update:collapsed', !props.collapsed)
}
</script>

<template>
  <aside
    class="tool-sidebar"
    :class="{ collapsed: props.collapsed, hover: sidebarHover, 'is-narrow': !sidebarExpanded }"
    @mouseenter="onSidebarEnter"
    @mouseleave="onSidebarLeave"
  >
    <div class="sidebar-menu">
      <div class="sidebar-head">
        <ToolIcon :icon="props.tool.icon" :tool-id="props.tool.id" :name="props.tool.name" :size="28" />
        <div class="sidebar-head-text">
          <strong>{{ props.tool.name }}</strong>
          <small
            ref="sidebarMarqueeRef"
            class="sidebar-marquee"
            :class="{ running: sidebarMarqueeRun }"
            :title="props.tool.categories.join(' / ')"
          >
            <span class="sidebar-marquee-track">{{ props.tool.categories.join(" / ") }}&nbsp;&nbsp;&nbsp;&nbsp;{{ props.tool.categories.join(" / ") }}</span>
          </small>
        </div>
      </div>
      <SidebarMenu
        :items="props.menus"
        :active="props.active"
        :open-ids="sideOpenIds"
        :show-children="sidebarExpanded"
        :toggle-group="toggleSideGroup"
        :select-item="selectMenu"
      />
    </div>
    <div class="sidebar-footer">
      <button
        class="sidebar-toggle"
        :title="props.collapsed ? '展开菜单' : '收起菜单'"
        :aria-label="props.collapsed ? '展开菜单' : '收起菜单'"
        @click="toggleCollapsed"
      >
        <el-icon class="sidebar-toggle-icon" :size="16"><DArrowLeft /></el-icon>
        <!-- 文案随状态切换：展开态提示收起；收起态提示展开；hover 临时展开时提示固定 -->
        <span class="toggle-text">
          {{ props.collapsed ? (sidebarHover ? '固定展开' : '展开菜单') : '收起菜单' }}
        </span>
      </button>
    </div>
  </aside>
</template>
