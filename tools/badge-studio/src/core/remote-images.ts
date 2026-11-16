/**
 * 外链图片内联（穿插⑦-6 根因修复，对应 EDM 验证清单 Q8 方案）：
 * 浏览器 <img> 显示外链图片不受 CORS 限制，但 snapdom 截图需 fetch 读取像素内联，
 * 跨域被拦 → 导出 PNG 全是灰占位。在 main 侧用 Node fetch（无 CORS）把外链图片
 * 下载转 dataURL 写回 HTML，预览 / 截图 / 分享三个出口同时受益。
 * 纯函数只做提取与替换；下载动作由 main ipc 注入（本模块不依赖 Electron/Node 网络）。
 */

export interface RemoteImageRef {
  /** 原始片段（含引号与尾部属性），作为精确替换键（split/join，规避 $ 特殊字符） */
  raw: string
  url: string
  /** 前缀（如 `<img src=` 或 `url(`），拼回替换片段 */
  head: string
  quote: string
  /** 引号之后到片段结尾（img 的 `width="1">` / css 的 `)`） */
  tail: string
}

/** <img src="https://...">（排除已是 data: 的；m5 捕获引号后到标签尾的属性，替换时不丢） */
const IMG_REMOTE_RE = /(<img\b[^>]*?\bsrc\s*=\s*)(["'])(https?:\/\/[^"'\s]{4,2000})\2([^>]*>)/gi

/**
 * CSS url("https://...")：支持 &quot; / 单双引号 / 无引号三种形态。
 * URL 不做后缀限定（正则里跨形态写不可靠），由 extract 后按扩展名过滤。
 */
const CSS_URL_RE = /(url\(\s*)(&quot;|["']?)(https?:\/\/[^"\s')]+?)\2(\s*\))/gi

const IMAGE_EXT_RE = /\.(png|jpe?g|webp|gif|svg)(\?|#|$)/i

function extract(html: string, re: RegExp, cssFilter: boolean): RemoteImageRef[] {
  const out: RemoteImageRef[] = []
  for (const m of html.matchAll(re)) {
    const url = m[3] ?? ''
    if (cssFilter && !IMAGE_EXT_RE.test(url)) continue
    out.push({ raw: m[0], url, head: m[1] ?? '', quote: m[2] ?? '"', tail: m[4] ?? '' })
  }
  return out
}

/** 提取全部外链图片引用（img src + CSS url()，按 URL 去重前的原始引用列表） */
export function extractRemoteImageRefs(html: string): RemoteImageRef[] {
  return [...extract(html, IMG_REMOTE_RE, false), ...extract(html, CSS_URL_RE, true)]
}

/** 用 dataURL 替换一个引用片段（保留尾部属性与闭合结构） */
export function replacementFor(ref: RemoteImageRef, dataUrl: string): string {
  return `${ref.head}${ref.quote}${dataUrl}${ref.quote}${ref.tail}`
}

/** 全部替换（split/join，规避 $ 替换模式） */
export function replaceRefs(html: string, refs: RemoteImageRef[], dataUrl: string): string {
  let out = html
  for (const ref of refs) out = out.split(ref.raw).join(replacementFor(ref, dataUrl))
  return out
}
