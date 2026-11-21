/**
 * 内容导出薄适配层（P5-4 · B12-T6）：实现统一收编进 @sshk/export-core（渲染层导出产物唯一落点）。
 * 本文件仅保留既有消费面（ContentsPage 等按相对路径引入），新消费方请直接引 @sshk/export-core。
 */
export { exportTriple, exportHtml, exportMarkdown } from '@sshk/export-core'
