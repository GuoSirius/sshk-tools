/**
 * `@sshk/upload-core/types` —— 零依赖类型子入口：
 * UploadProfile / UploadToolConfig / 云厂商目录等上传领域数据从这里暴露，
 * 「不想拖 shared 桶导出」的渲染消费者直接引本子入口。
 * Q-23 第二步（2026-11-23）：upload-manager / upload-vendors 真相源已迁入本包，
 * 本入口直接 re-export 包内实现；两文件不得 import 任何 Node 侧模块或 SDK（保持零依赖链）。
 */
export * from './upload-manager'
export * from './upload-vendors'
