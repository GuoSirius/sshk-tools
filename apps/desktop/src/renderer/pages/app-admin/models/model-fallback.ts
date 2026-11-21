/**
 * D-T1：/models 拉取失败（401/404/端点不开放）时的预设回退纯函数。
 * 行为锁死：预设命中 → 合并预设模型进选项 + 空模型时补默认值；未命中 → 原样返回，绝不阻断保存。
 */
export interface FallbackPreset {
  models: string[]
  defaultModel?: string
}

export function applyFallbackModels(
  modelOptions: string[],
  currentModel: string,
  preset: FallbackPreset | undefined,
): { modelOptions: string[]; model: string } {
  if (!preset) return { modelOptions, model: currentModel }
  const merged = Array.from(new Set([...modelOptions, ...preset.models]))
  const model = currentModel || preset.defaultModel || preset.models[0] || currentModel
  return { modelOptions: merged, model }
}
