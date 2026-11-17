/**
 * 上传管理工具只消费宿主 upload:* 能力，无 main 入口。
 * 工具 ID 的唯一真相源是 tool.manifest.json 的 id（宿主以 :tool-id 注入渲染层）；
 * 宿主侧按需从 @sshk/shared 的 TOOL_IDS.uploadManager 引用，本文件不再重复硬编码。
 * 存在意义：构建期 workspace 别名自动发现要求每个工具包有 src/index.ts。
 */
export {}
