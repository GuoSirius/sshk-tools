import { shouldSeedDefaultProviders } from '@sshk/shared'
import { DEFAULT_PROVIDER_SEEDS } from './modules/llm/presets-data'
import type { AppServices } from './services'

/**
 * 默认 Provider 只播种一次（T4：数据在 app.provider*，逻辑属应用本体）：
 * 公开端点与模型名在应用本体（modules/llm/presets-data.ts，P4-8b 由 model-console
 * manifest defaults 搬家而来，宿主不再依赖工具清单播种）。
 * 密钥不播种，由用户在「模型配置」页填一次；用户删空后重启也不会复活。
 */
export function seedDefaultProviders(services: AppServices): void {
  const cfg = services.config
  const seeds = DEFAULT_PROVIDER_SEEDS
  if (!seeds.length) return
  if (!shouldSeedDefaultProviders(cfg.get('app.llm.providersSeeded'), cfg.get('app.llm.providers'))) return
  cfg.set('app.llm.providers', seeds)
  cfg.set('app.llm.activeProviderId', seeds.find((p) => p.enabled)?._id ?? null)
  cfg.set('app.llm.providersSeeded', true)
}
