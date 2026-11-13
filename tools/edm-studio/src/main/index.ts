import { registerEdmIpc } from './ipc.js'

export * from '../core/render.js'
export { registerEdmIpc } from './ipc.js'
export type { EdmIpcDeps } from './ipc.js'
export { ShareServer, ttlMinutesLeft } from './share.js'

/** 插件入口契约：宿主只认 default / register 导出的注册函数 */
export default registerEdmIpc
