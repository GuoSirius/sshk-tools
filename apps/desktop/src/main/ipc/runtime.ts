import { createHash, createPublicKey } from 'node:crypto'
import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import { AppError, IPC_CHANNELS, now } from '@sshk/shared'
import { installPackage, listInstalled, previewInstall, readRenderer, uninstallPackage } from '../runtime-installer'
import { handleOk } from '../ipc-wrap'
import type { IpcContext } from './context'

/** 运行时工具包（P3-1 registerIpc 拆分：.sshktool Preview/Install/List/Uninstall/ReadRenderer + 公钥管理） */
export function registerRuntimeIpc(ctx: IpcContext): void {
  const cfg = ctx.services.config

  // ── 运行时工具包：.sshktool 导入 / 列表 / 卸载（用户经由文件选择器提供路径） ──
  // 内置工具 id 集合：用于拦截「内建已分发又装同名外部包」的冲突（D-C）
  const builtinToolIds = (): string[] => {
    try {
      const toolsDir = join(app.getAppPath(), 'tools')
      return readdirSync(toolsDir).filter((name) => statSync(join(toolsDir, name)).isDirectory())
    } catch {
      return []
    }
  }
  const runtimeDeps = () => ({ userDataDir: app.getPath('userData'), importedKeys: (cfg.get('app.runtime.publicKeys') ?? []) as never[] })
  handleOk(IPC_CHANNELS.runtimePreview, (_event, zipPath: string) => {
    const path = String(zipPath ?? '')
    if (!/\.sshktool$/i.test(path)) throw new AppError('仅支持 .sshktool 包')
    return previewInstall(path, runtimeDeps(), { builtinIds: builtinToolIds() })
  })
  handleOk(IPC_CHANNELS.runtimeInstall, (_event, zipPath: string, explicitlyTrusted?: boolean) => {
    const path = String(zipPath ?? '')
    if (!/\.sshktool$/i.test(path)) throw new AppError('仅支持 .sshktool 包')
    const result = installPackage(path, runtimeDeps(), { explicitlyTrusted, builtinIds: builtinToolIds() })
    return { record: result.record, warnings: result.warnings }
  })
  handleOk(IPC_CHANNELS.runtimeList, () => listInstalled(runtimeDeps()))
  handleOk(IPC_CHANNELS.runtimeUninstall, (_event, id: string) => uninstallPackage(String(id ?? ''), runtimeDeps()))
  handleOk(IPC_CHANNELS.runtimeReadRenderer, (_event, id: string) => readRenderer(String(id ?? ''), runtimeDeps()))
  // ── 运行时公钥管理：导入（PEM 校验 + 指纹 keyId）/ 列表 / 撤销 ──
  const keyFingerprint = (pem: string) => createHash('sha256').update(pem.trim()).digest('hex').slice(0, 12)
  handleOk(IPC_CHANNELS.runtimeKeysList, () => cfg.get('app.runtime.publicKeys') ?? [])
  handleOk(IPC_CHANNELS.runtimeKeysImport, (_event, label: string, pem: string) => {
    const clean = String(pem ?? '').trim()
    if (!clean.startsWith('-----BEGIN')) throw new AppError('不是有效的 PEM 公钥')
    try { createPublicKey(clean) } catch { throw new AppError('PEM 公钥解析失败，请检查内容') }
    const entry = { keyId: 'pk_' + keyFingerprint(clean), label: String(label || '未命名发布者'), pem: clean, importedAt: now() }
    const keys = (cfg.get('app.runtime.publicKeys') ?? []) as { keyId: string }[]
    if (keys.some((k) => k.keyId === entry.keyId)) throw new AppError('该公钥已导入')
    cfg.set('app.runtime.publicKeys', [...keys, entry])
    return entry
  })
  handleOk(IPC_CHANNELS.runtimeKeysRevoke, (_event, keyId: string) => {
    const keys = (cfg.get('app.runtime.publicKeys') ?? []) as { keyId: string }[]
    cfg.set('app.runtime.publicKeys', keys.filter((k) => k.keyId !== String(keyId ?? '')))
    return true
  })
}
