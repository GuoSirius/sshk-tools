/**
 * 密钥输入弹框（用户 2026-11-17：密码框要带眼镜可查看原始值）。
 * 返回 null = 用户取消。
 *
 * 实现（2026-11-18 重写）：不再用 ElMessageBox + 编程式 h(ElInput)——该组合在构建版
 * 输入框宽度异常（message-box 动态挂载的 vnode 样式链路不受控），改用自管
 * SecretPromptDialog（真实 el-dialog，与业务弹框同一条渲染路径，dev/构建一致），
 * 通过 createApp 动态挂载调用，API 保持 promptSecret(title, tip, ...) => Promise<string|null> 不变。
 */
import { createApp, h, ref } from 'vue'
import SecretPromptDialog from './SecretPromptDialog.vue'

export function promptSecret(
  title: string,
  tip: string,
  confirmText = '确定',
  placeholder = '访问密钥',
): Promise<string | null> {
  return new Promise((resolve) => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    let settled = false
    const finish = (value: string | null): void => {
      if (settled) return
      settled = true
      resolve(value)
      app.unmount()
      host.remove()
    }
    const open = ref(true)
    const app = createApp({
      setup() {
        return () =>
          h(SecretPromptDialog, {
            open: open.value,
            title,
            tip,
            confirmText,
            placeholder,
            'onUpdate:open': (v: boolean) => {
              open.value = v
              if (!v) finish(null) // X / 取消按钮（ESC 已禁）
            },
            onConfirm: (value: string) => finish(value), // 输入值由 SecretPromptDialog 内部 v-model 管理并经事件回传
          })
      },
    })
    app.mount(host)
  })
}
