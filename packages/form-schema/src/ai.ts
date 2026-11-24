/**
 * 表单 AI 文案辅助（纯函数，零 window 依赖；D53 铁律：≥2 消费方必须抽包）。
 * chat 调用由宿主注入（EDM SampleForm / 表单设计 FormsManagePage），便于单测与无 Provider 降级。
 * EDM 专属的示例数据生成（buildSamplePrompt/generateSample）留在 tools/edm-studio/ai-copy.ts。
 */

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

/** 从模型返回剥出 HTML（容忍围栏；取首个 < 到末个 >）；无法定位返回 null */
export function extractHtml(text: string): string | null {
  const fenced = /```(?:html)?\s*([\s\S]*?)```/.exec(text)
  const body = (fenced?.[1] ?? text).trim()
  const start = body.indexOf('<')
  const end = body.lastIndexOf('>')
  if (start < 0 || end <= start) return null
  return body.slice(start, end + 1)
}

/** 富文本润色：保持标签结构与属性完全不变，只改写可见文字 */
export async function polishRichText(html: string, chat: (messages: ChatMessage[]) => Promise<string>): Promise<string> {
  const text = await chat([
    {
      role: 'user',
      content: [
        '你是文案润色助手。对下面 HTML 中的可见文字做专业、克制的中文润色：',
        '保持 HTML 标签、结构与属性（含链接 href、行内样式）完全不变，只改写标签之间的文字；',
        '不要增删标签，不要输出任何解释，直接返回完整 HTML。',
        `HTML：\n${html}`,
      ].join('\n'),
    },
  ])
  const result = extractHtml(text)
  if (!result) throw new Error('模型没有返回可用的 HTML，请重试')
  return result
}
