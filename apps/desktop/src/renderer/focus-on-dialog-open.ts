/**
 * 弹框打开自动聚焦首个输入（用户 2026-11-18：减少二次交互）。
 *
 * 全局机制（一处安装全项目生效）：el-dialog 的显隐由 overlay 的 v-show（display）控制，
 * 内容不随开关重挂载 → 原生 autofocus 属性只在首次挂载生效，第二次打开就失效。
 * 这里用 MutationObserver 监听 display 变化，捕捉「从隐藏 → 可见」的弹框瞬间，
 * 聚焦其中的首个可输入元素。规则：
 * - 优先 `[data-autofocus]` 标记元素（含其内部 input，适配 el-input 外层标记）；
 *   未标记则聚焦 `.el-dialog__body` 内第一个可见 input/textarea；
 * - 弹框任意位置带 `data-no-autofocus` 则整个弹框跳过（编辑器等自管焦点的场景）；
 * - 用户已在弹框内输入（焦点已在弹框里）时不抢焦点。
 */
export function setupDialogAutofocus(): void {
  const shown = new WeakSet<HTMLElement>()
  let timer: number | null = null

  const focusFirst = (dlg: HTMLElement): void => {
    if (dlg.contains(document.activeElement)) return // 焦点已在弹框内：不抢
    const marked = dlg.querySelector<HTMLElement>('[data-autofocus]')
    const target
      = (marked && (marked.matches('input, textarea') ? marked : marked.querySelector<HTMLElement>('input, textarea')))
        ?? dlg.querySelector<HTMLElement>('.el-dialog__body input:not([type="checkbox"]):not([type="radio"]), .el-dialog__body textarea')
    if (!target) return
    target.focus()
    // el-input 组件对 value 无感知的 focus 场景补一次光标置尾（常见于回填名称后直接改尾部字符）
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
      const end = target.value.length
      try { target.setSelectionRange(end, end) } catch { /* number 等类型不支持 */ }
    }
  }

  const scan = (): void => {
    for (const overlay of document.querySelectorAll<HTMLElement>('.el-overlay')) {
      const dlg = overlay.querySelector<HTMLElement>('.el-dialog')
      if (!dlg) continue
      const visible = overlay.style.display !== 'none' && dlg.offsetParent !== null
      if (visible && !shown.has(dlg)) {
        shown.add(dlg)
        if (!dlg.querySelector('[data-no-autofocus]')) window.setTimeout(() => focusFirst(dlg), 60)
      } else if (!visible) {
        shown.delete(dlg) // 关闭后复位，下次打开重新聚焦
      }
    }
  }

  new MutationObserver(() => {
    if (timer !== null) return
    timer = window.setTimeout(() => { timer = null; scan() }, 40)
  }).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['style', 'class'] })
}
