// 工具入口：主进程 handler 见 "./main"，渲染层页面见 "./renderer"，
// 分别由 discovery.ts 按 tool.manifest.json 的 plugin.main / plugin.renderer 装载。
// 工具 id 的唯一来源是 tool.manifest.json；宿主通过 deps.toolId / props.toolId 注入，源码不硬编码。
export {}
