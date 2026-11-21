import { IPC_CHANNELS } from '@sshk/shared'
import { handleOk } from '../ipc-wrap'
import { FsRuntime } from '../fs'
import type { IpcContext } from './context'

/** X6 文件系统（P3-1 registerIpc 拆分：浏览/管理已配置上传通道 + 统一传输队列；FsRuntime 在此创建） */
export function registerFsIpc(ctx: IpcContext): void {
  const fsRuntime = new FsRuntime({
    services: ctx.services,
    onEvent: (task) => ctx.getMainWindow()?.webContents.send(IPC_CHANNELS.fsTransferEvent, task),
    onMediaEvent: (e) => ctx.getMainWindow()?.webContents.send(IPC_CHANNELS.fsMediaEvent, e),
  })
  ctx.setFsRuntime(fsRuntime)
  handleOk(IPC_CHANNELS.fsProfiles, () => fsRuntime.profilesPayload())
  handleOk(IPC_CHANNELS.fsList, (_event, req: { profileId: string; path: string; cursor?: string | null }) =>
    fsRuntime.list(req))
  handleOk(IPC_CHANNELS.fsStat, (_event, req: { profileId: string; path: string }) => fsRuntime.stat(req))
  handleOk(IPC_CHANNELS.fsMkdir, (_event, req: { profileId: string; path: string }) => fsRuntime.mkdir(req))
  handleOk(IPC_CHANNELS.fsRm, (_event, req: Parameters<FsRuntime['rm']>[0]) => fsRuntime.rm(req))
  handleOk(IPC_CHANNELS.fsCp, (_event, req: Parameters<FsRuntime['cp']>[0]) => fsRuntime.cp(req))
  handleOk(IPC_CHANNELS.fsMv, (_event, req: Parameters<FsRuntime['mv']>[0]) => fsRuntime.mv(req))
  handleOk(IPC_CHANNELS.fsCrossCopy, (_event, req: Parameters<FsRuntime['crossCopy']>[0]) => fsRuntime.crossCopy(req))
  // 递归搜索：边扫边把命中批次推给渲染层（流式显示，避免长时间空白）；最终全量结果仍由 invoke 返回
  handleOk(IPC_CHANNELS.fsSearch, (event, req: Parameters<FsRuntime['search']>[0]) =>
    fsRuntime.search(req, (batch) => {
      const reqId = String((req as { reqId?: string } | undefined)?.reqId ?? '')
      if (!reqId) return
      const payload: import('@sshk/shared').FsSearchEvent = {
        reqId,
        entries: batch.entries,
        done: batch.done,
        scannedDirs: batch.scannedDirs,
      }
      event.sender.send(IPC_CHANNELS.fsSearchEvent, payload)
    }))
  handleOk(IPC_CHANNELS.fsUsage, (_event, req: Parameters<FsRuntime['usage']>[0]) => fsRuntime.usage(req))
  handleOk(IPC_CHANNELS.fsRead, (_event, req: { profileId: string; path: string; maxBytes?: number }) =>
    fsRuntime.read(req))
  handleOk(IPC_CHANNELS.fsReadMedia, (_event, req: { profileId: string; path: string }) => fsRuntime.readMedia(req))
  handleOk(IPC_CHANNELS.fsWrite, (_event, req: Parameters<FsRuntime['write']>[0]) => fsRuntime.write(req))
  handleOk(IPC_CHANNELS.fsTransferStart, (_event, inputs: Parameters<FsRuntime['transferStart']>[0]) =>
    fsRuntime.transferStart(inputs))
  handleOk(IPC_CHANNELS.fsTransferList, () => fsRuntime.transferList())
  // plans/10：单一控制通道（取代旧 cancel/retry/clear 三通道，不做兼容）
  handleOk(IPC_CHANNELS.fsTransferControl, (_event, req: Parameters<FsRuntime['transferControl']>[0]) =>
    fsRuntime.transferControl(req))
  handleOk(IPC_CHANNELS.fsTransferMultipart, () => fsRuntime.transferMultipart())
  handleOk(IPC_CHANNELS.fsTransferMultipartSet, (_event, req: Parameters<FsRuntime['setTransferMultipart']>[0]) =>
    fsRuntime.setTransferMultipart(req))
  handleOk(IPC_CHANNELS.fsTransferOrphansClean, () => fsRuntime.cleanOrphanUploads())
  handleOk(IPC_CHANNELS.fsPickUpload, (_event, opts?: { type?: 'file' | 'dir' | 'any' }) =>
    fsRuntime.pickUpload(opts))
  handleOk(IPC_CHANNELS.fsFlattenLocal, (_event, paths: string[]) => fsRuntime.flattenLocal(paths))
  // 下载目录读取 / 修改（当前通道下载落点由渲染层用 getDir(profileId) 计算）
  handleOk(IPC_CHANNELS.fsDownloadDir, (_event, profileId: string) => fsRuntime.downloadDir(profileId))
  handleOk(IPC_CHANNELS.fsSetDownloadDir, (_event, dir: string) => fsRuntime.setDownloadDir(dir))
  // ── §十一 扩展（用户 2026-11-18 定版）：chmod / 文本转换 / 压缩解压 / 备注 / 收藏 ──
  handleOk(IPC_CHANNELS.fsChmod, (_event, req: Parameters<FsRuntime['chmod']>[0]) => fsRuntime.chmod(req))
  handleOk(IPC_CHANNELS.fsConvertText, (_event, req: Parameters<FsRuntime['convertText']>[0]) => fsRuntime.convertText(req))
  handleOk(IPC_CHANNELS.fsZip, (_event, req: Parameters<FsRuntime['zip']>[0]) => fsRuntime.zip(req))
  handleOk(IPC_CHANNELS.fsUnzip, (_event, req: Parameters<FsRuntime['unzip']>[0]) => fsRuntime.unzip(req))
  handleOk(IPC_CHANNELS.fsZipLimits, () => fsRuntime.zipLimits())
  handleOk(IPC_CHANNELS.fsZipLimitsSet, (_event, req: Parameters<FsRuntime['setZipLimits']>[0]) => fsRuntime.setZipLimits(req))
  handleOk(IPC_CHANNELS.fsTransferCaps, () => fsRuntime.transferCaps())
  handleOk(IPC_CHANNELS.fsTransferCapsSet, (_event, req: Parameters<FsRuntime['setTransferCaps']>[0]) => fsRuntime.setTransferCaps(req))
  handleOk(IPC_CHANNELS.fsAnnotationList, (_event, profileId: string) => fsRuntime.annotationList(profileId))
  handleOk(IPC_CHANNELS.fsAnnotationSet, (_event, req: Parameters<FsRuntime['annotationSet']>[0]) => fsRuntime.annotationSet(req))
  handleOk(IPC_CHANNELS.fsFavoriteList, () => fsRuntime.favoriteList())
  handleOk(IPC_CHANNELS.fsFavoriteAdd, (_event, req: Parameters<FsRuntime['favoriteAdd']>[0]) => fsRuntime.favoriteAdd(req))
  handleOk(IPC_CHANNELS.fsFavoriteRemove, (_event, id: string) => fsRuntime.favoriteRemove(id))
}
