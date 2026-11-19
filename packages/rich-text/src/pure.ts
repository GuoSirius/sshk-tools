/**
 * rich-text 纯函数入口（无 .vue 依赖）：供主进程 / 非渲染构建图安全 import。
 * 主进程 SSR 构建的 rolldown 无法解析 .vue（JSX parser 报错），故不能从包根 index 引入。
 * 渲染层仍从包根 index 引入（含 RichTextEditor 组件）。
 */
export { countText, countHtmlWords, htmlToPlainText } from './word-count'
export type { TextStats } from './word-count'
export { toDisplayHtml, toStoredHtml, toDisplaySrc } from './display'
export { htmlToMarkdown, markdownToHtml } from './markdown'
