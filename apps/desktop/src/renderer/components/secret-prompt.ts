/**
 * 密钥输入弹框（用户 2026-11-17：密码框要带眼镜可查看原始值）。
 * ElMessageBox.prompt 不支持 show-password，改用自定义 ElInput（type=password + showPassword）。
 * 返回 null = 用户取消。
 */
import { h, ref } from 'vue'
import { ElInput, ElMessageBox } from 'element-plus'

export async function promptSecret(
  title: string,
  tip: string,
  confirmText = '确定',
  placeholder = '访问密钥',
): Promise<string | null> {
  const secret = ref('')
  await ElMessageBox({
    title,
    message: h('div', { style: 'display:flex;flex-direction:column;gap:10px' }, [
      h('p', { style: 'margin:0;font-size:13px;line-height:1.6;color:var(--el-text-color-regular)' }, tip),
      h(ElInput, {
        modelValue: secret.value,
        'onUpdate:modelValue': (v: string) => { secret.value = v },
        type: 'password',
        showPassword: true,
        placeholder,
        autofocus: true,
      }),
    ]),
    confirmButtonText: confirmText,
    cancelButtonText: '取消',
    closeOnClickModal: false,
    closeOnPressEscape: false,
  })
  return secret.value
}
