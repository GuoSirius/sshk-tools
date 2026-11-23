import { ref } from 'vue'
import { toolConfigKey } from '@sshk/shared'
import { host } from '../host'

/**
 * Badge Studio 工具基座（P6-5 自 state.ts 三分拆出）：
 * toolId 单例 + config key 装配。域 store（workspace/posters/vision）共同依赖，无相互引用（单向 base←域）。
 */
export const toolId = ref('')

/** CR-25③（P0-7）：格式统一走 shared toolConfigKey，本包装只注入本工具 toolId */
export function configKey(key: string): string {
  return toolConfigKey(toolId.value, key)
}

/** 读字符串配置，空值回落 fallback */
export async function textConfig(key: string, fallback: string): Promise<string> {
  const value = await host.config.get(configKey(key))
  return typeof value === 'string' && value.trim() ? value : fallback
}
