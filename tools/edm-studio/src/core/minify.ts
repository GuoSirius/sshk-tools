import { minify } from 'html-minifier-terser'

const OPTIONS = {
  collapseWhitespace: true,
  removeComments: true,
  minifyCSS: true,
  minifyJS: false, // 邮件内不执行 JS，保持原样避免误伤
  keepClosingSlash: true,
}

/** final 阶段压缩（数据契约 tools.edm-studio.minify） */
export async function htmlMinify(html: string): Promise<string> {
  return minify(html, OPTIONS)
}
