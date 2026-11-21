<script setup lang="ts">
/**
 * 内容编辑核心（plans/11 #8 + 2026-11-20 三轮定版）：
 * 第一行 标题 + 标签；第二行 状态 + 定时时间（仅状态=定时发布时显示，精确到时分秒，仅可选当前以后）；
 * 描述 textarea（最小 3 行、最大 5 行，超出内部滚动）；最后富文本正文。
 * 上传与图片库注入收敛在核心内（C2 唯一注入点），壳只管容器与 footer。
 */
import { computed, nextTick, ref, watch } from 'vue'
import { RichTextEditor, toStoredHtml } from '@sshk/rich-text'
import { createHostImageLibrary } from '@sshk/file-picker'
import type { ContentRecord, ContentSaveInput, ContentStatus } from '@sshk/shared'
import { format, toMs, ISO_WITH_OFFSET } from '@sshk/shared'
import { ElMessage } from 'element-plus'
import { host } from '../host'
import { useToolId } from '@sshk/ui-kit'

const props = defineProps<{
  record: ContentRecord | null
  copySource?: ContentRecord | null
}>()
const emit = defineEmits<{ save: [input: ContentSaveInput] }>()

const toolId = useToolId() // #129 铁律：工具 id 单一来源（根组件 provideToolId），禁字面量
interface CeForm {
  _id?: string
  name: string
  html: string
  summary: string
  description: string
  tags: string[]
  status: ContentStatus
  publishAt: string // 到秒的时间串 'YYYY-MM-DD HH:mm:ss'，仅 status==='scheduled' 时有效
}
const form = ref<CeForm>({ _id: undefined, name: '', html: '', summary: '', description: '', tags: [], status: 'draft', publishAt: '' })
const nameRef = ref<{ focus?: () => void } | null>(null)
// 脏检测基线（#126：关闭前有未保存内容需二次确认）：打开/切换记录时快照，isDirty 深比较
const baseline = ref('')
const imageLibrary = createHostImageLibrary(toolId.value, host.upload)

// 定时发布时刻（毫秒）：el-date-picker value-format="x" 直出/直吃毫秒时间戳
const publishMs = computed({
  get: () => toMs(form.value.publishAt) ?? 0,
  set: (v: number) => {
    if (!v) { form.value.publishAt = ''; return }
    form.value.publishAt = format(v) // 'YYYY-MM-DD HH:mm:ss'（shared 统一封装）
  },
})
/** 仅可选今天及以后（disabledDate 按日粒度判定，具体到秒的「当前以后」由下方 publishAtTip 控件级校验） */
const disabledDate = (d: Date): boolean => {
  const start = new Date(); start.setHours(0, 0, 0, 0)
  return d.getTime() < start.getTime()
}
// #128：定时时间控件级校验（选完即校 + 提交前拦截），红字 tip 显示在控件下方，不走 IPC 报错
const publishAtTip = ref('')
function validatePublishAt(): boolean {
  publishAtTip.value = ''
  if (form.value.status !== 'scheduled' || !form.value.publishAt) return true
  const t = toMs(form.value.publishAt)
  if (t == null || t <= Date.now()) { publishAtTip.value = '定时发布时间必须晚于当前时间'; return false }
  return true
}
watch(publishMs, () => { if (publishAtTip.value) void validatePublishAt() })

const onUploadImage = async (file: File): Promise<string> => {  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error ?? new Error('读取图片失败'))
    reader.readAsDataURL(file)
  })
  const result = await host.upload.single({ toolId: toolId.value, name: file.name, size: file.size, mime: file.type, dataUrl }) as { url: string }
  return result.url
}

watch(() => [props.record, props.copySource] as const, () => {
  const src = props.copySource ?? props.record
  form.value = src
    ? {
        _id: props.copySource ? undefined : src._id,
        name: props.copySource ? `${src.name}（副本）` : src.name,
        html: src.html,
        summary: src.summary ?? '',
        description: src.description ?? '',
        tags: [...(src.tags ?? [])],
        status: props.copySource ? 'draft' : src.status,
        publishAt: !props.copySource && src.status === 'scheduled' && src.publishAt ? format(src.publishAt) : '',
      }
    : { _id: undefined, name: '', html: '', summary: '', description: '', tags: [], status: 'draft', publishAt: '' }
  nextTick(() => nameRef.value?.focus?.())
  baseline.value = JSON.stringify(form.value)
}, { immediate: true })

const isDirty = computed(() => baseline.value !== '' && baseline.value !== JSON.stringify(form.value))

/** 标题（原「名称」）必填；定时发布还须带有效时刻 */
const canSave = computed(() => {
  if (!form.value.name.trim()) return false
  if (form.value.status === 'scheduled' && !form.value.publishAt) return false
  return true
})
function submit(): void {
  // 条件不符必须给 toast（项目铁律：禁静默 return；#125 定时时间必填）
  if (!form.value.name.trim()) { ElMessage.warning('请填写内容标题'); return }
  if (form.value.status === 'scheduled' && !form.value.publishAt) { ElMessage.warning('定时发布需选择定时时间'); return }
  // #128：晚于当前时间控件级校验（红字 tip 在控件下，不发 IPC）
  if (!validatePublishAt()) return
  const isScheduled = form.value.status === 'scheduled'
  // publishAt 契约：ISO 带 +08:00 字符串（与 ContentSaveInput 类型一致，勿发数字毫秒）
  const publishMsNum = isScheduled ? toMs(form.value.publishAt) ?? 0 : 0
  emit('save', {
    ...form.value,
    html: toStoredHtml(form.value.html),
    description: form.value.description || undefined,
    publishAt: publishMsNum ? format(publishMsNum, ISO_WITH_OFFSET) : undefined,
  } as ContentSaveInput)
}
defineExpose({ submit, canSave, isDirty })
</script>

<template>
  <div class="ce-core">
    <el-form label-width="auto" size="small" class="ce-meta">
      <!-- 第一行：标题 + 标签（用户 2026-11-20 三轮定版） -->
      <div class="ce-row ce-row-2">
        <el-form-item label="标题" required>
          <el-input ref="nameRef" v-model="form.name" placeholder="内容标题（必填）" clearable data-autofocus />
        </el-form-item>
        <el-form-item label="标签">
          <el-select v-model="form.tags" multiple filterable allow-create default-first-option placeholder="输入回车添加标签" style="width: 100%" />
        </el-form-item>
      </div>
      <!-- 第二行：状态 + 定时时间（仅状态=定时发布时显示，两列栅格与整体对齐；仅可选当前以后，精确到时分秒） -->
      <div class="ce-row ce-row-2">
        <el-form-item label="状态">
          <el-select v-model="form.status" style="width: 100%">
            <el-option label="草稿" value="draft" />
            <el-option label="已发布" value="published" />
            <el-option label="定时发布" value="scheduled" />
            <el-option label="已下线" value="retracted" />
          </el-select>
        </el-form-item>
        <el-form-item v-if="form.status === 'scheduled'" label="定时时间" required>
          <div class="ce-field-wrap">
            <el-date-picker
              v-model="publishMs"
              type="datetime"
              :disabled-date="disabledDate"
              format="YYYY-MM-DD HH:mm:ss"
              value-format="x"
              placeholder="选择发布时间（当前以后，精确到秒）"
              style="width: 100%"
            />
            <div v-if="publishAtTip" class="ce-field-tip">{{ publishAtTip }}</div>
          </div>
        </el-form-item>
        <div v-else class="ce-reserved" aria-hidden="true"></div>
      </div>
      <!-- 描述：最小 3 行、最大 5 行，超出内部滚动 -->
      <el-form-item label="描述">
        <el-input
          v-model="form.description"
          type="textarea"
          :autosize="{ minRows: 3, maxRows: 5 }"
          placeholder="内容描述（可选）"
        />
      </el-form-item>

      <el-form-item label="内容">
        <!-- 正文：富文本（固定高度，编辑区自带内滚，工具栏不随外层滚动） -->
        <div class="ce-editor">
          <RichTextEditor v-model="form.html" :on-upload-image="onUploadImage" :image-library="imageLibrary" :state-key="record?._id ?? 'new'" />
        </div>
      </el-form-item>
    </el-form>
  </div>
</template>

<style scoped>
/* #129 弹框滚动定版（用户 2026-11-20 定稿）：本层=唯一外滚层（滚动条贴弹框右缘，头部/footer 固定不滚）；
   留白由 .ce-meta padding 提供；富文本收进「内容」form-item 固定 min 600 高度、溢出走编辑区内滚 */
.ce-core { display: flex; flex-direction: column; min-height: 0; height: 100%; gap: var(--sshk-gap-md); overflow: auto; }
.ce-meta { padding: 0 16px; }
/* 两列栅格行：多列布局遵守页面留白与间距规范（gap 用统一 token） */
.ce-row-2 { display: grid; grid-template-columns: 1fr 1fr; column-gap: var(--sshk-gap-lg); align-items: start; }
.ce-reserved { min-width: 0; }
/* 控件级校验红字 tip（#128）：显示在控件正下方，不走 IPC 报错刷终端 */
.ce-field-wrap { width: 100%; }
.ce-field-tip { color: var(--el-color-danger); font-size: 12px; line-height: 1.4; padding-top: 4px; }
/* min 300 防小窗裁切：窗口大时随 flex 撑满（≈520+），高度不随内容变化，内容溢出走编辑区内滚 */
.ce-editor { min-height: 600px; display: flex; flex-direction: column; }
.ce-editor > :deep(.rich) { flex: 1; min-height: 0; }
</style>
