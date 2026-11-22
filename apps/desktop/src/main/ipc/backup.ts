import { join } from 'node:path'
import { app } from 'electron'
import { AppError, IPC_CHANNELS } from '@sshk/shared'
import { exportBackup, importBackup } from '@sshk/backup'
import { defaultConfigPath, listSnapshots, restoreSnapshot, clearSnapshots } from '@sshk/repository'
import { handleOk } from '../ipc-wrap'
import { exportPreset, importPreset, type PresetSecretStore } from '../modules/llm/presets'
import type { IpcContext } from './context'

/** 备份/预设/快照（P3-1 registerIpc 拆分：backup 导出导入 + N3 预设 + N4 回滚快照） */
export function registerBackupIpc(ctx: IpcContext): void {
  const services = ctx.services

  // ── 备份：settings + NeDB + 产物 → zip；导入含快照回滚 ──
  handleOk(IPC_CHANNELS.backupExport, async (_event, zipPath: string, passphrase?: string) => {
    const out = String(zipPath ?? '')
    if (!out) throw new AppError('缺少导出路径', 'io')
    const manifest = await exportBackup({
      repository: services.repository,
      settings: services.config.snapshot() as unknown as Record<string, unknown>,
      outputRoot: services.outputRoot,
      outZipPath: out,
      appVersion: app.getVersion(),
      secretsJson: services.exportSecretsJson(),
      migrationPassphrase: passphrase || undefined,
    })
    return { counts: manifest.counts, file: out }
  })
  handleOk(IPC_CHANNELS.backupImport, async (_event, zipPath: string, passphrase?: string) => {
    const file = String(zipPath ?? '')
    if (!file) throw new AppError('缺少导入文件', 'io')
    const dbDir = services.dbDir
    const result = await importBackup({
      repository: services.repository,
      zipPath: file,
      outputRoot: services.outputRoot,
      snapshotDir: join(services.outputRoot, '.tmp', 'import', 'pre-import-backup'),
      dbDir,
      settingsPath: defaultConfigPath(app.getPath('userData')),
      migrationPassphrase: passphrase || undefined,
    })
    // F-02：await 密钥合并落盘（此前 void fire-and-forget，失败静默）
    if (result.secretsJson) await services.importSecretsJson(result.secretsJson)
    return { counts: result.manifest.counts, secretsRestored: result.secretsRestored, secretsMessage: result.secretsMessage }
  })

  // ── N3 配置预设分享：导出（脱敏 JSON）/ 导入（按 id 合并）──
  // 预设密钥投影：含密钥导出/导入时经 services 读写 safeStorage（默认导出不带密钥，红线不变）
  const presetSecrets: PresetSecretStore = {
    getProviderKey: (id) => services.getApiKey(id),
    getUploadKey: (id) => services.getUploadSecret(id),
    // F-02：返回 Promise 由 importPreset await（写入失败向上抛变 toast）
    setProviderKey: (id, key) => services.setApiKey(id, key),
    setUploadKey: (id, key) => services.setUploadSecret(id, key),
  }
  handleOk(IPC_CHANNELS.presetExport, (_event, req: string | { outPath: string; includeSecrets?: boolean }, inc?: boolean) => {
    // 兼容两条调用路径：命名方法传 (outPath, includeSecrets)；通用 IPC 透传 (channel, outPath, includeSecrets)
    const payload = typeof req === 'string'
      ? { outPath: req, includeSecrets: Boolean(inc) }
      : (req ?? { outPath: '' })
    return exportPreset(services.config, String(payload.outPath ?? ''), presetSecrets, Boolean(payload.includeSecrets))
  })
  handleOk(IPC_CHANNELS.presetImport, (_event, filePath: string) => importPreset(services.config, String(filePath ?? ''), presetSecrets))

  // ── N4 回滚快照：列表 / 恢复 / 清空（开关 app.outputSnapshot 在设置页）──
  const snapshotRoot = join(app.getPath('userData'), '.snapshots')
  handleOk(IPC_CHANNELS.snapshotList, () => listSnapshots(snapshotRoot))
  handleOk(IPC_CHANNELS.snapshotRestore, (_event, id: string) => restoreSnapshot(snapshotRoot, String(id ?? '')))
  handleOk(IPC_CHANNELS.snapshotClear, () => ({ removed: clearSnapshots(snapshotRoot) }))
}
