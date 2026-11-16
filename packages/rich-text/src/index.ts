/**
 * @sshk/rich-text — 共享富文本编辑器（R27，B3 已落地）。
 * F1/F2 已知坑已固化；图片上传经 onUploadImage 回调由工具侧注入（C2），不依赖 upload-core。
 * md↔html 为单向能力，HTML→MD→HTML 往返不保真。
 */
export { default as RichTextEditor } from './components/RichTextEditor.vue'
export { htmlToMarkdown, markdownToHtml } from './markdown'
export { toDisplayHtml, toStoredHtml, toDisplaySrc } from './display'
export type { RichTextImageRule, RichTextUploadHook } from './types'
