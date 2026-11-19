/**
 * @sshk/rich-text — 共享富文本编辑器（R27，B3 已落地）。
 * F1/F2 已知坑已固化；图片上传经 onUploadImage 回调由工具侧注入（C2），不依赖 upload-core。
 * 图片库（2026-11-16）：imageLibrary 桥接注入来源/上传/列图，弹窗组件在包内实现。
 * md↔html 为单向能力，HTML→MD→HTML 往返不保真。
 */
export { default as RichTextEditor } from './components/RichTextEditor.vue'
export { htmlToMarkdown, markdownToHtml } from './markdown'
export { toDisplayHtml, toStoredHtml, toDisplaySrc } from './display'
export { countText, countHtmlWords, htmlToPlainText } from './word-count'
export type { TextStats } from './word-count'
export type {
  RichTextImageItem,
  RichTextImageLibrary,
  RichTextImageRule,
  RichTextImageSource,
  RichTextImageTarget,
  RichTextUploadHook,
  RichTextUploadProgress,
  RichTextUploadProgressHook,
} from './types'
