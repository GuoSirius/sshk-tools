<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { HOST_API_VERSION, TOOL_PACKAGE_SCHEMA_VERSION } from '@sshk/shared'
import type { ToolConfigFieldType } from '@sshk/shared'
import { useToolCatalog } from '../composables/useToolCatalog'
import BasicInfoSection from './tool-form/BasicInfoSection.vue'
import MenusSection from './tool-form/MenusSection.vue'
import CapabilitiesSection from './tool-form/CapabilitiesSection.vue'
import ConfigGroupsSection from './tool-form/ConfigGroupsSection.vue'
import JsonPreviewPane from './tool-form/JsonPreviewPane.vue'
import { parseOptions } from './tool-form/types'

/**
 * 开发者模式：工具清单（tool.manifest.json）可视化编辑 + 构建/打包动作。
 * 表单由 tool-form/ 共享组件拼装（与创建向导同源）；保存后写回源码文件并可立即跑 verify。
 * 由设置抽屉打开：源码 dev 运行始终可用；打包/安装版需 app.developerMode 且主进程确认源码仓库可用。
 */
const props = defineProps<{ modelValue: boolean; toolId: string }>()
const emit = defineEmits<{ 'update:modelValue': [boolean]; saved: [unknown] }>()

interface DepRow { toolId: string; key: string; label: string }
interface DefaultRow { key: string; label: string; type: ToolConfigFieldType; value: string | number | boolean | null }
interface ManifestForm {
  id: string
  name: string
  description: string
  category: string
  tags: string
  icon: string
  entryRoute: string
  enabled: boolean
  visibility: string
  configLayout: string
  menus: { id: string; label: string }[]
  plugin: { source: string; main: string; renderer: string }
  pkg: {
    version: string
    capabilities: string[]
    sandbox: string
    ipcAllowlist: string[]
  }
  dependsOn: string[]
  requiredGrant: string
}

function emptyForm(): ManifestForm {
  return {
    id: '', name: '', description: '', category: '', tags: '', icon: 'auto',
    entryRoute: 'home', enabled: true, visibility: 'managed', configLayout: 'single',
    menus: [], plugin: { source: 'builtin', main: '', renderer: '' },
    pkg: { version: '1.0.0', capabilities: [], sandbox: 'utility', ipcAllowlist: [] },
    dependsOn: [], requiredGrant: '',
  }
}

const form = reactive<ManifestForm>(emptyForm())
const original = ref<Record<string, unknown>>({})
const output = ref('')
const busy = ref(false)
const tab = ref('basic')
const signBeforePack = ref(true)

const { payload: catalogPayload } = useToolCatalog()
const toolIdOptions = computed(() => catalogPayload.value.tools.map((tool) => tool.id))
const categoryOptions = computed(() => {
  const set = new Set<string>()
  for (const tool of catalogPayload.value.tools) for (const c of tool.categories) set.add(c)
  return [...set]
})

// ── N16 表单化：configGroups / configDeps / defaults 全部结构化行编辑 ──
const groupRows = ref<import('./tool-form/types').GroupRow[]>([])
const depRows = ref<DepRow[]>([])
const channelRows = ref<string[]>([])
/** defaults 行：key 来自当前 configGroups 字段；额外键保留在 extraDefaults */
const defaultRows = ref<DefaultRow[]>([])
const extraDefaults = ref<Record<string, unknown>>({})

function addDep(): void { depRows.value.push({ toolId: '', key: '', label: '' }) }
/** a.b.c 点路径读值 */
function nestedGet(obj: Record<string, unknown>, path: string): unknown {
  let cursor: unknown = obj
  for (const part of path.split('.')) {
    if (typeof cursor !== 'object' || cursor === null) return undefined
    cursor = (cursor as Record<string, unknown>)[part]
  }
  return cursor
}
/** a.b.c 点路径写值 */
function nestedSet(obj: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split('.')
  let cursor = obj
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i] ?? ''
    if (typeof cursor[key] !== 'object' || cursor[key] === null) cursor[key] = {}
    cursor = cursor[key] as Record<string, unknown>
  }
  cursor[parts[parts.length - 1] ?? ''] = value
}
/** 新增/删除字段后重扫：把分组字段里还没有默认值行的补进来（保留已填的行） */
function rescanDefaults(): void {
  const known = new Set(defaultRows.value.map((row) => row.key))
  const originalDefaults = (typeof original.value.defaults === 'object' && original.value.defaults !== null
    ? original.value.defaults : {}) as Record<string, unknown>
  for (const group of groupRows.value) for (const field of group.fields) {
    if (!field.key.trim() || known.has(field.key)) continue
    const value = nestedGet(originalDefaults, field.key)
    defaultRows.value.push({
      key: field.key,
      label: field.label,
      type: field.type,
      value: value === undefined
        ? (field.type === 'boolean' ? false : field.type === 'number' ? (field.min ?? 0) : '')
        : value as string | number | boolean,
    })
    known.add(field.key)
  }
  ElMessage.success(`默认值行已同步（共 ${defaultRows.value.length} 项）`)
}

const tabList = [
  { id: 'basic', label: '基础' },
  { id: 'menus', label: '菜单' },
  { id: 'plugin', label: '插件' },
  { id: 'contract', label: '契约' },
  { id: 'advanced', label: '配置与依赖' },
  { id: 'preview', label: 'JSON 预览' },
] as const

function asString(value: unknown, fallback = ''): string {
  return value === undefined || value === null ? fallback : String(value)
}
function asArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : []
}

async function loadManifest(): Promise<void> {
  try {
    const text = await window.api.dev.manifestGet(props.toolId)
    const obj = JSON.parse(text) as Record<string, unknown>
    original.value = obj
    const plugin = (obj.plugin ?? {}) as Record<string, unknown>
    const pkg = (obj.package ?? {}) as Record<string, unknown>
    const rh = (pkg.requiresHost ?? {}) as Record<string, unknown>
    Object.assign(form, {
      id: asString(obj.id, props.toolId),
      name: asString(obj.name),
      description: asString(obj.description),
      category: Array.isArray(obj.category) ? obj.category.join('、') : asString(obj.category),
      tags: asArray(obj.tags).join(', '),
      icon: asString(obj.icon, 'auto'),
      entryRoute: asString(obj.entryRoute, 'home'),
      enabled: obj.enabled !== false,
      visibility: asString(obj.visibility, 'managed'),
      configLayout: asString(obj.configLayout, 'single'),
      menus: Array.isArray(obj.menus)
        ? (obj.menus as Record<string, unknown>[]).map((m) => ({ id: asString(m.id), label: asString(m.label) }))
        : [],
      plugin: {
        source: asString(plugin.source, 'builtin'),
        main: asString(plugin.main),
        renderer: asString(plugin.renderer),
      },
      pkg: {
        version: asString(pkg.version, '1.0.0'),
        capabilities: asArray(rh.capabilities),
        sandbox: asString(pkg.sandbox, 'utility'),
        ipcAllowlist: asArray(pkg.ipcAllowlist),
      },
      dependsOn: asArray(obj.dependsOn),
      requiredGrant: asString(obj.requiredGrant),
    } satisfies ManifestForm)
    // N16：JSON 结构 → 表单行（configGroups / configDeps / channels / defaults）
    groupRows.value = (Array.isArray(obj.configGroups) ? obj.configGroups as Record<string, unknown>[] : [])
      .map((group) => ({
        id: asString(group.id),
        label: asString(group.label),
        fields: (Array.isArray(group.fields) ? group.fields as Record<string, unknown>[] : []).map((field) => ({
          key: asString(field.key),
          label: asString(field.label),
          type: (asString(field.type, 'string') as ToolConfigFieldType),
          hint: asString(field.hint),
          min: typeof field.min === 'number' ? field.min : null,
          max: typeof field.max === 'number' ? field.max : null,
          optionsText: (Array.isArray(field.options) ? field.options as { label: string; value: string }[] : [])
            .map((opt) => `${opt.label}:${opt.value}`).join(', '),
        })),
      }))
    depRows.value = (Array.isArray(obj.configDeps) ? obj.configDeps as Record<string, unknown>[] : [])
      .map((dep) => ({ toolId: asString(dep.toolId), key: asString(dep.key), label: asString(dep.label) }))
    channelRows.value = asArray(plugin.channels)
    // defaults：字段 key → 行；未在字段中的额外键保留原样
    const originalDefaults = (typeof obj.defaults === 'object' && obj.defaults !== null ? obj.defaults : {}) as Record<string, unknown>
    const extra: Record<string, unknown> = JSON.parse(JSON.stringify(originalDefaults)) as Record<string, unknown>
    defaultRows.value = groupRows.value.flatMap((group) => group.fields
      .filter((field) => field.key.trim())
      .map((field) => {
        delete extra[field.key.split('.')[0] ?? '']
        const value = nestedGet(originalDefaults, field.key)
        return {
          key: field.key,
          label: field.label,
          type: field.type,
          value: value === undefined
            ? (field.type === 'boolean' ? false : field.type === 'number' ? (field.min ?? 0) : '')
            : value as string | number | boolean,
        }
      }))
    extraDefaults.value = extra
    output.value = ''
  } catch (err) {
    ElMessage.error(`读取清单失败：${(err as Error).message}`)
    emit('update:modelValue', false)
  }
}

watch(() => [props.modelValue, props.toolId], ([open]) => {
  if (open) void loadManifest()
}, { immediate: true })

function splitList(value: string): string[] {
  // 只按逗号/顿号切分；空格是合法的标签字符（如「OCR 识别」），绝不作分隔符（台账 #21）
  return value.split(/[,，、]+/).map((s) => s.trim()).filter(Boolean)
}
/** 表单行 → configGroups；校验必填并返回结构化数组 */
function buildConfigGroups(): Record<string, unknown>[] {
  return groupRows.value.map((group) => {
    if (!group.id.trim() || !group.label.trim()) throw new Error(`配置分组「${group.label || group.id}」缺少 id 或名称`)
    if (group.fields.length === 0) throw new Error(`配置分组「${group.label}」至少需要一个字段`)
    return {
      id: group.id.trim(),
      label: group.label.trim(),
      fields: group.fields.map((field) => {
        if (!field.key.trim() || !field.label.trim()) throw new Error(`分组「${group.label}」存在未填写的字段`)
        return {
          key: field.key.trim(),
          label: field.label.trim(),
          type: field.type,
          ...(field.hint.trim() ? { hint: field.hint.trim() } : {}),
          ...(field.min !== null ? { min: field.min } : {}),
          ...(field.max !== null ? { max: field.max } : {}),
          ...(field.type === 'select' ? { options: parseOptions(field.optionsText) } : {}),
        }
      }),
    }
  })
}
function buildDefaults(): Record<string, unknown> {
  const out: Record<string, unknown> = JSON.parse(JSON.stringify(extraDefaults.value)) as Record<string, unknown>
  for (const row of defaultRows.value) {
    let value: unknown = row.value
    if (row.type === 'number') value = Number(row.value)
    else if (row.type === 'boolean') value = Boolean(row.value)
    else value = String(row.value ?? '')
    nestedSet(out, row.key, value)
  }
  return out
}

/** 表单 → manifest：保留原文件里的未知字段，只覆盖本表单管理的键 */
function toManifest(): string {
  const pkg = (original.value.package ?? {}) as Record<string, unknown>
  const plugin = (original.value.plugin ?? {}) as Record<string, unknown>
  const next: Record<string, unknown> = {
    ...original.value,
    id: form.id,
    name: form.name,
    description: form.description,
    category: form.category.includes('、') ? form.category.split('、') : form.category,
    tags: splitList(form.tags),
    icon: form.icon,
    entryRoute: form.entryRoute,
    enabled: form.enabled,
    visibility: form.visibility,
    configLayout: form.configLayout,
    menus: form.menus,
    plugin: {
      ...plugin,
      source: form.plugin.source,
      main: form.plugin.main,
      renderer: form.plugin.renderer,
      channels: [...channelRows.value],
    },
    package: {
      ...pkg,
      schemaVersion: TOOL_PACKAGE_SCHEMA_VERSION,
      version: form.pkg.version,
      requiresHost: {
        api: `^${HOST_API_VERSION.split('.')[0]}.0`,
        capabilities: form.pkg.capabilities,
      },
      sandbox: form.pkg.sandbox,
      ipcAllowlist: form.pkg.ipcAllowlist,
    },
    dependsOn: form.dependsOn,
    configDeps: depRows.value
      .filter((dep) => dep.toolId.trim() && dep.key.trim())
      .map((dep) => ({ toolId: dep.toolId.trim(), key: dep.key.trim(), label: dep.label.trim() || dep.key.trim() })),
    configGroups: buildConfigGroups(),
    defaults: buildDefaults(),
    requiredGrant: form.requiredGrant,
  }
  return JSON.stringify(next, null, 2) + '\n'
}

/** N16：实时 JSON 预览（填写完成即可看到落盘数据；解析失败显示原因） */
const preview = computed<{ text: string; error: string }>(() => {
  try { return { text: toManifest(), error: '' } } catch (err) { return { text: '', error: (err as Error).message } }
})

async function execute(label: string, action: () => Promise<{ ok: boolean; output: string }>): Promise<void> {
  busy.value = true
  try {
    const result = await action()
    output.value = `【${label}】${result.ok ? '成功' : '失败'}\n${result.output}`
    if (result.ok) ElMessage.success(`${label}完成`)
    else ElMessage.error(`${label}失败，详见下方输出`)
  } catch (err) {
    output.value = `【${label}】异常：${(err as Error).message}`
    ElMessage.error(output.value)
  } finally {
    busy.value = false
  }
}

async function saveAndVerify(): Promise<void> {
  let raw: string
  try { raw = toManifest() } catch (err) { ElMessage.error((err as Error).message); return }
  await execute('保存并校验', async () => {
    const saved = await window.api.dev.manifestSet(props.toolId, raw)
    if (!saved.ok) return saved
    // 主进程已重载清单并重建目录：随响应回传新 payload，交给父组件 accept 全局刷新（权限列表/桌面）
    if (saved.catalog) emit('saved', saved.catalog)
    const verified = await window.api.dev.verify()
    return { ok: verified.ok, output: `${saved.output}\n${verified.output}` }
  })
}
function close(): void { emit('update:modelValue', false) }
function buildExternalAction(): void { execute('构建外部产物', () => window.api.dev.buildExternal(props.toolId)) }
function buildBuiltinAction(): void { execute('打包应用（内建）', () => window.api.dev.build()) }
function packAction(): void { execute('导出 .sshktool', () => window.api.dev.pack(props.toolId, signBeforePack.value)) }
const title = computed(() => `工具清单配置 · ${props.toolId}`)
</script>

<template>
  <el-dialog
    :model-value="modelValue"
    :title="title"
    width="min(960px, 92vw)"
    :close-on-click-modal="false"
    :close-on-press-escape="false"
    @update:model-value="emit('update:modelValue', Boolean($event))"
  >
    <div class="manifest-shell">
      <el-tabs v-model="tab" type="card" class="manifest-tabs">
      <el-tab-pane v-for="t in tabList" :key="t.id" :name="t.id" :label="t.label">
        <BasicInfoSection v-if="t.id === 'basic'" :form="form" mode="edit" :categories="categoryOptions" />

        <div v-else-if="t.id === 'menus'" class="menus-pane">
          <MenusSection :menus="form.menus" />
        </div>

        <el-form v-else-if="t.id === 'plugin'" label-width="130px" size="small">
          <el-form-item label="source">
            <el-select v-model="form.plugin.source" style="width: 220px">
              <el-option label="builtin（随应用分发）" value="builtin" />
              <el-option label="external（外部包）" value="external" />
            </el-select>
          </el-form-item>
          <el-form-item label="main 入口"><el-input v-model="form.plugin.main" placeholder="内建 src/main/index.ts / 外部 dist/main.js" /></el-form-item>
          <el-form-item label="renderer 入口"><el-input v-model="form.plugin.renderer" placeholder="内建 .vue / 外部 dist/page.js" /></el-form-item>
          <el-form-item label="工具自有通道">
            <div v-for="(_channel, ci) in channelRows" :key="ci" class="inline-form">
              <el-input v-model="channelRows[ci]" size="small" placeholder="如 toolId:list" style="width: 260px" />
              <el-button size="small" type="danger" plain @click="channelRows.splice(ci, 1)">删除</el-button>
            </div>
            <el-button size="small" type="primary" plain @click="channelRows.push('')">新增通道</el-button>
          </el-form-item>
          <div class="hint">工具自有通道（plugin.channels）与宿主通道白名单（package.ipcAllowlist）是两回事，勿混填。</div>
        </el-form>

        <div v-else-if="t.id === 'contract'" class="contract-pane">
          <el-form label-width="130px" size="small">
            <el-form-item label="schemaVersion"><el-input :model-value="String(TOOL_PACKAGE_SCHEMA_VERSION)" disabled /></el-form-item>
            <el-form-item label="requiresHost.api"><el-input :model-value="`^${HOST_API_VERSION.split('.')[0]}.0`" disabled /></el-form-item>
            <el-form-item label="版本号"><el-input v-model="form.pkg.version" /></el-form-item>
            <el-form-item label="沙箱">
              <el-select v-model="form.pkg.sandbox" style="width: 220px">
                <el-option label="utility（默认）" value="utility" />
                <el-option label="main（需有效签名）" value="main" />
              </el-select>
            </el-form-item>
          </el-form>
          <CapabilitiesSection
            v-model:capabilities="form.pkg.capabilities"
            v-model:allowlist="form.pkg.ipcAllowlist"
            v-model:grant="form.requiredGrant"
          />
        </div>

        <!-- N16：配置与依赖全表单化，分组/字段行编辑走共享 ConfigGroupsSection -->
        <div v-else-if="t.id === 'advanced'" class="advanced-pane">
          <div class="hint" style="margin-bottom: 8px">
            路径类字段请用 dir / file 类型（选择 + 可改，禁止裸 string 手填）。填写结果可在「JSON 预览」页查看。
          </div>

          <ConfigGroupsSection :groups="groupRows" />

          <div class="section-title">硬依赖（dependsOn）</div>
          <el-form label-width="96px" size="small" style="margin-bottom: 10px">
            <el-form-item label="硬依赖">
              <el-select v-model="form.dependsOn" multiple filterable clearable collapse-tags style="width: 100%" placeholder="默认零依赖">
                <el-option v-for="id in toolIdOptions" :key="id" :label="id" :value="id" />
              </el-select>
              <div class="hint">依赖工具不可用时本工具一并隐藏</div>
            </el-form-item>
          </el-form>

          <div class="section-title">软依赖（configDeps，只读展示 + 预警）</div>
          <div v-for="(dep, di) in depRows" :key="di" class="inline-form">
            <el-select v-model="dep.toolId" size="small" filterable placeholder="依赖工具" style="width: 180px">
              <el-option v-for="id in toolIdOptions" :key="id" :label="id" :value="id" />
            </el-select>
            <el-input v-model="dep.key" size="small" placeholder="配置 key" style="width: 180px" />
            <el-input v-model="dep.label" size="small" placeholder="展示名称" style="width: 180px" />
            <el-button size="small" type="danger" plain @click="depRows.splice(di, 1)">删除</el-button>
          </div>
          <el-button size="small" type="primary" plain @click="addDep">新增依赖</el-button>

          <div class="section-title">默认值（defaults，按分组字段自动派生）</div>
          <div class="hint" style="margin-bottom: 8px">新增 / 删除字段后点「重扫默认值」同步行；不在字段中的额外键保存时原样保留。</div>
          <el-button size="small" plain @click="rescanDefaults">重扫默认值</el-button>
          <div v-for="row in defaultRows" :key="row.key" class="inline-form">
            <el-input :model-value="row.key" size="small" disabled style="width: 200px" />
            <el-switch v-if="row.type === 'boolean'" v-model="row.value" />
            <el-input-number v-else-if="row.type === 'number'" v-model="row.value" size="small" style="width: 150px" />
            <el-select v-else-if="row.type === 'select'" v-model="row.value" size="small" style="width: 180px">
              <el-option
                v-for="opt in parseOptions(groupRows.flatMap((g) => g.fields).find((f) => f.key === row.key)?.optionsText ?? '')"
                :key="opt.value" :label="opt.label" :value="opt.value"
              />
            </el-select>
            <el-input v-else v-model="row.value" size="small" style="width: 240px" />
            <span class="hint">{{ row.label }}</span>
          </div>
        </div>

        <JsonPreviewPane
          v-else-if="t.id === 'preview'"
          class="preview-pane"
          :text="preview.text"
          :error="preview.error"
          hint="以下为「保存并校验」将写回 tool.manifest.json 的最终内容（只读）。"
        />
      </el-tab-pane>
    </el-tabs>

      <div class="manifest-actionbar">
        <div class="dev-actions">
          <el-button type="primary" size="small" :loading="busy" @click="saveAndVerify">保存并校验</el-button>
          <el-button type="warning" size="small" :loading="busy" @click="buildExternalAction">构建外部产物</el-button>
          <el-button type="info" size="small" :loading="busy" @click="buildBuiltinAction">打包应用（内建）</el-button>
          <el-button type="success" size="small" :loading="busy" @click="packAction">导出 .sshktool</el-button>
          <el-checkbox v-model="signBeforePack" size="small">导出前签名</el-checkbox>
          <el-button size="small" type="info" plain class="action-close" @click="close">关闭</el-button>
        </div>
        <pre v-if="output" class="dev-output">{{ output }}</pre>
      </div>
    </div>
  </el-dialog>
</template>

<style scoped>
.hint { color: var(--el-text-color-secondary); font-size: 12px; line-height: 1.5; }
.inline-form { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-bottom: 8px; }

/* 固定高度壳：头部 tab + 底部操作条固定，仅内容区滚动，切换 tab 不抖动。
   高度按视口百分比（66vh 上限 640px），叠加弹框头/底后总高 < 86vh 全局上限，不触发外层滚动 */
.manifest-shell { display: flex; flex-direction: column; height: min(66vh, 640px); }
.manifest-tabs { flex: 1; min-height: 0; display: flex; flex-direction: column; }
.manifest-tabs :deep(.el-tabs__header) { flex: none; margin-bottom: 0; padding: 4px 6px 0; background: var(--el-fill-color-light); border-radius: 8px 8px 0 0; }
.manifest-tabs :deep(.el-tabs__item) { height: 34px; font-size: 13px; transition: color 0.15s, background-color 0.15s; }
.manifest-tabs :deep(.el-tabs__item.is-active) { font-weight: 600; }
.manifest-tabs :deep(.el-tabs__content) { flex: 1; min-height: 0; overflow-y: auto; padding: 14px 6px 4px; }

.menus-pane { max-width: 640px; }
.contract-pane { max-width: 680px; }

/* 底部操作条：与内容区隔离固定，按钮水平居中（全局弹框规范），输出区独立滚动 */
.manifest-actionbar { flex: none; margin-top: 8px; padding-top: 10px; border-top: 1px solid var(--el-border-color-lighter); }
.dev-actions { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; justify-content: center; }
.dev-output { max-height: 140px; overflow: auto; background: var(--el-fill-color-light); padding: 10px; border-radius: 6px; font-size: 12px; white-space: pre-wrap; margin-top: 8px; }

/* N16：配置与依赖表单化 */
.advanced-pane { max-width: 880px; }
.section-title { font-size: 13px; font-weight: 600; margin: 14px 0 8px; }
.preview-pane { height: 100%; }
</style>
