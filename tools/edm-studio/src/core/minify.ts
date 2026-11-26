import { minify } from 'html-minifier-terser'

const OPTIONS = {
  collapseWhitespace: true,
  conservativeCollapse: true,
  removeComments: true,
  removeConditionalComments: false,
  minifyCSS: true,
  minifyJS: false,
  removeEmptyAttributes: false,
  collapseBooleanAttributes: false,
  removeRedundantAttributes: true,
  useShortDoctype: true,
  preserveLineBreaks: false,
  keepClosingSlash: true,
}

/** final 阶段压缩（数据契约 tools.edm-studio.minify） */
export async function htmlMinify(html: string): Promise<string> {
  return minify(html, OPTIONS)
}
