/**
 * 弹框打开自动聚焦首个输入（用户 2026-11-18：减少二次交互）。
 *
 * 全局机制（一处安装全项目生效）：el-dialog 的显隐由 overlay 的 v-show（display）控制，
 * 内容不随开关重挂载 → 原生 autofocus 属性只在首次挂载生效，第二次打开就失效。
 * 这里用 MutationObserver 监听 display 变化，捕捉「从隐藏 → 可见」的弹框瞬间，
 * 聚焦其中的首个可输入元素。规则：
 * - 覆盖 el-dialog 与 ElMessageBox（.el-message-box，prompt 类弹框的输入框聚焦同一入口）；
 * - 优先 `[data-autofocus]` 标记元素（含其内部 input，适配 el-input 外层标记）；
 *   未标记则聚焦 .el-dialog__body 第一个可见 input/textarea（message-box 取 .el-message-box__input）；
 * - 弹框任意位置带 `data-no-autofocus` 则整个弹框跳过（编辑器等自管焦点的场景）；
 * - 用户已在弹框内输入（焦点已在弹框里）时不抢焦点；
 * - 聚焦失败自动重试（60/180/350ms）：ElMessageBox 的确认按钮默认抢焦 / EP focus-trap 初始化
 *   晚于首次聚焦等时序问题，都靠重试兜底（2026-11-19 加固，用户反馈重命名弹框未聚焦）。
 */
export function setupDialogAutofocus(): void {
  const shown = new WeakSet<HTMLElement>()

  const isInput = (el: Element): el is HTMLInputElement | HTMLTextAreaElement =>
    el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement

  const focusTargetIn = (dlg: HTMLElement): HTMLElement | null => {
    const marked = dlg.querySelector<HTMLElement>('[data-autofocus]')
    const target
      = (marked && (marked.matches('input, textarea') ? marked : marked.querySelector<HTMLElement>('input, textarea')))
        ?? dlg.querySelector<HTMLElement>(
          '.el-dialog__body input:not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="submit"]), '
          + '.el-dialog__body textarea, .el-message-box__input input, .el-message-box__input textarea',
        )
    if (!target) return null
    target.focus()
    if (isInput(target)) {
      const end = target.value.length
      try { target.setSelectionRange(end, end) } catch { /* number 等类型不支持 */ }
    }
    return document.activeElement === target ? target : null
  }

  const tryFocus = (dlg: HTMLElement): void => {
    // 只有焦点已落在弹框内的「输入框」上才算成功（用户 2026-11-19：EP focus-trap 会把焦点
    // 放到弹框容器/关闭按钮等非输入元素上，此前「焦点在弹框内即跳过」导致输入框始终不聚焦）
    if (document.activeElement && dlg.contains(document.activeElement)
      && (document.activeElement instanceof HTMLInputElement || document.activeElement instanceof HTMLTextAreaElement)) return
    focusTargetIn(dlg)
  }

  const scheduleFocus = (dlg: HTMLElement): void => {
    // 重试链：EP focus-trap / MessageBox 默认焦点可能晚于首次尝试，落点不对再补（最长兜底 1.2s）
    for (const delay of [50, 150, 350, 700, 1200]) {
      window.setTimeout(() => {
        if (!shown.has(dlg) || dlg.offsetParent === null) return // 已关闭
        if (document.activeElement && dlg.contains(document.activeElement)
          && (document.activeElement instanceof HTMLInputElement || document.activeElement instanceof HTMLTextAreaElement)) return // 输入框已聚焦成功
        focusTargetIn(dlg)
      }, delay)
    }
  }

  const scan = (): void => {
    for (const overlay of document.querySelectorAll<HTMLElement>('.el-overlay')) {
      const dlg = overlay.querySelector<HTMLElement>('.el-dialog, .el-message-box')
      if (!dlg) continue
      const visible = overlay.style.display !== 'none' && dlg.offsetParent !== null
      if (visible && !shown.has(dlg)) {
        shown.add(dlg)
        if (!dlg.querySelector('[data-no-autofocus]')) {
          tryFocus(dlg)
          scheduleFocus(dlg)
        }
      } else if (!visible) {
        shown.delete(dlg) // 关闭后复位，下次打开重新聚焦
      }
    }
  }

  let timer: number | null = null
  new MutationObserver(() => {
    if (timer !== null) return
    timer = window.setTimeout(() => { timer = null; scan() }, 40)
  }).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['style', 'class'] })
}
