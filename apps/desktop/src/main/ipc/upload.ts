import { IPC_CHANNELS } from '@sshk/shared'
import { handleOk } from '../ipc-wrap'
import { logger } from '../logger'
import { UploadRuntime, type UploadListRequest, type UploadRequest, type UploadTestRequest } from '../upload'
import type { IpcContext } from './context'

/** R26 应用级上传（P3-1 registerIpc 拆分：全局 profile + 工具覆盖；密钥只在主进程经 safeStorage 解析） */
export function registerUploadIpc(ctx: IpcContext): void {
  const uploads = new UploadRuntime({
    services: ctx.services,
    onProgress: (p) => ctx.getMainWindow()?.webContents.send(IPC_CHANNELS.uploadProgress, p),
  })
  handleOk(IPC_CHANNELS.uploadSingle, async (_event, req: UploadRequest) => {
    // H3-3 埋点：上传开始/完成/失败（文件名 + 大小，不含密钥）
    const started = Date.now()
    logger.info('upload', `单文件上传：${String(req?.name ?? '')}（${Number(req?.size ?? 0)} B）`)
    try {
      const result = await uploads.single(req)
      logger.info('upload', `单文件上传完成 ${Date.now() - started}ms：${String(req?.name ?? '')}`)
      return result
    } catch (err) {
      logger.error('upload', `单文件上传失败：${String(req?.name ?? '')}：${(err as Error).message}`)
      throw err
    }
  })
  handleOk(IPC_CHANNELS.uploadBatch, async (_event, reqs: UploadRequest[]) => {
    const count = Array.isArray(reqs) ? reqs.length : 0
    const started = Date.now()
    logger.info('upload', `批量上传：${count} 个文件`)
    try {
      const results = await uploads.batch(reqs)
      logger.info('upload', `批量上传完成 ${Date.now() - started}ms：${count} 个`)
      return results
    } catch (err) {
      logger.error('upload', `批量上传失败：${(err as Error).message}`)
      throw err
    }
  })
  handleOk(IPC_CHANNELS.uploadManagerGet, () => uploads.getConfig())
  handleOk(IPC_CHANNELS.uploadManagerSet, (_event, raw: unknown) => uploads.setConfig(raw))
  handleOk(IPC_CHANNELS.uploadProfiles, (_event, type?: 'remote' | 'cloud') =>
    uploads.profiles(type === 'remote' || type === 'cloud' ? type : undefined))
  handleOk(IPC_CHANNELS.uploadSecretSet, (_event, profileId: string, value: string) =>
    uploads.setSecret(profileId, value))
  handleOk(IPC_CHANNELS.uploadSecretState, () => uploads.secretState())
  // N3 / N4：按 id 主动查看密钥、按 profile 独立连通性自检（临时密钥不落盘）
  handleOk(IPC_CHANNELS.uploadSecretGet, (_event, profileId: string) => uploads.getSecret(profileId))
  handleOk(IPC_CHANNELS.uploadTest, (_event, req: UploadTestRequest) => uploads.test(req))
  // 富文本图片库：按来源列出已有图片（上传 runtime 内部解析 profile 与密钥）
  handleOk(IPC_CHANNELS.uploadListImages, (_event, req: UploadListRequest) => uploads.listImages(req))
  // 富文本图片库：按来源列出真实目录（含空目录），供目录下拉
  handleOk(IPC_CHANNELS.uploadListDirectories, (_event, req: UploadListRequest) => uploads.listDirectories(req))
}
