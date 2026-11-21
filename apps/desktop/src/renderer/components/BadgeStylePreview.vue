<script setup lang="ts">
import { computed } from 'vue'

/**
 * 角标样式实时预览（工具配置「角标样式覆盖」组，manifest 声明 preview: 'badge-css' 时渲染）。
 * 九宫格 = 九个锚点位置各一格：每格用「内置默认样式 → 公共 CSS → 该位置 CSS」的覆盖链
 * 实时渲染一个 mock 角标，改编辑器里的 CSS 立刻看到真实位置与颜色效果（用户 2026-11-18）。
 * 与 core/badge.ts 的 sanitizeCss / POSITION_POINTS 语义同源（宿主不 import 工具包内核，此处保持镜像）。
 */
const props = defineProps<{
  /** 当前页全部字段值（key = manifest field key，如 badgeStyleCss.positions.topLeft） */
  values: Record<string, unknown>
}>()

interface Pos { key: string; label: string; anchor: string; mock: 'text' | 'image' }
const POSITIONS: Pos[] = [
  { key: 'topLeft', label: '左上', anchor: 'top:0;left:0', mock: 'text' },
  { key: 'topCenter', label: '上中', anchor: 'top:0;left:50%', mock: 'image' },
  { key: 'topRight', label: '右上', anchor: 'top:0;left:100%', mock: 'text' },
  { key: 'leftCenter', label: '左中', anchor: 'top:50%;left:0', mock: 'image' },
  { key: 'center', label: '居中', anchor: 'top:50%;left:50%', mock: 'text' },
  { key: 'rightCenter', label: '右中', anchor: 'top:50%;left:100%', mock: 'image' },
  { key: 'bottomLeft', label: '左下', anchor: 'top:100%;left:0', mock: 'text' },
  { key: 'bottomCenter', label: '下中', anchor: 'top:100%;left:50%', mock: 'image' },
  { key: 'bottomRight', label: '右下', anchor: 'top:100%;left:100%', mock: 'text' },
]

/** 与 core/badge.ts sanitizeCss 同源：折叠换行、剥离 position/transform/margin（由锚点+offset 体系接管） */
function sanitize(raw: unknown): string {
  const s = typeof raw === 'string' ? raw : ''
  if (!s) return ''
  return s
    .replace(/[\r\n]+/g, '')
    .replace(/(?<![a-zA-Z-])(position|transform|margin)\s*:[^;}]*/gi, '')
    .replace(/;{2,}/g, ';')
    .replace(/^;+|;+$/g, '')
    .trim()
}

function fieldCss(key: string): string {
  const common = sanitize(props.values['badgeStyleCss.common'])
  const pos = sanitize(props.values[`badgeStyleCss.positions.${key}`])
  return [common, pos].filter(Boolean).join(';')
}

/** 内置默认样式（与 GeneratePage badgeStyle 默认值一致；badgeStyle.* 当前不在配置页维护） */
const BASE = { background: '#e60012', color: '#fff', size: 18, offsetX: 0, offsetY: 0 }

function badgeStyleOf(key: string): Record<string, string> {
  const overrides: Record<string, string> = {}
  for (const decl of fieldCss(key).split(';')) {
    const i = decl.indexOf(':')
    if (i <= 0) continue
    const prop = decl.slice(0, i).trim().toLowerCase().replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())
    const val = decl.slice(i + 1).trim()
    if (prop && val) overrides[prop] = val
  }
  return {
    position: 'absolute',
    top: '0', left: '0',
    transform: `translate(calc(-50% + ${BASE.offsetX}px), calc(-50% + ${BASE.offsetY}px))`,
    display: 'inline-block',
    background: BASE.background,
    color: BASE.color,
    fontSize: `${BASE.size}px`,
    lineHeight: '1',
    padding: '2px 5px',
    borderRadius: '9px',
    whiteSpace: 'nowrap',
    zIndex: '9',
    ...overrides,
  }
}

const cells = computed(() => POSITIONS.map((p) => ({
  ...p,
  style: { ...badgeStyleOf(p.key), top: '', left: '', ...anchorToStyle(p.anchor) },
})))

/** anchor（top:0;left:100% 形式）拆成 top/left 两个样式，锚点固定、用户 CSS 不再覆盖 */
function anchorToStyle(anchor: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const decl of anchor.split(';')) {
    const i = decl.indexOf(':')
    if (i > 0) out[decl.slice(0, i).trim()] = decl.slice(i + 1).trim()
  }
  return out
}
</script>

<template>
  <div class="badge-preview">
    <div class="preview-title">实时预览（九宫格 = 九个锚点位置；mock 数值 128）</div>
    <div class="preview-grid">
      <div v-for="cell in cells" :key="cell.key" class="preview-cell" :title="`${cell.label}：${fieldCss(cell.key) || '（内置默认）'}`">
        <div class="mock-body">
          <!-- mock 文本链接 / 图片链接：看角标真实位置、颜色、字号效果 -->
          <span v-if="cell.mock === 'text'" class="mock-link">Procell 12月营销EDM · 点此查看详情</span>
          <div v-else class="mock-image"><span>图片链接</span></div>
          <span class="mock-badge" :style="cell.style">128</span>
        </div>
        <div class="cell-label">{{ cell.label }}</div>
      </div>
    </div>
    <div class="preview-hint">预览为内置默认样式叠加公共/位置 CSS；position / transform / margin 与实际注入一致会被剥离（由锚点体系接管）</div>
  </div>
</template>

<style scoped>
.badge-preview {
  border: 1px solid rgba(128, 128, 128, 0.25);
  border-radius: 6px;
  padding: 10px 12px;
  margin-bottom: 12px;
}
.preview-title { font-size: 12px; font-weight: 600; opacity: 0.85; margin-bottom: 8px; }
.preview-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
.preview-cell { min-width: 0; }
.mock-body {
  position: relative;
  background: #fff;
  color: #222;
  border-radius: 6px;
  height: 56px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 10px;
  overflow: hidden;
}
.mock-link {
  color: #1a73e8;
  text-decoration: underline;
  font-size: 12px;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mock-image {
  width: 80%;
  height: 36px;
  border-radius: 4px;
  background: linear-gradient(135deg, #8fb8f6, #3f6fd8);
  color: #fff;
  font-size: 11px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.mock-badge { pointer-events: none; }
.cell-label { font-size: 11px; opacity: 0.6; margin-top: 4px; text-align: center; }
.preview-hint { font-size: 11px; opacity: 0.55; margin-top: 8px; line-height: 1.5; }
</style>
