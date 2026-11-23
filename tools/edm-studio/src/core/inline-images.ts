/**
 * T8：识别 HTML 里残留的内联 data: 图片，供渲染层批量上传后回写成内容资源 URL。
 * 纯函数（不依赖 DOM / IPC），便于单测；上传动作在 renderer/upload.ts 注入。
 */
export interface InlineImage {
  /** 原始片段，作为精确替换键 */
  raw: string
  /** `src=` 前缀（含属性名与等号），用于拼回替换片段 */
  head: string
  quote: string
  dataUrl: string
  mime: string
  name: string
  /** 由 base64 长度估算的字节数（去掉尾部 padding） */
  size: number
}

const IMG_SRC_RE = /(<img\b[^>]*?\bsrc\s*=\s*)(["'])(data:image\/([a-zA-Z0-9.+-]+);base64,([^"']+))\2/gi

export function extractInlineImages(html: string): InlineImage[] {
  const out: InlineImage[] = []
  let index = 0
  for (const m of html.matchAll(IMG_SRC_RE)) {
    const subtype = m[4] ?? 'png'
    const base64 = m[5] ?? ''
    const ext = subtype.replace(/\+xml$/, '').replace(/[^a-zA-Z0-9]/g, '') || 'png'
    const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0
    out.push({
      raw: m[0],
      head: m[1] ?? '',
      quote: m[2] ?? '"',
      dataUrl: m[3] ?? '',
      mime: `image/${subtype}`,
      name: `inline-${++index}.${ext}`,
      size: Math.max(0, Math.floor((base64.length * 3) / 4) - padding),
    })
  }
  return out
}

export function replacementFor(img: InlineImage, url: string): string {
  return `${img.head}${img.quote}${url}${img.quote}`
}

/**
 * data: URL → File（内联图片静默转存用；纯 base64 解码，不依赖 fetch）。
 * 渲染进程 File/atob 均可用；Node 测试环境（18+）也支持。
 */
export function dataUrlToFile(dataUrl: string, name: string, mime: string): File {
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1)
  const bin = atob(base64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new File([bytes], name, { type: mime })
}

/** 全部替换用 split/join，避免 $ 等特殊字符在 String.replace 里被当替换模式 */
export function replaceInlineImages(
  html: string,
  pairs: { raw: string; replacement: string }[],
): string {
  let out = html
  for (const pair of pairs) out = out.split(pair.raw).join(pair.replacement)
  return out
}
