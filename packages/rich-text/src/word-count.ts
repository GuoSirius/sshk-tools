/**
 * 富文本底部状态栏的字数统计（用户需求 2026-11-16：类似 Word 的字数显示）。
 *
 * 口径（对齐 Word「字数 / 字符数」的常用近似）：
 * - 字数：CJK 字符每字计 1（含中文标点），连续西文字母/数字串计 1；
 * - 字符数（计空格）：除换行外全部字符；
 * - 字符数（不计空格）：再扣除空白字符；
 * - 段落数：非空文本行（editor.getText() 以 \n 分块）。
 */

const CJK_OR_PUNCT = /[\u3000-\u9fff\uf900-\ufaff\uff00-\uffef]/
const WORD_TOKEN = /[A-Za-z0-9\u00c0-\u024f\u0400-\u04ff]+/g

export interface TextStats {
  /** 字数（Word 口径近似） */
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

/** 保存入库用：HTML → 提纯文本 → 字数（Word 口径近似）。plans/11 H1 修正：countText 只吃纯文本且返回 TextStats。 */
export function countHtmlWords(html: string | null | undefined): number {
  if (!html) return 0
  return countText(htmlToPlainText(html)).words
}

export function countText(text: string): TextStats {
  const visible = text.replace(/\n/g, '')
  // 字数统计时换行按空格处理：跨段相邻的西文单词不能粘连成一个
  const forWords = text.replace(/\n/g, ' ')
  let words = 0
  // CJK 逐字计数：把多字节段拆开逐个判断，西文段交给 WORD_TOKEN 整段计 1
  for (const ch of forWords) {
    if (CJK_OR_PUNCT.test(ch)) words += 1
  }
  const latinWords = forWords.match(WORD_TOKEN)
  words += latinWords ? latinWords.length : 0

  const chars = visible.length
  const charsNoSpace = visible.replace(/\s/g, '').length
  const paragraphs = text
    .split(/\n+/)
    .map((s) => s.trim())
    .filter(Boolean).length
  return { words, chars, charsNoSpace, paragraphs }
}
