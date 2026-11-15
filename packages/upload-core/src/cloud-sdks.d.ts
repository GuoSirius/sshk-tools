/**
 * 部分云 SDK 未随包提供 TypeScript 声明，这里只补「模块存在性」声明。
 * 它们始终通过字面量 import() 按需加载（构建器切成独立 chunk），
 * 运行期再按 SDK 实际形态取出构造函数，故此处无需展开完整 API 类型。
 */
declare module 'esdk-obs-nodejs' {
  const ObsClient: unknown
  export default ObsClient
}

declare module 'bce-sdk-js' {
  export const BosClient: unknown
}
