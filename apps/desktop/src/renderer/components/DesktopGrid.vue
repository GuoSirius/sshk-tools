<script setup lang="ts">
import { computed, ref } from 'vue'
import ToolIcon from './ToolIcon.vue'
import type { ToolRuntimeState } from '@sshk/shared'

/**
 * 桌面工具卡片网格（P6-8 CR-42 终拆自 App.vue）：搜索框 + 卡片网格 + 空态。
 * 名称超长悬浮跑马灯（2026-11-17 用户反馈）与搜索过滤随本组件；点卡片 open 事件上抛
 * （路由跳转与侧栏分组预展开在壳层，见 openTool）。
 */
const props = defineProps<{
  /** 可见工具全集（可见性由主进程裁决，壳层只消费 catalog 结果） */
  tools: ToolRuntimeState[]
}>()

const emit = defineEmits<{
  (e: 'open', id: string): void
}>()

const query = ref('')
const visibleTools = computed(() => {
  const keyword = query.value.trim().toLowerCase()
  if (!keyword) return props.tools
  return props.tools.filter((tool) =>
    `${tool.name} ${tool.description} ${tool.categories.join(' ')}`.toLowerCase().includes(keyword))
})

/** 工具名超长时悬浮跑马灯：进入卡片量出溢出量写进 CSS 变量驱动往返滚动，未溢出不动；离开卡片动画平滑回位（2026-11-17 用户反馈） */
function nameScrollStart(e: MouseEvent): void {
  const box = e.currentTarget as HTMLElement
  const text = box.querySelector<HTMLElement>('.card-name-text')
  if (!text) return
  // 截断态下 rect.width 已是裁切后宽度，须用 scrollWidth 量内容真实宽度
  const overflow = Math.ceil(text.scrollWidth - box.clientWidth)
  if (overflow <= 2) return
  text.style.setProperty('--name-shift', `${-overflow - 8}px`)
  text.classList.add('is-scrolling')
}
function nameScrollStop(e: MouseEvent): void {
  const text = (e.currentTarget as HTMLElement).querySelector<HTMLElement>('.card-name-text')
  if (text) text.classList.remove('is-scrolling')
}
</script>

<template>
  <div class="tool-page-head">
    <el-input v-model="query" placeholder="搜索工具" clearable style="max-width: 280px" />
    <span class="muted" style="margin-left: 12px">共 {{ visibleTools.length }} 个工具 · 可见性由应用设置统一管理</span>
  </div>
  <div class="desktop">
    <div class="desktop-grid">
      <article v-for="tool in visibleTools" :key="tool.id" class="tool-card" @click="emit('open', tool.id)" @mouseenter="nameScrollStart" @mouseleave="nameScrollStop">
        <ToolIcon :icon="tool.icon" :tool-id="tool.id" :name="tool.name" :size="44" />
        <h3 class="card-name"><span class="card-name-text">{{ tool.name }}</span></h3>
        <p class="muted card-desc">{{ tool.description }}</p>
        <div class="card-tags">
          <el-tag v-for="tag in tool.categories" :key="tag" size="small">{{ tag }}</el-tag>
          <el-tag v-if="tool.requiredGrant" size="small" type="warning">需密钥</el-tag>
          <span v-if="tool.warnings.length" class="card-warn" :title="tool.warnings.join('；')">依赖提示</span>
        </div>
      </article>
    </div>
    <div v-if="visibleTools.length === 0" class="empty-state">没有匹配的工具（可在「设置 → 工具与权限」启用）</div>
  </div>
</template>
