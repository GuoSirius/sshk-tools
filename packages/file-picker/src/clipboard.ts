/**
 * 剪贴板兜底复制（P6-3 自 FilePickerDialog.copyLink 拆出的纯函数）：
 * 优先 Clipboard API，失败回退 execCommand（file:// 等非安全上下文）。返回是否成功，提示交给调用方。
 */
export async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    document.execCommand('copy')
    document.body.removeChild(ta)
    return true
  } catch {
    return false
  }
}
