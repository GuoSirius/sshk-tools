/**
 * H3 工具侧日志上报：主动 logFront(level, msg, detail) → 主进程脱敏落盘。
 * 捕获类（Vue 异常/console.error）由宿主 renderer 的 installFrontLog 统一接管，
 * 工具渲染层与宿主同窗口运行，无需自行安装。
 * 实现唯一口径在 shared/createLogFront（CR-25② · P0-7）；红线：任何调用失败静默；绝不传密钥明文。
 */
import { createLogFront } from '@sshk/shared'

export type { FrontLogLevel } from '@sshk/shared'
export const logFront = createLogFront('tool')
