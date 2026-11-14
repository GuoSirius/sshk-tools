// 运行时示例渲染层：编译后 ESM，默认导出 Vue 组件（零 import，经 window.SSHK 取工具）
export default {
  setup() {
    const { ref } = window.SSHK
    const count = ref(0)
    return { count }
  },
  render() {
    const { h } = window.SSHK
    return h('div', { style: 'padding:32px;font-size:16px' }, [
      h('h3', '运行时工具加载成功'),
      h('p', '此页面来自 .sshktool 运行时包（utilityProcess 沙箱 / Blob URL 动态组件）'),
      h('button', {
        onClick: () => (this.count += 1),
        style: 'padding:6px 14px;border-radius:6px;cursor:pointer'
      }, '点击计数：' + this.count),
    ])
  },
}