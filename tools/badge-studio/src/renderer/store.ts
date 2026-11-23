/**
 * Badge Studio 渲染层状态域桶（store.ts 桶 + store/ 域文件；Q-2 收敛后统一口径）：
 * - store/base.ts      工具基座：toolId 单例 + config key 装配
 * - store/workspace.ts 工作区态：海报工作区（HTML/统计表/角标样式）+ 生成/保存/截图/下载 + dirty 基线
 * - store/posters.ts   列表态：海报集合 + N5 源更新 + 导出/删除 + 分享链接组 + 当前海报 id
 * - store/vision.ts    识别态：Provider/模型/图片识别配置
 * 模块级单例语义保持：ref 导出不变名（本文件仅聚合 re-export，各域 ref 仍只创建一次）；
 * 依赖方向恒为 域 → base（workspace → {vision, posters}），无环。
 */
export * from './store/base'
export * from './store/vision'
export * from './store/posters'
export * from './store/workspace'
