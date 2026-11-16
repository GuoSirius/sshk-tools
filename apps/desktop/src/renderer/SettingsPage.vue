<script setup lang="ts">
import { computed, nextTick, reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { Check, InfoFilled, Setting, WarningFilled } from '@element-plus/icons-vue'
import { ToolPageLayout, FormGrid, FormHint } from '@sshk/ui-kit'
import type { ToolConfigField, ToolConfigGroup } from '@sshk/shared'
import { useToolCatalog } from './composables/useToolCatalog'

/**
 * 工具级配置：只读写 tools.<toolId>.*，字段由工具包 manifest 的 configGroups 驱动。
 *
 * N14 布局重构：由「一页多卡片」改为左右两栏——
 *   左栏 = 全部分组导航（独立滚动，十几项也能从容排布）；
 *   右栏 = 连续表单区（独立滚动，分组间用分隔线而非卡片，内容少的组不再撑出空白）；
 *   底部 = 固定保存条（flex:none，不随表单滚动），带未保存提示。
 *
 * 两种形态：
 *   形态 1（layout=single，默认）：section 只做初始定位，左栏列出全部 configGroups；
 *   形态 2（layout=menu）：section 是 configPages[].id，一个二级菜单 = 一个真实页面，
 *     左栏只列该页声明的分组，页内继续复用同一套左右布局；切二级菜单即换页。
 *
 * 注意：上传配置工具 manifest 没有 configGroups，走独立的 UploadConfigPage，不受本页影响。
 */
const props = defineProps<{
  toolId: string
  section?: string
  /** 兼容宿主传参：历史 tabs 由目录归一为 single */
  layout?: 'single' | 'menu' | 'tabs'
}>()
const { byId } = useToolCatalog()
const tool = computed(() => byId.value.get(props.toolId) ?? null)
const values = reactive<Record<string, unknown>>({})
const depValues = reactive<Record<string, unknown>>({})
/** 动态选项：manifest 标 optionsSource 的字段从宿主能力实时拉取（如全局上传 profile） */
const dynamicOptions = reactive<Record<string, { label: string; value: string }[]>>({})
const saving = ref(false)
const dirty = ref(false)
const activeGroup = ref('')
const bodyEl = ref<HTMLElement | null>(null)
const DEPS_ID = '__deps__'
/** 点击导航后短暂锁定滚动高亮，避免 smooth scroll 经过中间组时高亮乱跳 */
let scrollLockUntil = 0

const isDev = import.meta.env.DEV

/** 形态 2 判定：menu 布局且清单声明了配置页 */
const isMultiPage = computed(() => tool.value?.configLayout === 'menu' && (tool.value?.configPages.length ?? 0) > 0)
/** 当前二级页：section 直接就是 configPages[].id；找不到时回退第一页（如刚点开父菜单 config） */
const activePage = computed(() => (tool.value?.configPages ?? [])
  .find((page) => page.id === props.section) ?? (tool.value?.configPages[0] ?? null))
const activePageLabel = computed(() => activePage.value?.label ?? '')

/** dev 下字段全量展示（AGENTS.md 铁律）；打包版隐藏 devOnly */
const allGroups = computed(() => (tool.value?.configGroups ?? [])
  .map((group) => ({
    ...group,
    fields: group.fields.filter((field) => !field.devOnly || isDev),
  })))
/** 当前页可见分组：形态 2 只取该页声明的组；形态 1 取全部 */
const groups = computed(() => {
  if (!isMultiPage.value) return allGroups.value.filter((group) => group.fields.length > 0)
  const ids = new Set(activePage.value?.groups ?? [])
  return allGroups.value.filter((group) => ids.has(group.id) && group.fields.length > 0)
})

const hasExtras = computed(() => Boolean(tool.value?.configDeps?.length || tool.value?.warnings?.length))

/** 开关项（3 列同行渲染）与其余字段分离（2026-11-16 用户反馈：文字与开关同行更紧凑） */
const booleanFields = (group: ToolConfigGroup) => group.fields.filter((field) => field.type === 'boolean')
const nonBooleanFields = (group: ToolConfigGroup) => group.fields.filter((field) => field.type !== 'boolean')
interface NavItem { id: string; label: string; count: number }
const navItems = computed<NavItem[]>(() => [
  ...groups.value.map((group) => ({ id: group.id, label: group.label, count: group.fields.length })),
  ...(hasExtras.value
    ? [{ id: DEPS_ID, label: '配置依赖', count: (tool.value?.configDeps?.length ?? 0) + (tool.value?.warnings?.length ?? 0) }]
    : []),
])

/** 路径类配置统一交互：选择 + 可手动修改（与产物目录一致） */
async function pickPath(field: ToolConfigField): Promise<void> {
  const picked = field.type === 'dir'
    ? await window.api.os.pickDir()
    : (await window.api.os.pickFile({}))[0] ?? ''
  if (picked) values[field.key] = picked
}
function pathFor(field: ToolConfigField): string {
  return `tools.${props.toolId}.${field.key}`
}
/** 载入值用全量字段（含 devOnly / 其它页），切页无需重新拉取 */
function manifestFields(): ToolConfigField[] {
  return (tool.value?.configGroups ?? []).flatMap((group) => group.fields)
}
/** 保存 / 校验只作用于当前可见字段：形态 2 下仅保存本页，不碰其它页 */
function currentFields(): ToolConfigField[] {
  return groups.value.flatMap((group) => group.fields)
}

async function load(): Promise<void> {
  for (const field of manifestFields()) {
    values[field.key] = await window.api.config.get(pathFor(field))
    // fallbackKey：值为空时展示生效值（如「默认 Provider」← 应用激活 Provider）
    if ((values[field.key] ?? '') === '' && field.fallbackKey) {
      values[field.key] = await window.api.config.get(field.fallbackKey)
    }
    if (field.optionsSource?.startsWith('upload:')) {
      const kind = field.optionsSource === 'upload:remote' ? 'remote'
        : field.optionsSource === 'upload:cloud' ? 'cloud' : undefined
      try {
        const list = await window.api.upload.profiles(kind)
        dynamicOptions[field.key] = [
          { label: '（跟随全局默认）', value: '' },
          ...list.map((p) => ({ label: p.label, value: p.id })),
        ]
      } catch {
        dynamicOptions[field.key] = [{ label: '（上传能力未就绪）', value: '' }]
      }
    }
  }
  for (const dep of tool.value?.configDeps ?? []) {
    depValues[`${dep.toolId}.${dep.key}`] = await window.api.config.get(`tools.${dep.toolId}.${dep.key}`)
  }
}
// catalog 首帧为空，工具就绪后必须重新拉取字段（只监听 id 避免频繁刷新）
watch(() => tool.value?.id, () => {
  void load().then(() => {
    dirty.value = false
    // 形态 2：section 是 page id，不是分组 id —— 定位到该页第一组
    const target = isMultiPage.value
      ? groups.value[0]?.id
      : (props.section?.startsWith('config-') ? props.section : groups.value[0]?.id)
    if (target) goto(target)
  })
}, { immediate: true })

// 任何字段变化都标记未保存；load() 完成后会重置，避免把回填误判成修改
watch(values, () => { dirty.value = true }, { deep: true })

function display(value: unknown): string {
  if (value === null || value === undefined) return '（未设置）'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

async function save(): Promise<void> {
  // 必填拦截：manifest 标 required 的字段为空时不落盘
  const missing = currentFields().filter((field) => field.required && String(values[field.key] ?? '').trim() === '')
  if (missing.length > 0) {
    ElMessage.error('必填项未填写：' + missing.map((field) => field.label).join('、'))
    return
  }
  saving.value = true
  try {
    for (const field of currentFields()) {
      const raw = values[field.key]
      const value = field.type === 'number' ? Number(raw) : field.type === 'boolean' ? Boolean(raw) : String(raw ?? '')
      await window.api.config.set(pathFor(field), value)
    }
    dirty.value = false
    ElMessage.success('工具配置已保存')
  } catch (err) {
    ElMessage.error((err as Error).message)
  } finally {
    saving.value = false
  }
}

function scrollToGroup(id: string): void {
  const container = bodyEl.value
  if (!container) return
  const target = container.querySelector<HTMLElement>(`[data-group="${id}"]`)
  if (!target) return
  const delta = target.getBoundingClientRect().top - container.getBoundingClientRect().top
  container.scrollTo({ top: container.scrollTop + delta - 8, behavior: 'smooth' })
}
function goto(id: string): void {
  activeGroup.value = id
  scrollLockUntil = Date.now() + 520
  void nextTick(() => scrollToGroup(id))
}
function onBodyScroll(): void {
  const container = bodyEl.value
  if (!container || Date.now() < scrollLockUntil) return
  const threshold = container.getBoundingClientRect().top + 28
  let current = navItems.value[0]?.id ?? ''
  for (const item of navItems.value) {
    const el = container.querySelector<HTMLElement>(`[data-group="${item.id}"]`)
    if (el && el.getBoundingClientRect().top <= threshold) current = item.id
  }
  activeGroup.value = current
}
// 形态 2：切二级菜单 = 换页，activePage 驱动 groups 重算，滚动回该页第一组
// 形态 1：section 只做定位，不裁剪右栏
watch(() => props.section, (section) => {
  if (!isMultiPage.value) {
    if (section?.startsWith('config-')) goto(section)
    return
  }
  void nextTick(() => {
    const target = groups.value[0]?.id
    if (target) goto(target)
  })
})
</script>

<template>
  <ToolPageLayout class="settings-layout">
    <div class="split">
      <aside class="split-nav">
        <div class="nav-title">{{ isMultiPage ? (activePageLabel || '配置分组') : '配置分组' }}</div>
        <button
          v-for="item in navItems"
          :key="item.id"
          type="button"
          class="nav-item"
          :class="{ 'is-active': activeGroup === item.id }"
          @click="goto(item.id)"
        >
          <el-icon class="nav-icon">
            <Setting v-if="item.id !== DEPS_ID" />
            <InfoFilled v-else />
          </el-icon>
          <span class="nav-label">{{ item.label }}</span>
          <span class="nav-count">{{ item.count }}</span>
        </button>
        <div v-if="!navItems.length" class="nav-empty">该工具暂无配置项</div>
      </aside>

      <div class="split-main">
        <div ref="bodyEl" class="split-body" @scroll.passive="onBodyScroll">
          <section
            v-for="group in groups"
            :key="group.id"
            class="panel"
            :class="{ 'is-focused': section === group.id || activeGroup === group.id }"
            :data-group="group.id"
          >
            <div class="panel-head"><el-icon><Setting /></el-icon>{{ group.label }}</div>
            <!-- plans/01 全局表单规范：开关项 3 列同行（文字与开关同排）；其余 2 列栅格 + dir/file/textarea/full 独占整行 -->
            <el-form size="small" label-position="top">
              <FormGrid v-if="booleanFields(group).length" :cols="3">
                <el-form-item v-for="field in booleanFields(group)" :key="field.key">
                  <div class="switch-row">
                    <span class="switch-label">
                      {{ field.label }}
                      <FormHint v-if="field.hint" :inline="true">{{ field.hint }}</FormHint>
                    </span>
                    <el-switch v-model="values[field.key]" />
                  </div>
                </el-form-item>
              </FormGrid>
              <FormGrid>
                <el-form-item
                  v-for="field in nonBooleanFields(group)"
                  :key="field.key"
                  :label="field.label"
                  :class="{ full: field.full || field.type === 'textarea' || field.type === 'dir' || field.type === 'file' }"
                >
                  <el-input-number
                    v-if="field.type === 'number'"
                    v-model="values[field.key]"
                    :min="field.min"
                    :max="field.max"
                  />
                  <el-input v-else-if="field.type === 'textarea'" v-model="values[field.key]" type="textarea" :rows="3" />
                  <div v-else-if="field.type === 'dir' || field.type === 'file'" class="path-row combo">
                    <el-input v-model="values[field.key]" :placeholder="field.type === 'dir' ? '选择或手动填写目录' : '选择或手动填写文件'" />
                    <el-button size="small" @click="pickPath(field)">
                      {{ field.type === 'dir' ? '选择目录' : '选择文件' }}
                    </el-button>
                  </div>
                  <el-select v-else-if="field.type === 'select'" v-model="values[field.key]" filterable clearable>
                    <el-option v-for="opt in dynamicOptions[field.key] ?? field.options" :key="opt.value" :label="opt.label" :value="opt.value" />
                  </el-select>
                  <el-input v-else v-model="values[field.key]" />
                  <FormHint v-if="field.hint">{{ field.hint }}</FormHint>
                </el-form-item>
              </FormGrid>
            </el-form>
          </section>

          <section v-if="hasExtras" class="panel" :data-group="DEPS_ID">
            <div class="panel-head"><el-icon><InfoFilled /></el-icon>配置依赖</div>
            <div v-for="dep in tool?.configDeps ?? []" :key="`${dep.toolId}.${dep.key}`" class="kv">
              <span>{{ byId.get(dep.toolId)?.name ?? dep.toolId }} · {{ dep.label }}</span>
              <code>{{ display(depValues[`${dep.toolId}.${dep.key}`]) }}</code>
            </div>
            <div v-for="(warning, i) in tool?.warnings ?? []" :key="i" class="warning-line">{{ warning }}</div>
            <div class="hint" style="margin-top: 8px">依赖配置只读，由所属工具管理；禁用 / 删除工具请在「设置 → 工具与权限」中操作</div>
          </section>

          <div v-if="!groups.length && !hasExtras" class="empty-inline">该工具暂无可编辑配置</div>
        </div>

        <!-- 固定保存条：不随右栏表单滚动，长表单填到底也能一键保存 -->
        <div class="split-foot">
          <span class="muted">
            配置落盘路径：tools.{{ toolId }}.*
            <template v-if="isMultiPage"> · 当前页「{{ activePageLabel }}」独立保存</template>
          </span>
          <div class="foot-actions">
            <span v-if="dirty" class="dirty-tip"><el-icon><WarningFilled /></el-icon>有未保存修改</span>
            <el-button type="primary" size="small" :loading="saving" @click="save">
              <el-icon><Check /></el-icon>保存工具配置
            </el-button>
          </div>
        </div>
      </div>
    </div>

    <template #footer>
      <span class="muted">工具元数据与可见性由主进程统一裁决 · 应用 / 系统级配置请从右上角「设置」进入</span>
    </template>
  </ToolPageLayout>
</template>

<style scoped>
/* ToolPageLayout 的中段改为不滚动，滚动交给左右两栏各自承担 */
:deep(.tool-page-body) { overflow: hidden; }

.split {
  display: flex;
  gap: 12px;
  height: 100%;
  min-height: 0;
}
.split-nav {
  flex: none;
  width: 224px;
  min-height: 0;
  overflow-y: auto;
  padding: 8px;
  border: 1px solid var(--sshk-border);
  border-radius: 10px;
  background: var(--sshk-panel);
}
.nav-title {
  padding: 4px 8px 10px;
  font-size: 12px;
  font-weight: 600;
  opacity: .6;
  letter-spacing: .04em;
}
.nav-item {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  padding: 9px 10px;
  margin-bottom: 4px;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 13px;
  text-align: left;
  cursor: pointer;
  transition: background .16s ease, color .16s ease;
}
.nav-item:hover { background: color-mix(in srgb, var(--sshk-accent) 8%, transparent); }
.nav-item.is-active {
  background: color-mix(in srgb, var(--sshk-accent) 16%, transparent);
  color: var(--sshk-accent);
  font-weight: 600;
}
.nav-icon { flex: none; font-size: 15px; }
.nav-label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.nav-count {
  flex: none;
  min-width: 20px;
  padding: 1px 6px;
  border-radius: 9px;
  background: color-mix(in srgb, var(--sshk-accent) 12%, transparent);
  font-size: 11px;
  text-align: center;
}
.nav-empty, .empty-inline { font-size: 13px; opacity: .55; padding: 12px 8px; }

.split-main {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.split-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding-right: 8px;
}
/* 右栏用分隔线分区，不用卡片：内容少的分组不会再被撑成空盒子 */
.panel {
  padding: 4px 0 18px;
  margin-bottom: 6px;
  border-bottom: 1px dashed var(--sshk-border);
  scroll-margin-top: 8px;
}
.panel:last-child { border-bottom: 0; }
.panel.is-focused .panel-head { color: var(--sshk-accent); }
.panel-head {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
  margin-bottom: 14px;
}
.hint, .muted { font-size: 12px; opacity: .6; line-height: 1.5; }
.hint { display: block; }
.kv {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 6px 0;
  border-bottom: 1px dashed var(--sshk-border);
  font-size: 13px;
}
.kv code { font-size: 12px; opacity: .75; word-break: break-all; }
.warning-line { font-size: 12px; color: #ffb35c; padding: 6px 0; }
.path-row { display: flex; gap: 8px; width: 100%; }

.split-foot {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 4px 2px;
  border-top: 1px solid var(--sshk-border);
}
.foot-actions { display: flex; align-items: center; gap: 12px; }
.dirty-tip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  color: #ffb35c;
}
/* 开关项：文字与开关同行（2026-11-16 用户反馈） */
.switch-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  width: 100%;
}
.switch-label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  min-width: 0;
}
.switch-label :deep(.sshk-form-hint) {
  width: auto;
}
</style>
