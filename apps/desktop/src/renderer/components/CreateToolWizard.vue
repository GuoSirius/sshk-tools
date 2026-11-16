<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { buildSkeletonFiles, pascalCase } from '@sshk/shared'
import { useToolCatalog } from '../composables/useToolCatalog'
import BasicInfoSection from './tool-form/BasicInfoSection.vue'
import MenusSection from './tool-form/MenusSection.vue'
import CapabilitiesSection from './tool-form/CapabilitiesSection.vue'
import ConfigGroupsSection from './tool-form/ConfigGroupsSection.vue'
import JsonPreviewPane from './tool-form/JsonPreviewPane.vue'
import { parseOptions } from './tool-form/types'

/**
 * N16 创建工具向导（仅 dev 可见，见 App.vue / AppSettingsDrawer 入口条件）：
 * 分步表单（tool-form/ 共享组件，与清单编辑器同源）→ 提交主进程 dev:toolCreate 生成 tools/<id>/ 整套骨架。
 * 右侧实时 JSON 预览与主进程落盘共用 @sshk/shared 的 buildSkeletonFiles——所见即所得，无第二套逻辑。
 */
const props = defineProps<{ modelValue: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [boolean]; created: [unknown] }>()

const ID_RE = /^[a-z][a-z0-9-]{1,63}$/
const MENU_ID_RE = /^[a-z][a-z0-9-]{0,31}$/

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
  menus: [{ id: 'home', label: '首页' }] as { id: string; label: string }[],
  capabilities: [] as string[],
  ipcAllowlist: ['config:get', 'config:set'] as string[],
  requiredGrant: '',
  configLayout: 'single' as string,
  configGroups: [] as import('./tool-form/types').GroupRow[],
  configPages: [] as import('./tool-form/types').PageRow[],
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

function menuFile(id: string): string { return `pages/${pascalCase(id || 'page')}Page.vue` }

const categoryOptions = computed(() => {
  const set = new Set<string>()
  for (const tool of payload.value.tools) for (const c of tool.categories) set.add(c)
  return [...set]
})

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

/** step0 错误直接内联到基本信息 id 行（BasicInfoSection idError），底部不再重复展示 */
const idError = computed(() => (step.value === 0 ? stepErrors.value.join('；') : ''))
const menuErrors = computed(() => (step.value === 1 ? stepErrors.value : []))

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
    configLayout: form.configLayout as 'single' | 'menu',
    configGroups: form.configGroups.map((group) => ({
      id: group.id.trim(),
      label: group.label.trim(),
      fields: group.fields.map((field) => ({
        key: field.key.trim(),
        label: field.label.trim(),
        type: field.type,
        ...(field.hint.trim() ? { hint: field.hint.trim() } : {}),
        ...(field.min !== null ? { min: field.min } : {}),
        ...(field.max !== null ? { max: field.max } : {}),
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
</script>

<template>
  <el-dialog
    :model-value="modelValue"
    title="创建工具（开发者向导）"
    width="min(1120px, 94vw)"
    top="4vh"
    destroy-on-close
    :close-on-click-modal="false"
    :close-on-press-escape="false"
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
      <!-- 左栏：实时预览（与落盘共用同一份生成器），独立滚动 -->
      <div class="wizard-preview">
        <JsonPreviewPane title="tool.manifest.json 实时预览" :text="preview.manifest" :error="preview.error" />
      </div>


      <div class="wizard-form">
        <!-- Step 1 基本信息 -->
        <div v-show="step === 0" class="pane">
          <BasicInfoSection :form="form" mode="create" :categories="categoryOptions" :id-error="idError" />
          <el-alert type="info" :closable="false" title="图标暂用默认占位（icon=auto），创建后可直接替换 assets/icon.svg" />
        </div>

        <!-- Step 2 菜单与页面 -->
        <div v-show="step === 1" class="pane">
          <MenusSection :menus="form.menus" :min-rows="1" :file-for="menuFile">
            <template #hint>
              <div class="hint">每行一个左侧菜单 = 一个页面文件；首个菜单会生成<b>最小可跑示例</b>（调主进程 + 读写配置），其余为占位页。</div>
            </template>
          </MenusSection>
        </div>

        <!-- Step 3 能力与权限 -->
        <div v-show="step === 2" class="pane">
          <CapabilitiesSection
            v-model:capabilities="form.capabilities"
            v-model:allowlist="form.ipcAllowlist"
            v-model:grant="form.requiredGrant"
          />
          <div class="hint">宿主通道默认放行 config:get / config:set（示例页读写配置要用）。模板见 tools/template-tool。</div>
        </div>

        <!-- Step 4 配置项 -->
        <div v-show="step === 3" class="pane">
          <ConfigGroupsSection
            :groups="form.configGroups"
            :pages="form.configPages"
            show-layout-radio
            v-model:layout="form.configLayout"
          />
          <div class="hint">不配分组也可以：跳过创建后再在「配置」编辑器里补。</div>
        </div>

        <div v-if="menuErrors.length" class="error-box">
          <div v-for="e in menuErrors" :key="e">⚠ {{ e }}</div>
        </div>
      </div><!-- /wizard-form -->
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
.wizard-form { flex: 1.2; min-width: 0; min-height: 0; overflow-y: auto; padding-right: 6px; }
.wizard-preview { flex: 1; min-width: 0; min-height: 0; display: flex; flex-direction: column; }
.pane { min-height: 0; }
.hint { font-size: 12px; opacity: .6; line-height: 1.7; margin-top: 6px; }
.error-box { margin-top: 8px; padding: 8px 10px; border-radius: 6px; background: rgba(245, 108, 108, .08); color: #c45656; font-size: 12px; line-height: 1.8; }
.wizard-foot { flex: none; margin-top: 0; padding-top: 12px; border-top: 1px solid var(--sshk-border, #d0d0d0); }
.wizard-actions { display: flex; gap: 8px; justify-content: flex-end; }
.preview-json { flex: 1; min-height: 0; overflow: auto; margin: 0; padding: 10px; border-radius: 8px; background: var(--sshk-panel-soft, rgba(128, 128, 128, .08)); font-size: 11px; line-height: 1.6; white-space: pre; }
.created-list { max-height: 260px; width: 100%; text-align: left; }
</style>
