import { computed, ref } from 'vue'
import { ElMessage } from 'element-plus'
import type { LlmProviderInfo } from '@sshk/shared'
import { host } from '../host'
import { configKey, textConfig } from './base'

/**
 * 图片识别域 store（P6-5 自 state.ts 三分拆出，模块级单例语义不变）：
 * 模型复用应用级 Provider，工具不再配置 baseURL / apiKey；
 * 识别执行编排（recognizeImages，写工作区统计表）在 workspace 域——依赖方向恒为 域 → base，无环。
 * 注意：vision / imageThumbs 用 ref 而非 reactive——volar 对「导入的 reactive 对象」
 * 在模板里会错误地做 ref 解包（成员访问被改写成 .value），ref 则一切正常。
 * CF-5（2026-11-21 终审）：PaddleOCR 彻底移除——provider 只剩 cloud/manual；
 * 已存的 paddleocr 配置数据作历史残留（不再读取；D45 已推翻）。
 */
export const vision = ref({
  provider: 'cloud' as 'cloud' | 'manual',
})
export const providers = ref<LlmProviderInfo[]>([])
export const visionProviderId = ref('')
export const visionModel = ref('')
export const modelOptions = ref<string[]>([])
export const modelsLoading = ref(false)
export const imageFiles = ref<string[]>([])
export const imageThumbs = ref<Record<string, string>>({})
export const previewList = computed(() => imageFiles.value.map((file) => imageThumbs.value[file] ?? ''))
export async function loadThumb(file: string): Promise<void> {
  if (imageThumbs.value[file]) return
  try {
    imageThumbs.value[file] = await host.os.readDataUri(file)
  } catch (err) {
    ElMessage.warning('图片预览加载失败：' + (err as Error).message)
  }
}
export const recognizing = ref(false)
export const visionRaw = ref('')
// 配置兼容保留（UI 已抹除，恢复零成本）
export const activeProvider = computed(() => providers.value.find((p) => p._id === visionProviderId.value) ?? null)

export async function loadProviders(): Promise<void> {
  providers.value = await host.llm.providers().catch(() => [])
  if (!visionProviderId.value) {
    const active = await host.config.get('app.llm.activeProviderId')
    visionProviderId.value = (typeof active === 'string' && active)
      || (await textConfig('vision.providerId', ''))
      || providers.value.find((p) => p.enabled)?._id
      || ''
  }
  visionModel.value = (await textConfig('vision.modelOverride', '')) || activeProvider.value?.model || ''
  modelOptions.value = activeProvider.value?.model ? [activeProvider.value.model] : []
}

export function onProviderChange(): void {
  visionModel.value = activeProvider.value?.model ?? ''
  modelOptions.value = activeProvider.value?.model ? [activeProvider.value.model] : []
}

export async function fetchProviderModels(): Promise<void> {
  if (!visionProviderId.value) {
    ElMessage.warning('请先在「模型管理」新增 Provider')
    return
  }
  modelsLoading.value = true
  try {
    const list = await host.llm.providerModels(visionProviderId.value)
    modelOptions.value = Array.from(new Set([...modelOptions.value, ...list.filter(Boolean)]))
    if (!visionModel.value && modelOptions.value[0]) visionModel.value = modelOptions.value[0]
    ElMessage.success(`拉取到 ${list.length} 个模型`)
  } catch (err) {
    ElMessage.warning(`模型列表拉取失败：${(err as Error).message}；可手动输入模型名`)
  } finally {
    modelsLoading.value = false
  }
}

/** 多张图片逐张识别，结果合并进同一张可编辑表格，人工核对后才可生成 */
export async function pickImages(): Promise<void> {
  const files = await host.os.pickFile({
    filters: [{ name: '点击统计图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'] }],
    multi: true,
  })
  if (files.length) {
    imageFiles.value = files
    for (const file of files) void loadThumb(file)
  }
}

/** 图片识别配置就地保存：不再跳工具配置页，识别方式 / Provider / 模型一处改完 */
export async function saveVisionConfig(): Promise<void> {
  try {
    await host.config.set(configKey('vision'), {
      provider: vision.value.provider,
      providerId: visionProviderId.value,
      modelOverride: visionModel.value,
    })
    ElMessage.success('图片识别配置已保存为默认')
  } catch (err) {
    ElMessage.error(`保存失败：${(err as Error).message}`)
  }
}
