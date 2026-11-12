// 工具入口：主进程不需要本工具的 handler（llm.* 为应用级 IPC，见数据契约 §5）。
// 渲染层页面由 "./renderer" 导出给桌面应用挂载。
export const MODEL_CONSOLE_ID = 'model-console'
