import { cpSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import { shouldSeedDefaultProviders } from '@sshk/shared'
import { DEFAULT_PROVIDER_SEEDS } from './modules/llm/presets-data'
import type { AppServices } from './services'

/**
 * 启动迁移三件（P3-1 自 index.ts 拆出）：
 * 旧 userData 迁移 / vision 旧配置转 providerId / 默认 Provider 播种（T4：数据在 app.provider*，逻辑属应用本体）。
 */

/**
 * 一次性迁移：productName 统一前的旧 userData（%APPDATA%/@sshk/desktop）→ 现目录。
 * 目标已存在的文件一律不覆盖（以现目录为准），避免回滚用户在新区已做的配置。
 */
export function migrateLegacyUserData(): void {
  const current = app.getPath('userData')
  const legacy = join(app.getPath('appData'), '@sshk', 'desktop')
  if (current === legacy || !existsSync(legacy)) return
  for (const name of ['settings.json', 'secrets.bin', 'db']) {
    const from = join(legacy, name)
    const to = join(current, name)
    if (existsSync(from) && !existsSync(to)) {
      try {
        cpSync(from, to, { recursive: true })
        console.warn(`[sshk] 已迁移旧数据：${name}`)
      } catch (err) {
        console.warn(`[sshk] 旧数据迁移失败（${name}）：`, err)
      }
    }
  }
}

/** 一次性迁移：旧 vision.baseURL/model 已不再被读取，匹配到 Provider 则转为 providerId/modelOverride */
export function migrateLegacyVisionConfig(services: AppServices): void {
  const cfg = services.config
  const raw = cfg.get('tools.badge-studio.vision')
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return
  const vision = { ...(raw as Record<string, unknown>) }
  const legacyURL = typeof vision['baseURL'] === 'string' ? (vision['baseURL'] as string) : ''
  const legacyModel = typeof vision['model'] === 'string' ? (vision['model'] as string) : ''
  if (!legacyURL && !legacyModel) return
  const providers = Array.isArray(cfg.get('app.llm.providers'))
    ? (cfg.get('app.llm.providers') as { _id: string; baseURL: string }[])
    : []
  const matched = providers.find((p) => p.baseURL === legacyURL)
  delete vision['baseURL']
  delete vision['model']
  if (matched && !vision['providerId']) vision['providerId'] = matched._id
  if (legacyModel && !vision['modelOverride']) vision['modelOverride'] = legacyModel
  cfg.set('tools.badge-studio.vision', vision)
}

/**
 * 默认 Provider 只播种一次：公开端点与模型名在应用本体（modules/llm/presets-data.ts，
 * P4-8b 由 model-console manifest defaults 搬家而来，宿主不再依赖工具清单播种）。
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
