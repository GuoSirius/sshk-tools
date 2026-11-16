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
