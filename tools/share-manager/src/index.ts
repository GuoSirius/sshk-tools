/**
 * 分享管理工具只消费宿主 shareHub:* / config:* / os:* 能力（plans/12），无 main 入口。
 * 工具 ID 唯一真相源是 tool.manifest.json 的 id（share-manager）。
 * 存在意义：构建期 workspace 别名自动发现要求每个工具包有 src/index.ts。
 */
export {}
