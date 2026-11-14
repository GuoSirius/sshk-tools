// 运行时示例外部 main：编译后 ESM，默认导出注册函数 (deps) => void。
// 与内置插件契约不同：ipcMain 内嵌在 deps 中（单参），与 utilityProcess 沙箱共用同一契约。
export default (deps) => {
  deps.ipcMain.handle('runtime-sample:ping', async () => {
    // 通过扁平 host 代理验证宿主能力转发链路：listProviders 经父进程白名单落地。
    const providers = await deps.host.listProviders()
    const count = Array.isArray(providers) ? providers.length : 0
    return { pong: true, providerCount: count }
  })
}
