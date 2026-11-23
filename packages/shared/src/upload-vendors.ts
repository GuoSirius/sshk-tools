/**
 * 兼容转发壳（Q-23 第二步 2026-11-23）：上传厂商目录真相源已迁入 @sshk/upload-core/src/upload-vendors.ts。
 * 本文件仅为保持 shared 公共 API 稳定而转发；相对路径避免包级循环。
 * 新代码请直接从 @sshk/upload-core/types 导入。
 */
export * from '../../upload-core/src/upload-vendors'
