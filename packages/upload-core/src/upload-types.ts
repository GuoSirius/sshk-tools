/**
 * `@sshk/upload-core/types` —— 零依赖类型子入口（B6 · P0-5 类型真相源入口）：
 * UploadProfile / UploadToolConfig / 云厂商目录等纯数据层从这里暴露，
 * 「不想拖 shared 桶导出（dayjs）」的渲染消费者直接引本子入口。
 * 铁律：本入口指向的 shared/upload-manager.ts 与 shared/upload-vendors.ts
 * 不得 import 任何 Node 侧模块或 SDK（保持零依赖链）；
 * 子入口经相对路径 re-export，避免 shared↔upload-core 包级循环依赖（ELOOP 事故 2026-11-21）。
 */
export * from '../../shared/src/upload-manager'
export * from '../../shared/src/upload-vendors'
