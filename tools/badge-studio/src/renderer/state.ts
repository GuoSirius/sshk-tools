/**
 * Badge Studio 渲染层状态域桶（P6-5 三分拆分，#156 · B37-F6）：
 * - stores/base.ts      工具基座：toolId 单例 + config key 装配
 * - stores/workspace.ts 工作区态：海报工作区（HTML/统计表/角标样式）+ 生成/保存/截图/下载 + dirty 基线
 * - stores/posters.ts   列表态：海报集合 + N5 源更新 + 导出/删除 + 分享链接组 + 当前海报 id
 * - stores/vision.ts    识别态：Provider/模型/图片识别配置
 * 模块级单例语义保持：ref 导出不变名（本文件仅聚合 re-export，各域 ref 仍只创建一次）；
 * 依赖方向恒为 域 → base（workspace → {vision, posters}），无环。
 */
export * from './stores/base'
export * from './stores/vision'
export * from './stores/posters'
export * from './stores/workspace'
