/**
 * 兼容转发壳（Q-23 第二步 2026-11-23）：上传领域数据真相源已迁入 @sshk/upload-core/src/upload-manager.ts。
 * 本文件仅为保持 shared 公共 API 稳定而转发（全仓约 10 个存量消费者仍从 @sshk/shared 导入）；
 * 用相对路径而非包级 import，避免 shared ↔ upload-core 包级循环（ELOOP 事故 2026-11-21）。
 * 新代码请直接从 @sshk/upload-core/types 导入上传领域类型与函数。
 */
export * from '../../upload-core/src/upload-manager'
