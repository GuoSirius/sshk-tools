<script setup lang="ts">
import { computed, nextTick, reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { ToolPageLayout } from '@sshk/ui-kit'
import type { ToolConfigField } from '@sshk/shared'
import { useToolCatalog } from './composables/useToolCatalog'

// 工具级配置：只读写 tools.<toolId>.*，字段由工具包 manifest 的 configGroups 驱动
const props = defineProps<{
  toolId: string
  section?: string
  /** 由工具包 manifest.configLayout 决定：single / tabs / menu */
  layout?: 'single' | 'tabs' | 'menu'
}>()
const { byId } = useToolCatalog()
const tool = computed(() => byId.value.get(props.toolId) ?? null)
const values = reactive<Record<string, unknown>>({})
const depValues = reactive<Record<string, unknown>>({})
const saving = ref(false)
const activeTab = ref('')
const layout = computed(() => props.layout ?? 'single')

/**
 * single = 一页全部卡片（内置工具默认）；
 * tabs  = 内容区分页；menu = 左侧子菜单逐页（由 App.vue 生成二级菜单）。
 * 保存始终针对 allFields()，切换布局不会漏存字段。
 */
const isDev = import.meta.env.DEV
const shownGroups = computed(() => {
  const raw = (tool.value?.configGroups ?? []).map((group) => ({
    ...group,
    fields: group.fields.filter((field) => !field.devOnly || isDev),
  })).filter((group) => group.fields.length > 0)
  const groups = raw
  if (layout.value === 'tabs') {
    return groups.filter((group) => group.id === activeTab.value)
  }
  if (layout.value === 'menu' && props.section?.startsWith('config-')) {
    const hit = groups.filter((group) => group.id === props.section)
    if (hit.length > 0) return hit
  }
  return groups
})

function pathFor(field: ToolConfigField): string {
  return `tools.${props.toolId}.${field.key}`
}
function allFields(): ToolConfigField[] {
  return (tool.value?.configGroups ?? []).flatMap((group) => group.fields)
}

async function load(): Promise<void> {
  for (const field of allFields()) {
    values[field.key] = await window.api.config.get(pathFor(field))
    // fallbackKey：值为空时展示生效值（如「默认 Provider」← 应用激活 Provider）
    if ((values[field.key] ?? '') === '' && field.fallbackKey) {
      values[field.key] = await window.api.config.get(field.fallbackKey)
    }
  }
  for (const dep of tool.value?.configDeps ?? []) {
    depValues[`${dep.toolId}.${dep.key}`] = await window.api.config.get(`tools.${dep.toolId}.${dep.key}`)
  }
}
// catalog 首帧为空，工具就绪后必须重新拉取字段（只监听 id 避免频繁刷新）
watch(() => tool.value?.id, () => {
  activeTab.value = tool.value?.configGroups[0]?.id ?? ''
  void load()
}, { immediate: true })

function display(value: unknown): string {
  if (value === null || value === undefined) return '（未设置）'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

async function save(): Promise<void> {
  saving.value = true
  try {
    for (const field of allFields()) {
      const raw = values[field.key]
      const value = field.type === 'number' ? Number(raw) : field.type === 'boolean' ? Boolean(raw) : String(raw ?? '')
      await window.api.config.set(pathFor(field), value)
    }
    ElMessage.success('工具配置已保存')
  } catch (err) {
    ElMessage.error((err as Error).message)
  } finally {
    saving.value = false
  }
}

function focusSection(section?: string): void {
  if (!section) return
  void nextTick(() => {
    document.querySelector(`[data-group="${section}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  })
}
watch(() => props.section, focusSection, { immediate: true })
</script>

<template>
  <ToolPageLayout
    :title="`${tool?.name ?? '工具'} · 工具配置`"
    description="仅管理本工具自己的配置；应用 / 系统级配置请从右上角「设置」进入"
  >
    <template #actions>
      <el-button type="primary" size="small" :loading="saving" @click="save">保存工具配置</el-button>
    </template>

    <el-tabs v-if="layout === 'tabs'" v-model="activeTab" class="config-tabs">
      <el-tab-pane
        v-for="group in tool?.configGroups ?? []"
        :key="group.id"
        :label="group.label"
        :name="group.id"
      />
    </el-tabs>

    <div class="settings-grid">
      <section
        v-for="group in shownGroups"
        :key="group.id"
        class="panel"
        :class="{ 'is-focused': section === group.id }"
        :data-group="group.id"
      >
        <div class="panel-head"><span class="dot" />{{ group.label }}</div>
        <el-form label-width="140px" size="small">
          <el-form-item v-for="field in group.fields" :key="field.key" :label="field.label">
            <el-switch v-if="field.type === 'boolean'" v-model="values[field.key]" />
            <el-input-number
              v-else-if="field.type === 'number'"
              v-model="values[field.key]"
              :min="field.min"
              :max="field.max"
            />
            <el-select v-else-if="field.type === 'select'" v-model="values[field.key]" style="width: 220px">
              <el-option v-for="opt in field.options" :key="opt.value" :label="opt.label" :value="opt.value" />
            </el-select>
            <el-input v-else v-model="values[field.key]" style="width: 260px" />
            <span v-if="field.hint" class="hint">{{ field.hint }}</span>
          </el-form-item>
        </el-form>
      </section>

      <section v-if="tool?.configDeps?.length || tool?.warnings?.length" class="panel">
        <div class="panel-head"><span class="dot" />配置依赖</div>
        <div v-for="dep in tool?.configDeps ?? []" :key="`${dep.toolId}.${dep.key}`" class="kv">
          <span>{{ byId.get(dep.toolId)?.name ?? dep.toolId }} · {{ dep.label }}</span>
          <code>{{ display(depValues[`${dep.toolId}.${dep.key}`]) }}</code>
        </div>
        <div v-for="(warning, i) in tool?.warnings ?? []" :key="i" class="warning-line">{{ warning }}</div>
        <div class="hint" style="margin-top: 8px">依赖配置只读，由所属工具管理；禁用 / 删除工具请在「设置 → 工具与权限」中操作</div>
      </section>
    </div>

    <template #footer>
      <span class="muted">配置落盘路径：tools.{{ toolId }}.* · 工具元数据与可见性由主进程统一裁决</span>
    </template>
  </ToolPageLayout>
</template>

<style scoped>
.settings-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(360px, 1fr));
  gap: 12px;
}
.panel {
  border: 1px solid var(--sshk-border);
  border-radius: 10px;
  padding: 14px 16px;
  background: var(--sshk-panel);
  transition: border-color .2s ease, box-shadow .2s ease;
}
.panel.is-focused {
  border-color: var(--sshk-accent);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--sshk-accent) 14%, transparent);
}
.panel-head {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
  margin-bottom: 14px;
}
.dot {
  width: 6px;
  height: 14px;
  border-radius: 3px;
  background: var(--sshk-accent);
}
.hint, .muted { font-size: 12px; opacity: .6; }
.hint { display: block; line-height: 1.5; }
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
</style>
