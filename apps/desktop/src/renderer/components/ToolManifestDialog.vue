<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { HOST_API_VERSION, IPC_CHANNELS, TOOL_PACKAGE_SCHEMA_VERSION } from '@sshk/shared'

/**
 * 开发者模式：工具清单（tool.manifest.json）可视化编辑 + 构建/打包动作。
 * 表单覆盖基础 / 菜单 / 插件 / 契约 / 高级五组；保存后写回源码文件并可立即跑 verify。
 * 仅在 app.developerMode 且主进程确认源码仓库可用时由设置抽屉打开。
 */
const props = defineProps<{ modelValue: boolean; toolId: string }>()
const emit = defineEmits<{ 'update:modelValue': [boolean] }>()

const CAPABILITIES = [
  'getToolSecret', 'setToolSecret', 'chat', 'listProviders',
  'chatByProvider', 'listModelsByProvider', 'runLocalOcr',
]
const HOST_CHANNELS = Object.values(IPC_CHANNELS) as string[]
const VISIBILITY_OPTIONS = ['managed', 'desktop', 'hidden', 'implicit']

interface MenuRow { id: string; label: string }
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
  menus: MenuRow[]
  plugin: { source: string; main: string; renderer: string; channels: string }
  pkg: {
    version: string
    capabilities: string[]
    sandbox: string
    ipcAllowlist: string[]
  }
  dependsOn: string
  requiredGrant: string
}

function emptyForm(): ManifestForm {
  return {
    id: '', name: '', description: '', category: '', tags: '', icon: 'auto',
    entryRoute: 'home', enabled: true, visibility: 'managed', configLayout: 'single',
    menus: [], plugin: { source: 'builtin', main: '', renderer: '', channels: '' },
    pkg: { version: '1.0.0', capabilities: [], sandbox: 'utility', ipcAllowlist: [] },
    dependsOn: '', requiredGrant: '',
  }
}

const form = reactive<ManifestForm>(emptyForm())
const original = ref<Record<string, unknown>>({})
const advanced = reactive({ configGroups: '[]', configDeps: '[]', defaults: '{}' })
const output = ref('')
const busy = ref(false)
const tab = ref('basic')
const signBeforePack = ref(true)

const tabList = [
  { id: 'basic', label: '基础' },
  { id: 'menus', label: '菜单' },
  { id: 'plugin', label: '插件' },
  { id: 'contract', label: '契约' },
  { id: 'advanced', label: '高级配置' },
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
        channels: asArray(plugin.channels).join(', '),
      },
      pkg: {
        version: asString(pkg.version, '1.0.0'),
        capabilities: asArray(rh.capabilities),
        sandbox: asString(pkg.sandbox, 'utility'),
        ipcAllowlist: asArray(pkg.ipcAllowlist),
      },
      dependsOn: asArray(obj.dependsOn).join(', '),
      requiredGrant: asString(obj.requiredGrant),
    } satisfies ManifestForm)
    advanced.configGroups = JSON.stringify(obj.configGroups ?? [], null, 2)
    advanced.configDeps = JSON.stringify(obj.configDeps ?? [], null, 2)
    advanced.defaults = JSON.stringify(obj.defaults ?? {}, null, 2)
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
  return value.split(/[,，、\s]+/).map((s) => s.trim()).filter(Boolean)
}
function parseJsonField(label: string, text: string): unknown {
  try { return JSON.parse(text) as unknown } catch (err) {
    throw new Error(`「${label}」不是合法 JSON：${(err as Error).message}`)
  }
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
      channels: splitList(form.plugin.channels),
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
    dependsOn: splitList(form.dependsOn),
    configDeps: parseJsonField('configDeps', advanced.configDeps),
    configGroups: parseJsonField('configGroups', advanced.configGroups),
    defaults: parseJsonField('defaults', advanced.defaults),
    requiredGrant: form.requiredGrant,
  }
  return JSON.stringify(next, null, 2) + '\n'
}

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
    width="min(900px, 92vw)"
    :close-on-click-modal="false"
    :close-on-press-escape="false"
    @update:model-value="emit('update:modelValue', Boolean($event))"
  >
    <el-tabs v-model="tab" type="card">
      <el-tab-pane v-for="t in tabList" :key="t.id" :name="t.id" :label="t.label">
        <el-form v-if="t.id === 'basic'" label-width="110px" size="small">
          <el-form-item label="id"><el-input :model-value="form.id" disabled /><div class="hint">唯一真相源，必须与目录名一致，不可改</div></el-form-item>
          <el-form-item label="名称"><el-input v-model="form.name" /></el-form-item>
          <el-form-item label="描述"><el-input v-model="form.description" type="textarea" :rows="2" /></el-form-item>
          <el-form-item label="分类"><el-input v-model="form.category" placeholder="多个用顿号分隔" /></el-form-item>
          <el-form-item label="标签"><el-input v-model="form.tags" placeholder="逗号分隔" /></el-form-item>
          <el-form-item label="图标"><el-input v-model="form.icon" placeholder="auto = assets/icon.svg" /></el-form-item>
          <el-form-item label="入口菜单"><el-input v-model="form.entryRoute" /></el-form-item>
          <el-form-item label="启用"><el-switch v-model="form.enabled" /></el-form-item>
          <el-form-item label="可见性">
            <el-select v-model="form.visibility" style="width: 200px">
              <el-option v-for="v in VISIBILITY_OPTIONS" :key="v" :label="v" :value="v" />
            </el-select>
          </el-form-item>
          <el-form-item label="配置布局">
            <el-select v-model="form.configLayout" style="width: 200px">
              <el-option label="single（单页）" value="single" />
              <el-option label="tabs（分页）" value="tabs" />
              <el-option label="menu（子菜单）" value="menu" />
            </el-select>
          </el-form-item>
        </el-form>

        <div v-else-if="t.id === 'menus'">
          <div v-for="(row, i) in form.menus" :key="i" class="inline-form">
            <el-input v-model="row.id" size="small" placeholder="菜单 id" style="width: 200px" />
            <el-input v-model="row.label" size="small" placeholder="显示名称" style="width: 240px" />
            <el-button size="small" type="danger" plain @click="form.menus.splice(i, 1)">删除</el-button>
          </div>
          <el-button size="small" type="primary" plain @click="form.menus.push({ id: '', label: '' })">新增菜单</el-button>
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
          <el-form-item label="工具自有通道"><el-input v-model="form.plugin.channels" placeholder="逗号分隔，如 toolId:list、toolId:save" /></el-form-item>
          <div class="hint">工具自有通道（plugin.channels）与宿主通道白名单（package.ipcAllowlist）是两回事，勿混填。</div>
        </el-form>

        <el-form v-else-if="t.id === 'contract'" label-width="130px" size="small">
          <el-form-item label="schemaVersion"><el-input :model-value="String(TOOL_PACKAGE_SCHEMA_VERSION)" disabled /></el-form-item>
          <el-form-item label="requiresHost.api"><el-input :model-value="`^${HOST_API_VERSION.split('.')[0]}.0`" disabled /></el-form-item>
          <el-form-item label="版本号"><el-input v-model="form.pkg.version" /></el-form-item>
          <el-form-item label="宿主能力">
            <el-checkbox-group v-model="form.pkg.capabilities">
              <el-checkbox v-for="c in CAPABILITIES" :key="c" :value="c" :label="c" />
            </el-checkbox-group>
          </el-form-item>
          <el-form-item label="沙箱">
            <el-select v-model="form.pkg.sandbox" style="width: 220px">
              <el-option label="utility（默认）" value="utility" />
              <el-option label="main（需有效签名）" value="main" />
            </el-select>
          </el-form-item>
          <el-form-item label="宿主通道白名单">
            <el-select v-model="form.pkg.ipcAllowlist" multiple filterable collapse-tags clearable style="width: 100%">
              <el-option v-for="c in HOST_CHANNELS" :key="c" :label="c" :value="c" />
            </el-select>
            <div class="hint">可选集 = IPC_CHANNELS 全表；签名由 sign-tool 写入，不在表单维护</div>
          </el-form-item>
        </el-form>

        <div v-else>
          <div class="hint" style="margin-bottom: 8px">以下三项为 JSON 原文编辑，保存时校验语法；路径类字段请用 dir / file 类型（选择+可改，禁止裸 string 手填）。</div>
          <el-form label-width="110px" size="small">
            <el-form-item label="configGroups"><el-input v-model="advanced.configGroups" type="textarea" :rows="6" /></el-form-item>
            <el-form-item label="configDeps"><el-input v-model="advanced.configDeps" type="textarea" :rows="4" /></el-form-item>
            <el-form-item label="defaults"><el-input v-model="advanced.defaults" type="textarea" :rows="4" /></el-form-item>
            <el-form-item label="dependsOn"><el-input v-model="form.dependsOn" placeholder="逗号分隔，默认零依赖" /></el-form-item>
            <el-form-item label="requiredGrant"><el-input v-model="form.requiredGrant" /></el-form-item>
          </el-form>
        </div>
      </el-tab-pane>
    </el-tabs>

    <div class="dev-actions">
      <el-button type="primary" size="small" :loading="busy" @click="saveAndVerify">保存并校验</el-button>
      <el-button type="warning" size="small" :loading="busy" @click="buildExternalAction">构建外部产物</el-button>
      <el-button type="info" size="small" :loading="busy" @click="buildBuiltinAction">打包应用（内建）</el-button>
      <el-button type="success" size="small" :loading="busy" @click="packAction">
        导出 .sshktool
      </el-button>
      <el-checkbox v-model="signBeforePack" size="small">导出前签名</el-checkbox>
    </div>
    <pre v-if="output" class="dev-output">{{ output }}</pre>

    <template #footer>
      <el-button size="small" type="info" plain @click="close">关闭</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.hint { color: var(--el-text-color-secondary); font-size: 12px; line-height: 1.5; }
.inline-form { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-bottom: 8px; }
.dev-actions { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin: 12px 0; }
.dev-output { max-height: 220px; overflow: auto; background: var(--el-fill-color-light); padding: 10px; border-radius: 4px; font-size: 12px; white-space: pre-wrap; }
</style>
