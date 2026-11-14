// 工具入口：主进程不需要本工具的 handler（llm.* 为应用级 IPC，见数据契约 §5）。
// 渲染层页面由 "./renderer" 导出给桌面应用挂载。
// 工具 id 的唯一来源是 tool.manifest.json；宿主通过 props.toolId 注入，源码不硬编码、不留未使用的 id 常量。
export {}
