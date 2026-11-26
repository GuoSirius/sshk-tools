import type juice from 'juice'

/**
 * EDM 邮件 HTML 的 juice CSS 内联选项（单一真相源）。
 *
 * 逐项对齐 juice-email-cli 的 defaults/juice.yaml `juice:` 段，使「只装 sshk-tools exe、
 * 不装任何外部 CLI」时得到与 juice-email-cli 完全一致的邮件客户端兼容效果。
 * juice@12.2.6 为 edm-studio 的静态依赖，会随主进程 bundle 打进安装包，无需用户另装。
 *
 * 说明：juice-email-cli 的 extraCssFiles 是其应用层约定（读取外部 CSS 文件后拼入 extraCss），
 * 并非 juice 库选项；EDM 侧 CSS 已由 css-bundle/css-resolve 统一汇集并经 injectCss 注入，
 * 故不带入该项。
 */
export const EDM_JUICE_OPTIONS: juice.Options = {
  // 内联完成后移除 <style> 标签（除非被 preservedSelectors / 媒体查询等保留）
  removeStyleTags: true,
  // 保留 @media 响应式规则到独立 <style> 块（响应式邮件必须开启）
  preserveMediaQueries: true,
  // 保留 @font-face 自定义字体声明
  preserveFontFaces: true,
  // 保留 @keyframes 动画声明
  preserveKeyFrames: true,
  // 将 style 转换为 table/tr/td/th 的 align/bgcolor/valign 等 HTML 属性（Outlook Word 引擎兼容）
  applyAttributesTableElements: true,
  // 处理文档内 <style> 标签的 CSS 并内联到元素
  applyStyleTags: true,
  // 不保留 CSS 中的 !important（juice 会移除，避免部分客户端解析异常）
  preserveImportant: false,
  // 解析 CSS 变量（var(--brand-color)）为具体值（Outlook 不认 var()）
  resolveCSSVariables: true,
  // 依据 CSS 宽度给 <img> 补 width 属性
  applyWidthAttributes: true,
  // 依据 CSS 高度给 <img> 补 height 属性
  applyHeightAttributes: true,
  // 将 ::before/::after 伪元素转为 <span> 插入 DOM（伪元素内容需可见呈现）
  inlinePseudoElements: true,
  // 移除 <style> 时保留伪类规则（:hover/:active/:focus 等）
  preservePseudos: true,
  // 保留这些选择器的规则在 <style> 内不内联（Gmail/Outlook 兼容性修复 + 伪类）
  preservedSelectors: ['.gmail-', '#outlook-', ':hover'],
  // 将保留的额外 CSS（媒体查询/@font-face/@keyframes）自动插入文档（优先 <head>）
  insertPreservedExtraCss: true,
}
