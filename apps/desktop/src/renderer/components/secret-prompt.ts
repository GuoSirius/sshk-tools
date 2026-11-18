/**
 * 密钥输入弹框（用户 2026-11-17：密码框要带眼镜可查看原始值）。
 * ElMessageBox.prompt 不支持 show-password，改用自定义 ElInput（type=password + showPassword）。
 * 返回 null = 用户取消。
 *
 * 实现要点（2026-11-18 修「无法输入」）：ElInput 每次按键后会把原生输入框重置为
 * props.modelValue——h(ElInput, { modelValue: secret.value }) 的 props 是静态快照
 * （永远是 ''），输入立刻被清空。必须用响应式渲染组件包裹：render 读取 secret.value
 * 建立依赖，按键 → onUpdate 回写 → 组件重渲染 → modelValue 真正流回 ElInput。
 */
import { defineComponent, h, ref } from 'vue'
import { ElInput, ElMessageBox } from 'element-plus'

export async function promptSecret(
  title: string,
  tip: string,
  confirmText = '确定',
  placeholder = '访问密钥',
): Promise<string | null> {
  const secret = ref('')
  const SecretInput = defineComponent({
    name: 'SecretInputBridge',
    setup() {
      return () =>
        h(ElInput, {
          modelValue: secret.value,
          'onUpdate:modelValue': (v: string) => { secret.value = v },
          type: 'password',
          showPassword: true,
          placeholder,
          autofocus: true,
          // 显式铺满：message-box 内嵌自定义组件时部分构建环境不继承 100% 宽度（2026-11-18 构建版实测）
          style: 'width:100%',
        })
    },
  })
  await ElMessageBox({
    title,
    message: h('div', { style: 'display:flex;flex-direction:column;gap:10px;width:100%' }, [
      h('p', { style: 'margin:0;font-size:13px;line-height:1.6;color:var(--el-text-color-regular)' }, tip),
      h(SecretInput),
    ]),
    confirmButtonText: confirmText,
    cancelButtonText: '取消',
    closeOnClickModal: false,
    closeOnPressEscape: false,
  })
  return secret.value
}
