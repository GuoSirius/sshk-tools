<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { Delete, Plus } from '@element-plus/icons-vue'
import { buildSkeletonFiles, CREATE_CAPABILITIES, pascalCase } from '@sshk/shared'
import type { ToolConfigFieldType } from '@sshk/shared'
import { ACCESS_GRANT, IPC_CHANNELS } from '@sshk/shared'
import { useToolCatalog } from '../composables/useToolCatalog'

/**
 * N16 创建工具向导（仅 dev 可见，见 App.vue / AppSettingsDrawer 入口条件）：
 * 分步表单 → 提交主进程 dev:toolCreate 生成 tools/<id>/ 整套骨架。
 * 右侧实时 JSON 预览与主进程落盘共用 @sshk/shared 的 buildSkeletonFiles——所见即所得，无第二套逻辑。
 */
const props = defineProps<{ modelValue: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [boolean]; created: [unknown] }>()

const ID_RE = /^[a-z][a-z0-9-]{1,63}$/
const MENU_ID_RE = /^[a-z][a-z0-9-]{0,31}$/
const FIELD_TYPES: { label: string; value: ToolConfigFieldType }[] = [
  { label: '文本 string', value: 'string' },
  { label: '数字 number', value: 'number' },
  { label: '开关 boolean', value: 'boolean' },
  { label: '下拉 select', value: 'select' },
  { label: '目录 dir', value: 'dir' },
  { label: '文件 file', value: 'file' },
]
const VISIBILITIES = [
  { label: 'managed（受控：进权限列表，用户开启后上桌面）', value: 'managed' },
  { label: 'desktop（默认上桌面）', value: 'desktop' },
  { label: 'hidden（隐藏：不上桌面不进列表）', value: 'hidden' },
  { label: 'implicit（隐式基座：仅被其它工具依赖）', value: 'implicit' },
]
const HOST_CHANNELS = Object.values(IPC_CHANNELS) as string[]

interface MenuRow { id: string; label: string }
interface FieldRow { key: string; label: string; type: ToolConfigFieldType; hint: string; min: number | null; optionsText: string }
interface GroupRow { id: string; label: string; fields: FieldRow[] }
interface PageRow { id: string; label: string; groups: string[] }

const step = ref(0)
const creating = ref(false)
const createdOutput = ref('')
const { payload } = useToolCatalog()

const form = reactive({
  id: '',
  name: '',
  description: '',
  category: '',
  tags: '',
  visibility: 'managed',
  menus: [{ id: 'home', label: '首页' }] as MenuRow[],
  capabilities: [] as string[],
  ipcAllowlist: ['config:get', 'config:set'] as string[],
  requiredGrant: '',
  configLayout: 'single' as 'single' | 'menu',
  configGroups: [] as GroupRow[],
  configPages: [] as PageRow[],
})

watch(() => props.modelValue, (open) => { if (open) resetForm() })
function resetForm(): void {
  step.value = 0
  createdOutput.value = ''
  form.id = ''
  form.name = ''
  form.description = ''
  form.category = ''
  form.tags = ''
  form.visibility = 'managed'
  form.menus = [{ id: 'home', label: '首页' }]
  form.capabilities = []
  form.ipcAllowlist = ['config:get', 'config:set']
  form.requiredGrant = ''
  form.configLayout = 'single'
  form.configGroups = []
  form.configPages = []
}

const categoryOptions = computed(() => {
  const set = new Set<string>()
  for (const tool of payload.value.tools) for (const c of tool.categories) set.add(c)
  return [...set]
})
/** 分类：下拉给历史建议 + 自由手输（下拉里没有也能直接输入，输入内容不丢） */
function queryCategories(query: string, cb: (items: { value: string }[]) => void): void {
  const q = query.trim().toLowerCase()
  cb(categoryOptions.value.filter((c) => !q || c.toLowerCase().includes(q)).map((value) => ({ value })))
}
const groupOptions = computed(() => form.configGroups.map((group) => ({ label: `${group.label}（${group.id}）`, value: group.id })))

function addMenu(): void { form.menus.push({ id: '', label: '' }) }
function addGroup(): void {
  form.configGroups.push({ id: `config-${form.configGroups.length + 1}`, label: '', fields: [emptyField()] })
}
function emptyField(): FieldRow {
  return { key: '', label: '', type: 'string', hint: '', min: null, optionsText: '' }
}
function addField(group: GroupRow): void { group.fields.push(emptyField()) }
function addPage(): void { form.configPages.push({ id: `config-page-${form.configPages.length + 1}`, label: '', groups: [] }) }
function parseOptions(text: string): { label: string; value: string }[] {
  return text.split(/[,，]+/).map((seg) => seg.trim()).filter(Boolean).map((seg) => {
    const [label, value] = seg.split(/[:：]/).map((s) => s.trim())
    return { label: label ?? seg, value: value ?? label ?? seg }
  })
}

/** 步骤 1/2 的即时校验提示（完整契约校验在主进程 assertCreateRequest） */
const stepErrors = computed<string[]>(() => {
  const errors: string[] = []
  if (step.value === 0) {
    if (form.id && !ID_RE.test(form.id)) errors.push('工具 id：小写字母开头，仅小写字母 / 数字 / 连字符（2-64 位）')
    if (payload.value.tools.some((tool) => tool.id === form.id)) errors.push(`工具 id 已存在：${form.id}`)
  }
  if (step.value === 1) {
    const ids = form.menus.map((menu) => menu.id.trim()).filter(Boolean)
    if (ids.some((id) => !MENU_ID_RE.test(id))) errors.push('菜单 id：小写字母 / 数字 / 连字符')
    if (new Set(ids).size !== ids.length) errors.push('菜单 id 重复')
    if (ids.some((id) => !id)) errors.push('有菜单未填写 id')
  }
  return errors
})

const nextDisabled = computed(() => {
  if (step.value === 0) return !ID_RE.test(form.id) || !form.name.trim() || !form.description.trim()
  if (step.value === 1) return stepErrors.value.length > 0
  return false
})

/** 预览请求与主进程一致：同一份 shared 生成器，落盘内容 = 预览内容 */
const preview = computed<{ manifest: string; error: string }>(() => {
  try {
    const files = buildSkeletonFiles(toRequest())
    const manifest = files.find((file) => file.path.endsWith('tool.manifest.json'))
    return { manifest: manifest?.content ?? '', error: '' }
  } catch (err) {
    return { manifest: '', error: (err as Error).message }
  }
})

function toRequest(): Parameters<typeof buildSkeletonFiles>[0] {
  return {
    id: form.id.trim(),
    name: form.name.trim(),
    description: form.description.trim(),
    category: form.category.trim() || '开发',
    tags: form.tags.split(/[,，、]+/).map((s) => s.trim()).filter(Boolean),
    visibility: form.visibility,
    menus: form.menus.map((menu) => ({ id: menu.id.trim(), label: menu.label.trim() })),
    capabilities: [...form.capabilities],
    ipcAllowlist: [...form.ipcAllowlist],
    configLayout: form.configLayout,
    configGroups: form.configGroups.map((group) => ({
      id: group.id.trim(),
      label: group.label.trim(),
      fields: group.fields.map((field) => ({
        key: field.key.trim(),
        label: field.label.trim(),
        type: field.type,
        ...(field.hint.trim() ? { hint: field.hint.trim() } : {}),
        ...(field.min !== null ? { min: field.min } : {}),
        ...(field.type === 'select' ? { options: parseOptions(field.optionsText) } : {}),
      })),
    })),
    configPages: form.configLayout === 'menu'
      ? form.configPages.map((page) => ({ id: page.id.trim(), label: page.label.trim() || page.id.trim(), groups: [...page.groups] }))
      : undefined,
  }
}

async function create(): Promise<void> {
  if (preview.value.error) { ElMessage.error(preview.value.error); return }
  creating.value = true
  try {
    const res = await window.api.dev.create(toRequest() as unknown as Record<string, unknown>)
    if (!res.ok) { ElMessage.error(res.output); return }
    createdOutput.value = res.output
    if (res.catalog) emit('created', res.catalog)
    ElMessage.success('工具骨架已创建，重启 pnpm dev 后生效')
  } catch (err) {
    ElMessage.error((err as Error).message)
  } finally {
    creating.value = false
  }
}
function close(): void { emit('update:modelValue', false) }
function menuFile(id: string): string { return `pages/${pascalCase(id || 'page')}Page.vue` }
</script>

<template>
  <el-dialog
    :model-value="modelValue"
    title="创建工具（开发者向导）"
    width="min(1120px, 94vw)"
    top="4vh"
    destroy-on-close
    close-on-click-modal="false"
    close-on-press-escape="false"
    @update:model-value="emit('update:modelValue', Boolean($event))"
  >
    <div v-if="!createdOutput" class="wizard">
      <!-- 顶部步骤条：固定，不随中间表单滚动 -->
      <el-steps :active="step" align-center finish-status="success" class="steps wizard-head">
        <el-step title="基本信息" />
        <el-step title="菜单与页面" />
        <el-step title="能力与权限" />
        <el-step title="配置项（可选）" />
      </el-steps>

      <!-- 中间主体：左表单 / 右 JSON 各自独立滚动，互不影响 -->
      <div class="wizard-body">
      <div class="wizard-left">
        <!-- Step 1 基本信息 -->
        <el-form v-show="step === 0" label-width="92px" size="small" class="pane">
          <el-form-item label="工具 id" required>
            <el-input v-model="form.id" placeholder="如 my-tool；= 目录名，创建后不可改" />
          </el-form-item>
          <el-form-item label="名称" required><el-input v-model="form.name" placeholder="桌面上显示的工具名" /></el-form-item>
          <el-form-item label="描述" required><el-input v-model="form.description" type="textarea" :rows="2" /></el-form-item>
          <el-form-item label="分类">
            <el-autocomplete
              v-model="form.category"
              :fetch-suggestions="queryCategories"
              style="width: 100%"
              clearable
              placeholder="选择历史分类，或直接输入新分类"
            />
          </el-form-item>
          <el-form-item label="标签"><el-input v-model="form.tags" placeholder="逗号分隔，如：示例, OCR 识别" /></el-form-item>
          <el-form-item label="可见性">
            <el-select v-model="form.visibility" style="width: 100%">
              <el-option v-for="v in VISIBILITIES" :key="v.value" :label="v.label" :value="v.value" />
            </el-select>
          </el-form-item>
          <el-alert type="info" :closable="false" title="图标暂用默认占位（icon=auto），创建后可直接替换 assets/icon.svg" />
        </el-form>

        <!-- Step 2 菜单与页面 -->
        <div v-show="step === 1" class="pane">
          <div v-for="(menu, i) in form.menus" :key="i" class="row-item">
            <el-input v-model="menu.id" size="small" placeholder="菜单 id（home）" style="width: 150px" />
            <el-input v-model="menu.label" size="small" placeholder="显示名称（首页）" style="width: 170px" />
            <code class="file-chip">{{ menuFile(menu.id) }}</code>
            <el-button size="small" type="danger" plain :icon="Delete" :disabled="form.menus.length <= 1" @click="form.menus.splice(i, 1)" />
          </div>
          <el-button size="small" type="primary" plain :icon="Plus" @click="addMenu">新增页面</el-button>
          <div class="hint">每行一个左侧菜单 = 一个页面文件；首个菜单会生成<b>最小可跑示例</b>（调主进程 + 读写配置），其余为占位页。</div>
        </div>

        <!-- Step 3 能力与权限 -->
        <el-form v-show="step === 2" label-width="110px" size="small" class="pane">
          <el-form-item label="宿主能力">
            <el-checkbox-group v-model="form.capabilities">
              <el-checkbox v-for="c in CREATE_CAPABILITIES" :key="c" :value="c" :label="c" />
            </el-checkbox-group>
            <div class="hint">按需勾选；用不到就不选，权限最小化。模板见 tools/template-tool。</div>
          </el-form-item>
          <el-form-item label="宿主通道">
            <el-select v-model="form.ipcAllowlist" multiple filterable collapse-tags clearable style="width: 100%">
              <el-option v-for="c in HOST_CHANNELS" :key="c" :label="c" :value="c" />
            </el-select>
            <div class="hint">默认放行 config:get / config:set（示例页读写配置要用）。</div>
          </el-form-item>
          <el-form-item label="访问门槛">
            <el-select v-model="form.requiredGrant" style="width: 100%">
              <el-option label="公开（默认）" value="" />
              <el-option label="需访问密钥" :value="ACCESS_GRANT" />
            </el-select>
          </el-form-item>
        </el-form>

        <!-- Step 4 配置项 -->
        <div v-show="step === 3" class="pane">
          <el-form label-width="92px" size="small">
            <el-form-item label="配置形态">
              <el-radio-group v-model="form.configLayout">
                <el-radio value="single">形态 1：单菜单 + 左右布局</el-radio>
                <el-radio value="menu">形态 2：二级菜单分页</el-radio>
              </el-radio-group>
            </el-form-item>
          </el-form>
          <div v-for="(group, gi) in form.configGroups" :key="gi" class="group-card">
            <div class="row-item">
              <el-input v-model="group.id" size="small" placeholder="分组 id" style="width: 160px" />
              <el-input v-model="group.label" size="small" placeholder="分组名称" style="width: 170px" />
              <el-button size="small" type="danger" plain :icon="Delete" @click="form.configGroups.splice(gi, 1)" />
            </div>
            <div v-for="(field, fi) in group.fields" :key="fi" class="row-item field-row">
              <el-input v-model="field.key" size="small" placeholder="key（a.b.c）" style="width: 150px" />
              <el-input v-model="field.label" size="small" placeholder="名称" style="width: 120px" />
              <el-select v-model="field.type" size="small" style="width: 120px">
                <el-option v-for="t in FIELD_TYPES" :key="t.value" :label="t.label" :value="t.value" />
              </el-select>
              <el-input v-if="field.type === 'select'" v-model="field.optionsText" size="small" placeholder="选项 标签:值, 标签:值" style="width: 170px" />
              <el-input v-else-if="field.type === 'number'" v-model.number="field.min" size="small" placeholder="最小值" style="width: 110px" />
              <el-input v-model="field.hint" size="small" placeholder="提示语" style="flex: 1; min-width: 120px" />
              <el-button size="small" type="danger" plain :icon="Delete" @click="group.fields.splice(fi, 1)" />
            </div>
            <el-button size="small" plain :icon="Plus" @click="addField(group)">加字段</el-button>
          </div>
          <el-button size="small" type="primary" plain :icon="Plus" @click="addGroup">新增配置分组</el-button>

          <template v-if="form.configLayout === 'menu'">
            <div class="hint" style="margin-top: 10px">形态 2：配置页（二级菜单），每页引用多个分组；id 以 config- 开头。</div>
            <div v-for="(page, pi) in form.configPages" :key="pi" class="row-item">
              <el-input v-model="page.id" size="small" placeholder="config-model" style="width: 160px" />
              <el-input v-model="page.label" size="small" placeholder="页名称" style="width: 140px" />
              <el-select v-model="page.groups" multiple collapse-tags size="small" placeholder="引用分组" style="flex: 1">
                <el-option v-for="g in groupOptions" :key="g.value" :label="g.label" :value="g.value" />
              </el-select>
              <el-button size="small" type="danger" plain :icon="Delete" @click="form.configPages.splice(pi, 1)" />
            </div>
            <el-button size="small" type="primary" plain :icon="Plus" @click="addPage">新增配置页</el-button>
          </template>
          <div class="hint">不配分组也可以：跳过创建后再在「配置」编辑器里补。</div>
        </div>

        <div v-if="stepErrors.length" class="error-box">
          <div v-for="e in stepErrors" :key="e">⚠ {{ e }}</div>
        </div>
      </div><!-- /wizard-left -->

      <!-- 右栏：实时预览（与落盘共用同一份生成器），独立滚动 -->
      <div class="wizard-right">
        <div class="preview-title">tool.manifest.json 实时预览</div>
        <div v-if="preview.error" class="error-box">{{ preview.error }}</div>
        <pre v-else class="preview-json">{{ preview.manifest }}</pre>
      </div>
      </div><!-- /wizard-body -->

      <!-- 底部操作栏：固定，按钮靠右 -->
      <div class="wizard-actions wizard-foot">
        <el-button size="small" @click="close">取消</el-button>
        <el-button size="small" :disabled="step === 0" @click="step--">上一步</el-button>
        <el-button v-if="step < 3" size="small" type="primary" :disabled="nextDisabled" @click="step++">下一步</el-button>
        <el-button v-else size="small" type="success" :loading="creating" :disabled="Boolean(preview.error)" @click="create">
          确认创建
        </el-button>
      </div>
    </div>

    <div v-else class="created">
      <el-result icon="success" title="工具骨架已创建" sub-title="重启 pnpm dev 后新工具即可加载；随后可在「设置 → 工具与权限 → 配置」继续完善 manifest。">
        <template #extra>
          <pre class="preview-json created-list">{{ createdOutput }}</pre>
          <el-button type="primary" size="small" @click="close">完成</el-button>
        </template>
      </el-result>
    </div>
  </el-dialog>
</template>

<style scoped>
/* 整体固定高度：顶部步骤 + 底部按钮不随滚动，只有中间左右两栏各自滚动 */
.wizard { display: flex; flex-direction: column; height: min(74vh, 700px); }
.wizard-head { flex: none; padding: 4px 0 14px; }
.wizard-body { flex: 1; min-height: 0; display: flex; gap: 14px; }
.wizard-left { flex: 1.2; min-width: 0; min-height: 0; overflow-y: auto; padding-right: 6px; }
.wizard-right { flex: 1; min-width: 0; min-height: 0; display: flex; flex-direction: column; }
.pane { min-height: 0; }
.row-item { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.field-row { flex-wrap: wrap; }
.group-card { border: 1px dashed var(--sshk-border, #d0d0d0); border-radius: 8px; padding: 10px; margin-bottom: 10px; }
.file-chip { font-size: 11px; opacity: .65; white-space: nowrap; }
.hint { font-size: 12px; opacity: .6; line-height: 1.7; margin-top: 6px; }
.error-box { margin-top: 8px; padding: 8px 10px; border-radius: 6px; background: rgba(245, 108, 108, .08); color: #c45656; font-size: 12px; line-height: 1.8; }
.wizard-foot { flex: none; margin-top: 0; padding-top: 12px; border-top: 1px solid var(--sshk-border, #d0d0d0); }
.wizard-actions { display: flex; gap: 8px; justify-content: flex-end; }
.preview-title { flex: none; font-size: 12px; font-weight: 600; opacity: .65; margin-bottom: 6px; }
.preview-json { flex: 1; min-height: 0; overflow: auto; margin: 0; padding: 10px; border-radius: 8px; background: var(--sshk-panel-soft, rgba(128, 128, 128, .08)); font-size: 11px; line-height: 1.6; white-space: pre; }
.created-list { max-height: 260px; width: 100%; text-align: left; }
</style>
