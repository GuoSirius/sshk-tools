// 模板工具外部 main：编译后 ESM，零 import。默认导出 (deps) => void（外部契约，单参）。
// 与内置版 tools/template-tool/src/main/index.ts 逻辑完全一致，仅入口签名不同：
//   builtin -> (ipcMain, deps)        external -> (deps)（deps.ipcMain 内嵌）
// 这里集中演示「工具包可能拥有的全部 7 项宿主能力」，每个能力注册一个通道，
// 由宿主注入的 deps.host 落地（密钥永不下发渲染层）。
// 通道前缀用宿主注入的 deps.toolId（源自 manifest.id），不在源码写死 id。

export default (deps) => {
  const host = deps.host
  const ch = (n) => `${deps.toolId}:${n}`

  // 1) 列出应用级 Provider（只读元信息，绝不含密钥）
  deps.ipcMain.handle(ch('listProviders'), () => host.listProviders())

  // 2) OpenAI 兼容 /chat/completions（支持 image_url 多模态）
  deps.ipcMain.handle(ch('chat'), async (_e, req) => host.chat(req))

  // 3) 按 Provider id 调用模型（baseURL / 密钥由主进程注入）
  deps.ipcMain.handle(ch('chatByProvider'), async (_e, req) => host.chatByProvider(req))

  // 4) 按 Provider id 查询 /models
  deps.ipcMain.handle(ch('listModelsByProvider'), async (_e, providerId, apiKey) =>
    host.listModelsByProvider(providerId, apiKey),
  )

  // 5) 写入工具专属密钥（落 safeStorage）
  deps.ipcMain.handle(ch('setSecret'), (_e, name, value) => {
    host.setToolSecret(deps.toolId, name, value)
    return true
  })

  // 6) 读取工具专属密钥
  deps.ipcMain.handle(ch('getSecret'), (_e, name) => host.getToolSecret(deps.toolId, name))

  // 7) 本机 OCR（无 shell、带超时，stdout 作为识别文本返回）
  deps.ipcMain.handle(ch('runOcr'), async (_e, req) => host.runLocalOcr(req))
}
