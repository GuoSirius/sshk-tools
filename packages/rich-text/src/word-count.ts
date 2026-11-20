/**
 * 富文本底部状态栏的字数统计（用户需求 2026-11-16：类似 Word 的字数显示）。
 *
 * 口径（2026-11-19 用户反馈修正）：
 * - 字数：非空白字符数（CJK / 西文字母 / 数字 / 标点逐字符计 1），对齐中文写作平台直觉；
 *   旧口径把连续西文串当 1 个词，用户输入一串字母时字数显示 2（字符 19），与「输入了很多」不符。
 * - 字符数（计空格）：除换行外全部字符；
 * - 字符数（不计空格）：再扣除空白字符；
 * - 段落数：非空文本行（editor.getText() 以 \n 分块）。
 */

export interface TextStats {
  /** 字数（非空白字符数，中西文逐字符计 1） */
  words: number
  /** 字符数（计空格，不含换行） */
  chars: number
  /** 字符数（不计空格） */
  charsNoSpace: number
  /** 段落数（非空行） */
  paragraphs: number
}

/**
 * HTML → 纯文本（无 DOM，供主进程入库前提纯）。
 * - script/style 整段丢弃；块级标签转换行（保住 countText 的段落口径）；其余标签剥离；
 * - 常见实体解码 + 数字实体（&#123; / &#x1f600;）；中文/西文混排交给 countText 统一口径。
 */
export function htmlToPlainText(html: string): string {
  return html
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<\/(p|div|li|br|h[1-6]|blockquote|pre|tr|section|article)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/[ \t]+/g, ' ')
    .trim()
}

/** 保存入库用：HTML → 提纯文本 → 字数（非空白字符数，中西文逐字符计 1）。plans/11 H1 修正：countText 只吃纯文本且返回 TextStats。 */
export function countHtmlWords(html: string | null | undefined): number {
  if (!html) return 0
  return countText(htmlToPlainText(html)).words
}

export function countText(text: string): TextStats {
  const visible = text.replace(/\n/g, '')
  const chars = visible.length
  const charsNoSpace = visible.replace(/\s/g, '').length
  // 字数 = 非空白字符数（中西文均逐字符计），中文写作场景的字数直觉
  const words = charsNoSpace
  const paragraphs = text
    .split(/\n+/)
    .map((s) => s.trim())
    .filter(Boolean).length
  return { words, chars, charsNoSpace, paragraphs }
}
