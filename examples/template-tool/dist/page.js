// 模板工具外部渲染层：编译后 ESM，零 import。默认导出 Vue 组件对象（setup + render）。
// 通过 window.SSHK 取全部 Vue API，通过 window.api 调用主进程（与内置版完全同构）。
// 演示「工具包全部 7 项宿主能力」——外部包与内置包开发模式零差异（需求 3）。
export default {
  props: ['toolId', 'menu'],
  setup(props) {
    const { ref, reactive, onMounted, computed } = window.SSHK
    // 通道前缀从宿主注入的 toolId 派生（manifest.id 单一来源）；零 import 无法 import 共享常量，故以 host 注入为准
    const PREFIX = props.toolId || 'template-tool'
    const invoke = (name, ...args) => window.api.ipc.invoke(`${PREFIX}:${name}`, ...args)
    const providers = ref([])
    const providerId = ref('')
    const chatInput = ref('用一句话介绍 SSHK 工具包。')
    const chatOutput = ref('')
    const models = ref([])
    const secretName = ref('demo-key')
    const secretValue = ref('s3cr3t-123')
    const secretReadback = ref('')
    const ocrCmd = ref('paddleocr')
    const ocrImg = ref('')
    const ocrResult = ref('')
    const logs = reactive([])
    const config = ref(null)

    function note(ok, name, detail) {
      logs.unshift({ ok, name, detail: String(detail).slice(0, 200) })
      if (logs.length > 50) logs.pop()
    }
    async function call(name, ...args) {
      try {
        const r = await invoke(name, ...args)
        note(true, name, JSON.stringify(r))
        return r
      } catch (e) {
        note(false, name, e.message)
        return undefined
      }
    }

    onMounted(async () => {
      try {
        providers.value = (await call('listProviders')) || []
        if (providers.value.length) providerId.value = providers.value[0]._id
      } catch {}
      try { config.value = await window.api.config.get(`tools.${PREFIX}`) } catch {}
    })

    async function loadProviders() {
      const l = await call('listProviders')
      if (l) { providers.value = l; if (!providerId.value && l.length) providerId.value = l[0]._id }
    }
    async function chatByProvider() {
      if (!providerId.value) return
      const r = await call('chatByProvider', { providerId: providerId.value, messages: [{ role: 'user', content: chatInput.value }] })
      if (r !== undefined) chatOutput.value = r
    }
    async function loadModels() {
      if (!providerId.value) return
      const r = await call('listModelsByProvider', providerId.value)
      if (r) models.value = r
    }
    async function setSecret() {
      const r = await call('setSecret', secretName.value, secretValue.value)
      if (r) secretReadback.value = '（已写入 safeStorage）'
    }
    async function getSecret() {
      const r = await call('getSecret', secretName.value)
      if (r !== undefined) secretReadback.value = r
    }
    async function runOcr() {
      if (!ocrCmd.value || !ocrImg.value) return
      const r = await call('runOcr', { command: ocrCmd.value, args: ['predict', '--image_dir', ocrImg.value], imagePath: ocrImg.value, timeoutMs: 30000 })
      if (r !== undefined) ocrResult.value = r
    }

    const providerOpts = computed(() => providers.value.map((p) => `${p.name}（${p.model}）${p.hasApiKey ? ' ✓' : ''}`))
    return {
      providers, providerId, chatInput, chatOutput, models, secretName, secretValue, secretReadback,
      ocrCmd, ocrImg, ocrResult, logs, config, providerOpts,
      loadProviders, chatByProvider, loadModels, setSecret, getSecret, runOcr,
    }
  },

  render() {
    const { h, ref } = window.SSHK
    const s = this.$setupState
    const card = (title, children) => h('div', {
      style: 'border:1px solid #e4e7ed;border-radius:8px;padding:12px;margin-bottom:12px;background:#fff',
    }, [h('div', { style: 'font-weight:600;margin-bottom:8px;color:#2f6bff' }, title), ...(Array.isArray(children) ? children : [children])])
    const btn = (label, color, on) => h('button', {
      style: `margin:4px 4px 0 0;padding:6px 14px;border:none;border-radius:6px;cursor:pointer;color:#fff;background:${color}`,
      onClick: on,
    }, label)
    const input = (model, ph) => h('input', {
      value: s[model], placeholder: ph,
      onInput: (e) => { s[model] = e.target.value },
      style: 'width:100%;padding:6px 8px;margin:4px 0;border:1px solid #dcdfe6;border-radius:6px;box-sizing:border-box',
    })
    const pre = (text) => h('pre', {
      style: 'background:#f5f7fa;border-radius:6px;padding:8px;margin-top:6px;max-height:120px;overflow:auto;font-size:12px;white-space:pre-wrap',
    }, text || '（结果将显示在此）')

    return h('div', { style: 'padding:24px;font-family:system-ui,sans-serif;color:#303133' }, [
      h('h2', { style: 'margin:0 0 4px' }, '工具包全能力演示（外部包 · 零 import 渲染层）'),
      h('p', { style: 'opacity:0.65;margin:0 0 16px;font-size:13px' },
        '所有调用经 window.api.ipc.invoke 转发主进程；密钥不经过渲染层。'),
      card('① 列出 Provider（listProviders）', [
        h('select', {
          value: s.providerId,
          onChange: (e) => { s.providerId = e.target.value },
          style: 'width:100%;padding:6px;border:1px solid #dcdfe6;border-radius:6px',
        }, s.providerOpts.map((o, i) => h('option', { value: s.providers[i] ? s.providers[i]._id : '', key: i }, o))),
        btn('刷新 Provider', '#2f6bff', s.loadProviders),
      ]),
      card('④ 查询模型（listModelsByProvider）', [
        btn('查询 /models', '#e6a23c', s.loadModels),
        h('div', { style: 'margin-top:6px' }, s.models.map((m) => h('span', { style: 'display:inline-block;background:#fdf6ec;color:#e6a23c;border-radius:4px;padding:2px 8px;margin:2px;font-size:12px' }, m))),
      ]),
      card('③ 按 Provider 对话（chatByProvider）', [
        input('chatInput', '输入消息'),
        btn('发送（密钥由主进程注入）', '#2f6bff', s.chatByProvider),
        pre(s.chatOutput),
      ]),
      card('⑤⑥ 工具专属密钥（set/getToolSecret）', [
        input('secretName', '密钥名'),
        input('secretValue', '密钥值'),
        btn('写入 safeStorage', '#67c23a', s.setSecret),
        btn('读取回显', '#909399', s.getSecret),
        pre(s.secretReadback),
      ]),
      card('⑦ 本机 OCR（runLocalOcr）', [
        input('ocrCmd', 'OCR 命令'),
        input('ocrImg', '图片绝对路径'),
        btn('执行识别', '#2f6bff', s.runOcr),
        pre(s.ocrResult),
      ]),
      card('调用日志', s.logs.map((l) => h('div', {
        style: 'font-size:12px;padding:3px 0;border-bottom:1px dashed #ebeef5',
      }, [
        h('span', { style: `color:${l.ok ? '#67c23a' : '#f56c6c'};font-weight:600`, }, l.ok ? '[OK]' : '[ERR]'),
        ' ' + l.name + ' · ' + l.detail,
      ]))),
      card('本工具配置回显（configGroups 契约）', pre(JSON.stringify(s.config, null, 2))),
    ])
  },
}
