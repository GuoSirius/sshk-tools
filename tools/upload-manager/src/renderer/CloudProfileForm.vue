<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Connection, Delete, View } from '@element-plus/icons-vue'
import { FormHint, FormGrid } from '@sshk/ui-kit'
import {
  uploadVendorMeta,
  uploadVendorOptions,
  type UploadCloudProfile,
  type UploadVendorChoice,
} from '@sshk/shared'

/** 云 profile 编辑表单：profile 是响应式数组内的对象，直接改属性即可回写父级 */
const props = defineProps<{
  profile: UploadCloudProfile
  hasSecret: boolean
  secretValue: string
  testing?: boolean
  testResult?: string
}>()
const emit = defineEmits<{
  (e: 'updateSecret', id: string, value: string): void
  (e: 'clearSecret', id: string): void
  (e: 'revealSecret', id: string): void
  (e: 'test', id: string): void
}>()

const vendors = uploadVendorOptions()
const meta = computed(() => uploadVendorMeta(props.profile.provider))

/**
 * N9：下拉中文名优先，但真实地域 ID / Endpoint 仍是写入配置的值。
 * el-select 默认按 label 过滤，中文 label 会让「按 ID 搜」失效，因此自定义
 * filter-method 同时匹配中文名与真实 ID；选项里再补一行灰色 ID 便于核对/复制。
 * allow-create 保留：清单外的值可直接手输，不受过滤影响。
 */
const regionQuery = ref('')
const endpointQuery = ref('')
function filterChoices(list: readonly UploadVendorChoice[], query: string): UploadVendorChoice[] {
  const q = query.trim().toLowerCase()
  if (!q) return [...list]
  return list.filter((c) => c.label.toLowerCase().includes(q) || c.value.toLowerCase().includes(q))
}
const visibleRegions = computed(() => filterChoices(meta.value.regions, regionQuery.value))
const visibleEndpoints = computed(() => filterChoices(meta.value.endpoints, endpointQuery.value))
// 切换厂商后旧关键词会把新厂商清单过滤成空，必须重置
watch(() => props.profile.provider, () => {
  regionQuery.value = ''
  endpointQuery.value = ''
})

/**
 * allow-create 下用户若直接键入/回车中文展示名，写入的会是中文而非真实 ID。
 * 这里把「恰好等于某个预置中文名」的值纠正回真实 ID；
 * 清单外的自定义 ID / 域名原样保留，不限制手输能力。
 */
function coerceChineseLabel(kind: 'region' | 'endpoint', value: string): string {
  const list = kind === 'region' ? meta.value.regions : meta.value.endpoints
  return list.find((c) => c.label === value)?.value ?? value
}
watch(() => props.profile.region, (v) => {
  const fixed = coerceChineseLabel('region', String(v ?? ''))
  if (fixed !== v) props.profile.region = fixed
})
watch(() => props.profile.endpoint, (v) => {
  const fixed = coerceChineseLabel('endpoint', String(v ?? ''))
  if (fixed !== v) props.profile.endpoint = fixed
})
</script>

<template>
  <el-form label-width="auto" size="small">
    <FormGrid>
      <el-form-item label="名称" required><el-input clearable v-model="profile.name" /></el-form-item>
      <el-form-item label="ID">
        <el-input clearable :model-value="profile.id" disabled />
        <span class="hint-inline">密钥按此 ID 关联</span>
      </el-form-item>
      <el-form-item label="云厂商">
        <el-select v-model="profile.provider" filterable>
          <el-option v-for="v in vendors" :key="v.value" :label="v.label" :value="v.value" />
        </el-select>
        <span class="hint-inline">SDK：{{ meta.sdk }}</span>
      </el-form-item>
      <el-form-item label="Bucket" required><el-input clearable v-model="profile.bucket" /></el-form-item>
      <el-form-item label="地域">
        <el-select
          v-model="profile.region"
          filterable
          allow-create
          clearable
          default-first-option
          :filter-method="(q: string) => (regionQuery = q)"
          :placeholder="meta.regionHint"
          style="width: 100%"
        >
          <el-option v-for="r in visibleRegions" :key="r.value" :label="r.label" :value="r.value">
            <div class="choice">
              <span class="choice-name">{{ r.label }}</span>
              <span class="choice-code">{{ r.value }}</span>
            </div>
          </el-option>
        </el-select>
        <div class="hint-block">
          {{ meta.regionHint }}；可输入中文名或地域 ID 搜索，清单外的值直接键入即可
          <template v-if="profile.region"> · 当前地域 ID：<code>{{ profile.region }}</code></template>
        </div>
      </el-form-item>
      <el-form-item label="Endpoint">
        <el-select
          v-model="profile.endpoint"
          filterable
          allow-create
          clearable
          default-first-option
          :filter-method="(q: string) => (endpointQuery = q)"
          :placeholder="meta.endpointHint"
          style="width: 100%"
        >
          <el-option v-for="e in visibleEndpoints" :key="e.value" :label="e.label" :value="e.value">
            <div class="choice">
              <span class="choice-name">{{ e.label }}</span>
              <span class="choice-code">{{ e.value }}</span>
            </div>
          </el-option>
        </el-select>
        <div class="hint-block">
          {{ meta.endpointHint }}；可输入中文说明或域名搜索，清单外的地址直接键入即可
          <template v-if="profile.endpoint"> · 当前值：<code>{{ profile.endpoint }}</code></template>
        </div>
      </el-form-item>
      <el-form-item label="AccessKey ID" required><el-input clearable v-model="profile.accessKeyId" /></el-form-item>
      <el-form-item label="访问域名"><el-input clearable v-model="profile.baseUrl" placeholder="CDN 域名（可选）" /></el-form-item>
      <el-form-item label="AccessKey Secret">
        <div class="combo">
          <el-input
            :model-value="secretValue"
            type="password"
            show-password
            :placeholder="hasSecret ? '点击查看可回显已存密钥；留空保持不变' : '加密存储，可点眼睛查看 / 直接输入'"
            @update:model-value="(v: unknown) => emit('updateSecret', profile.id, String(v ?? ''))"
          />
          <el-tooltip content="查看 / 回显已保存的密钥" placement="top">
            <el-button :icon="View" :disabled="!hasSecret" @click="emit('revealSecret', profile.id)">查看</el-button>
          </el-tooltip>
          <el-button :icon="Delete" :disabled="!hasSecret" @click="emit('clearSecret', profile.id)">清除</el-button>
        </div>
      </el-form-item>
      <el-form-item label="签名URL模板">
        <el-input clearable v-model="profile.signUrlTemplate" placeholder="留空=裸链；如 https://cdn/sign?src={url}&token=..." />
        <FormHint inline detail="视频/音频预览优先用「访问域名 + 文件路径」直链，免下载。若直链需签名鉴权，在此填模板，用 {url} 占位符代表拼好的原始直链（如 https://cdn/x?token=abc&src={url}）。留空则直接用裸链。签名过期导致播放失败时会自动回退为下载后播放。" />
      </el-form-item>
      <el-form-item label="连通性" class="full">
        <div class="combo">
          <el-button type="primary" plain :icon="Connection" :loading="testing" @click="emit('test', profile.id)">
            测试连接
          </el-button>
          <span v-if="testResult" class="test-result" :class="{ 'is-error': testResult.startsWith('✗') }">{{ testResult }}</span>
          <span v-else class="hint-inline">验证厂商 / 地域 / Endpoint / AK / Bucket 是否正确，不写任何文件</span>
        </div>
      </el-form-item>
    </FormGrid>
  </el-form>
</template>

<style scoped>
.hint-inline { display: inline; font-size: 12px; opacity: .6; }
.hint-block { width: 100%; font-size: 12px; opacity: .6; line-height: 1.5; margin-top: 2px; }
.choice { display: flex; align-items: baseline; justify-content: space-between; gap: 16px; }
.choice-name { font-weight: 500; }
.choice-code { font-size: 11px; opacity: .55; font-family: ui-monospace, Consolas, monospace; white-space: nowrap; }
.hint-block code { font-family: ui-monospace, Consolas, monospace; opacity: .9; }
.test-result { margin-left: 0; font-size: 12px; color: var(--el-color-success); }
.test-result.is-error { color: var(--el-color-danger); }
</style>
