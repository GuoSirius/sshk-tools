declare module 'html-minifier-terser' {
  interface MinifyOptions {
    collapseWhitespace?: boolean
    removeComments?: boolean
    minifyCSS?: boolean
    minifyJS?: boolean
    keepClosingSlash?: boolean
    caseSensitive?: boolean
  }
  export function minify(html: string, options?: MinifyOptions): Promise<string>
}
